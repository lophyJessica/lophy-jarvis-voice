import { useCallback, useEffect, useRef } from 'react'
import { endAsrStream, startAsrStream, uploadAsrStreamChunk } from '../api/asrStream'
import { transcribeAudio } from '../api/hermes'

interface UseStreamingAsrOptions {
  onInterimText: (text: string) => void
}

export interface StreamingAsrResult {
  text: string
  usedFallback: boolean
}

const sessionIdleTimeoutMs = 30_000
const chunkUploadIntervalMs = 2_000
const pcmUploadBufferMs = 200

async function retryOnce<T>(request: () => Promise<T>) {
  try {
    return await request()
  } catch {
    return request()
  }
}

function mergeInterimText(current: string, incoming: string) {
  if (!current) return incoming
  if (!incoming || current.endsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming
  return `${current}${incoming}`
}

export function useStreamingAsr({ onInterimText }: UseStreamingAsrOptions) {
  const onInterimTextRef = useRef(onInterimText)
  const sessionIdRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<string | null> | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const streamFailedRef = useRef(false)
  const interimTextRef = useRef('')
  const pendingChunksRef = useRef<Blob[]>([])
  const chunkTimerRef = useRef(0)
  const generationRef = useRef(0)
  const sessionControllerRef = useRef<AbortController | null>(null)
  const idleTimerRef = useRef(0)

  useEffect(() => {
    onInterimTextRef.current = onInterimText
  }, [onInterimText])

  const clearIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = 0
  }, [])

  const clearChunkTimer = useCallback(() => {
    window.clearTimeout(chunkTimerRef.current)
    chunkTimerRef.current = 0
  }, [])

  const resetSessionState = useCallback(() => {
    clearIdleTimer()
    clearChunkTimer()
    sessionControllerRef.current?.abort()
    sessionControllerRef.current = null
    sessionIdRef.current = null
    startPromiseRef.current = null
    uploadQueueRef.current = Promise.resolve()
    streamFailedRef.current = false
    interimTextRef.current = ''
    pendingChunksRef.current = []
    onInterimTextRef.current('')
  }, [clearChunkTimer, clearIdleTimer])

  const armIdleCleanup = useCallback((sessionId: string, generation: number) => {
    clearIdleTimer()
    idleTimerRef.current = window.setTimeout(() => {
      if (generationRef.current !== generation || sessionIdRef.current !== sessionId) return
      streamFailedRef.current = true
      sessionControllerRef.current?.abort()
      sessionControllerRef.current = null
      sessionIdRef.current = null
      void endAsrStream(sessionId).catch(() => undefined)
    }, sessionIdleTimeoutMs)
  }, [clearIdleTimer])

  const startSession = useCallback(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    resetSessionState()
    const controller = new AbortController()
    sessionControllerRef.current = controller
    const startPromise = retryOnce(() => startAsrStream(controller.signal)).then((sessionId) => {
      if (generationRef.current !== generation) {
        void endAsrStream(sessionId).catch(() => undefined)
        return null
      }
      sessionIdRef.current = sessionId
      armIdleCleanup(sessionId, generation)
      return sessionId
    }).catch(() => {
      if (generationRef.current === generation) streamFailedRef.current = true
      return null
    })
    startPromiseRef.current = startPromise
  }, [armIdleCleanup, resetSessionState])

  const queueChunkUpload = useCallback((blob: Blob) => {
    const generation = generationRef.current
    uploadQueueRef.current = uploadQueueRef.current.catch(() => undefined).then(async () => {
      if (generationRef.current !== generation || streamFailedRef.current) return
      const sessionId = await startPromiseRef.current
      if (!sessionId || streamFailedRef.current || generationRef.current !== generation) return
      try {
        const pieces = await retryOnce(() => uploadAsrStreamChunk(
          sessionId,
          blob,
          sessionControllerRef.current?.signal,
        ))
        armIdleCleanup(sessionId, generation)
        const incoming = pieces.map((piece) => piece.trim()).filter(Boolean).join('')
        if (!incoming) return
        const nextText = mergeInterimText(interimTextRef.current, incoming)
        interimTextRef.current = nextText
        onInterimTextRef.current(nextText)
      } catch {
        if (generationRef.current === generation) streamFailedRef.current = true
      }
    })
  }, [armIdleCleanup])

  const flushPendingChunks = useCallback(() => {
    clearChunkTimer()
    if (pendingChunksRef.current.length === 0) return
    const pendingChunks = pendingChunksRef.current
    pendingChunksRef.current = []
    queueChunkUpload(new Blob(pendingChunks, { type: pendingChunks[0]?.type || 'audio/webm' }))
  }, [clearChunkTimer, queueChunkUpload])

  const enqueueChunk = useCallback((blob: Blob) => {
    if (!blob.size) return
    if (blob.type === 'audio/pcm') {
      pendingChunksRef.current.push(blob)
      if (!chunkTimerRef.current) {
        chunkTimerRef.current = window.setTimeout(flushPendingChunks, pcmUploadBufferMs)
      }
      return
    }
    pendingChunksRef.current.push(blob)
    if (chunkTimerRef.current) return
    chunkTimerRef.current = window.setTimeout(flushPendingChunks, chunkUploadIntervalMs)
  }, [flushPendingChunks])

  const finishSession = useCallback(async (fullRecording: Blob): Promise<StreamingAsrResult> => {
    const generation = generationRef.current
    clearIdleTimer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    await uploadQueueRef.current.catch(() => undefined)
    let finalText = ''

    if (sessionId && generationRef.current === generation && !streamFailedRef.current) {
      try {
        finalText = await retryOnce(() => endAsrStream(sessionId, sessionControllerRef.current?.signal))
      } catch {
        streamFailedRef.current = true
      }
    } else if (sessionId) {
      await endAsrStream(sessionId).catch(() => undefined)
    }

    const needsFallback = !finalText
    resetSessionState()
    if (!needsFallback) return { text: finalText, usedFallback: false }
    return { text: await transcribeAudio(fullRecording), usedFallback: true }
  }, [clearIdleTimer, flushPendingChunks, resetSessionState])

  const cleanupSession = useCallback(() => {
    const pendingStart = startPromiseRef.current
    const activeSessionId = sessionIdRef.current
    generationRef.current += 1
    resetSessionState()
    if (activeSessionId) {
      void endAsrStream(activeSessionId).catch(() => undefined)
    } else {
      void pendingStart?.then((sessionId) => {
        if (sessionId) return endAsrStream(sessionId).catch(() => undefined)
      })
    }
  }, [resetSessionState])

  useEffect(() => cleanupSession, [cleanupSession])

  return { cleanupSession, enqueueChunk, finishSession, startSession }
}
