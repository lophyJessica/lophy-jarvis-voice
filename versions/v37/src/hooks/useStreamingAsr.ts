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

/**
 * 合并流式识别文本。
 * 理想情况下 MID 是完整累积（incoming 以 current 为前缀）；
 * 实测百度/代理偶发只回「最近一句」短片段，此时需按重叠拼接，不能整段替换。
 */
function mergeInterimText(current: string, incoming: string): string {
  if (!current) return incoming
  if (!incoming) return current
  if (incoming === current || current.endsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming
  if (current.startsWith(incoming)) return current
  if (current.includes(incoming)) return current
  if (incoming.includes(current)) return incoming

  const maxOverlap = Math.min(current.length, incoming.length, 32)
  for (let size = maxOverlap; size >= 2; size -= 1) {
    if (current.endsWith(incoming.slice(0, size))) {
      return `${current}${incoming.slice(size)}`
    }
  }
  return `${current}${incoming}`
}

function pickStreamText(current: string, pieces: string[]): string {
  const candidates = pieces.map((piece) => piece.trim()).filter(Boolean)
  if (candidates.length === 0) return current
  // 同一次 chunk 响应里可能有多条，从短到长依次合并，避免只吃最后一条碎句
  return candidates.reduce((acc, piece) => mergeInterimText(acc, piece), current)
}

function chooseFinalText(finalText: string, interimText: string): { text: string; usedFallback: boolean } {
  if (finalText && interimText) {
    const merged = mergeInterimText(interimText, finalText)
    // end 明显更短且不像累积全文时，保留合并结果（通常以 interim 为主）
    if (finalText.length < interimText.length * 0.6 && !finalText.includes(interimText.slice(0, Math.min(12, interimText.length)))) {
      return { text: merged.length >= interimText.length ? merged : interimText, usedFallback: true }
    }
    if (merged === finalText) return { text: finalText, usedFallback: false }
    if (merged.length > finalText.length) return { text: merged, usedFallback: true }
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
