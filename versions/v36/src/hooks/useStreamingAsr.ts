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

/** MID_TEXT 应为完整累积；若偶发短片段，保留更长的已有文本，避免长句被末尾碎句覆盖。 */
function pickStreamText(current: string, pieces: string[]): string {
  const candidates = pieces.map((piece) => piece.trim()).filter(Boolean)
  if (candidates.length === 0) return current
  const latest = candidates[candidates.length - 1] ?? ''
  const longest = candidates.reduce((a, b) => (a.length >= b.length ? a : b))
  const incoming = longest.length > latest.length ? longest : latest
  if (!current) return incoming
  if (incoming.startsWith(current) || current.startsWith(incoming)) {
    return incoming.length >= current.length ? incoming : current
  }
  return incoming.length >= current.length ? incoming : current
}

function chooseFinalText(finalText: string, interimText: string): { text: string; usedFallback: boolean } {
  if (finalText && interimText) {
    // end 只回末句/过短时，用更长的流式文本
    if (finalText.length < interimText.length * 0.6 && !interimText.startsWith(finalText)) {
      return { text: interimText, usedFallback: true }
    }
    return { text: finalText, usedFallback: false }
  }
  if (finalText) return { text: finalText, usedFallback: false }
  if (interimText) return { text: interimText, usedFallback: true }
  return { text: '', usedFallback: true }
}

function waitWithTimeout(promise: Promise<unknown>, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    window.setTimeout(finish, timeoutMs)
    void promise.then(finish, finish)
  })
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
        const nextText = pickStreamText(interimTextRef.current, pieces)
        if (!nextText || nextText === interimTextRef.current) return
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
    // 先快照已流式出字：end/整段 /asr 失败时仍可发送，避免长句「听过但发不出去」
    const interimBeforeFlush = interimTextRef.current.trim()
    clearIdleTimer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    // 长说话时上传队列可能积压；有 interim 时最多再等 2.5s，避免卡死在「识别中」
    await waitWithTimeout(uploadQueueRef.current.catch(() => undefined), interimBeforeFlush ? 2_500 : 8_000)
    const interimText = interimTextRef.current.trim() || interimBeforeFlush
    let finalText = ''

    if (sessionId && generationRef.current === generation && !streamFailedRef.current) {
      try {
        // 已有 interim 时给 end 较短预算，超时立刻用流式文本
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
      void endAsrStream(sessionId).catch(() => undefined)
    }

    const chosen = chooseFinalText(finalText.trim(), interimText)
    resetSessionState()
    if (chosen.text) return chosen
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
