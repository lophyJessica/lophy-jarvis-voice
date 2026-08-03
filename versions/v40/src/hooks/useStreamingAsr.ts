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

function longestCommonSubsequenceLength(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (!n || !m) return 0
  // 滚动数组，避免长文本 O(n*m) 占太大内存
  let prev = new Array<number>(m + 1).fill(0)
  let curr = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return prev[m]
}

function similarityByShorter(a: string, b: string): number {
  const shorter = Math.min(a.length, b.length)
  if (!shorter) return 0
  return longestCommonSubsequenceLength(a, b) / shorter
}

/** 去掉紧邻重复片段（流式误拼接时的「和所有的权限…和所有的权限…」） */
function collapseRepeatedPhrases(text: string): string {
  let result = text
  for (let guard = 0; guard < 8; guard += 1) {
    const next = result.replace(/(.{4,40}?)\1+/g, '$1')
    if (next === result) break
    result = next
  }
  return result
}

/**
 * 合并流式识别文本：
 * - 前缀累积 / 同句修订 → 取更完整的一条（替换，不盲追加）
 * - 低相似度的新内容 → 尾部重叠拼接
 */
function mergeInterimText(current: string, incoming: string): string {
  if (!current) return incoming
  if (!incoming) return current
  if (incoming === current || current.endsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming
  if (current.startsWith(incoming)) return current
  if (current.includes(incoming)) return current
  if (incoming.includes(current) && incoming.length >= current.length) return incoming

  // 与全文或尾部很像：视为同句修订。更长的已有文本绝不被更短片段替换掉。
  const fullSim = similarityByShorter(current, incoming)
  const tail = current.slice(-Math.min(48, current.length))
  const tailSim = similarityByShorter(tail, incoming)
  if (fullSim >= 0.55 || tailSim >= 0.6) {
    if (current.length > incoming.length) {
      // 短片段只修订尾部，且 incoming 不能比尾部短太多（否则保留原文）
      if (tailSim >= 0.65 && incoming.length >= Math.min(tail.length, 12)) {
        return `${current.slice(0, Math.max(0, current.length - tail.length))}${incoming}`
      }
      return current
    }
    return incoming
  }

  const maxOverlap = Math.min(current.length, incoming.length, 32)
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (current.endsWith(incoming.slice(0, size))) {
      return `${current}${incoming.slice(size)}`
    }
  }

  // 句读后的新句，或明显不同的后续内容
  if (/[。！？；.!?;]$/.test(current.trim()) || fullSim < 0.35) {
    return `${current}${incoming}`
  }
  return incoming.length >= current.length ? incoming : current
}

function pickStreamText(current: string, pieces: string[]): string {
  const candidates = pieces.map((piece) => piece.trim()).filter(Boolean)
  if (candidates.length === 0) return current
  return candidates.reduce((acc, piece) => mergeInterimText(acc, piece), current)
}

function chooseFinalText(
  finalText: string,
  interimText: string,
  bestInterimText = '',
): { text: string; usedFallback: boolean } {
  const clean = (value: string) => collapseRepeatedPhrases(value.trim())
  const candidates = [finalText, interimText, bestInterimText].map(clean).filter(Boolean)
  if (candidates.length === 0) return { text: '', usedFallback: true }

  // 先两两合并，再取最长干净结果，避免 end/短窗口丢掉前文
  let merged = candidates[0] ?? ''
  for (let index = 1; index < candidates.length; index += 1) {
    merged = clean(mergeInterimText(merged, candidates[index] ?? ''))
  }
  const longest = candidates.reduce((a, b) => (a.length >= b.length ? a : b))
  const best = merged.length >= longest.length ? merged : longest
  const usedFallback = !finalText || clean(finalText) !== best
  return { text: best, usedFallback }
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
  /** 会话内出现过的最长识别文本（防中途短窗口把结果缩短） */
  const bestInterimRef = useRef('')
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
    bestInterimRef.current = ''
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
        if (nextText.length > bestInterimRef.current.length) bestInterimRef.current = nextText
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
    const bestBeforeFlush = bestInterimRef.current.trim()
    clearIdleTimer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    // 长说话时上传队列可能积压；有 interim 时最多再等 2.5s，避免卡死在「识别中」
    await waitWithTimeout(
      uploadQueueRef.current.catch(() => undefined),
      interimBeforeFlush || bestBeforeFlush ? 2_500 : 8_000,
    )
    const interimText = interimTextRef.current.trim() || interimBeforeFlush
    const bestInterimText = (
      bestInterimRef.current.trim().length >= bestBeforeFlush.length
        ? bestInterimRef.current.trim()
        : bestBeforeFlush
    ) || interimText
    let finalText = ''

    if (sessionId && generationRef.current === generation && !streamFailedRef.current) {
      try {
        // 已有 interim 时给 end 较短预算，超时立刻用流式文本
        if (interimText || bestInterimText) {
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

    let chosen = chooseFinalText(finalText.trim(), interimText, bestInterimText)
    resetSessionState()

    // 有一定录音体积但流式结果偏短：再走整段 /asr（语音 webm 通常远小于 60KB）
    const recordingLooksUsable = fullRecording.size >= 6_000
    const textLooksShort = chosen.text.length < 80
    if (recordingLooksUsable && textLooksShort) {
      try {
        const fallbackText = collapseRepeatedPhrases((await transcribeAudio(fullRecording)).trim())
        if (fallbackText.length > chosen.text.length) {
          chosen = { text: fallbackText, usedFallback: true }
        }
      } catch {
        // keep chosen
      }
    }

    if (chosen.text) return chosen
    if (!fullRecording.size) return { text: '', usedFallback: true }
    try {
      return { text: collapseRepeatedPhrases(await transcribeAudio(fullRecording)), usedFallback: true }
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
