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
        const latestText = [...pieces].reverse().map((piece) => piece.trim()).find(Boolean) ?? ''
        if (!latestText || latestText === interimTextRef.current) return
        interimTextRef.current = latestText
        onInterimTextRef.current(latestText)
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
    // 先快照已流式出字：end/整段 /asr 失败时仍可发送，避免长句「听过但发不出去」
    const interimBeforeFlush = interimTextRef.current.trim()
    clearIdleTimer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    await uploadQueueRef.current.catch(() => undefined)
    const interimText = interimTextRef.current.trim() || interimBeforeFlush
    let finalText = ''

    if (sessionId && generationRef.current === generation && !streamFailedRef.current) {
      try {
        // 已有 interim 时给 end 较短预算，超时立刻用流式文本，避免长时间卡在「识别中」
        if (interimText) {
          const quick = new AbortController()
          const quickTimer = window.setTimeout(() => quick.abort(), 8_000)
          try {
            finalText = await endAsrStream(sessionId, quick.signal)
          } finally {
            window.clearTimeout(quickTimer)
          }
        } else {
          finalText = await endAsrStream(sessionId)
        }
      } catch {
        streamFailedRef.current = true
      }
    } else if (sessionId) {
      // 会话已失败时只做清理，不阻塞 interim / 整段降级
      void endAsrStream(sessionId).catch(() => undefined)
    }

    finalText = finalText.trim()
    resetSessionState()

    if (finalText) return { text: finalText, usedFallback: false }
    if (interimText) return { text: interimText, usedFallback: true }
    if (!fullRecording.size) return { text: '', usedFallback: true }
    try {
      return { text: await transcribeAudio(fullRecording), usedFallback: true }
    } catch {
      return { text: '', usedFallback: true }
    }
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
