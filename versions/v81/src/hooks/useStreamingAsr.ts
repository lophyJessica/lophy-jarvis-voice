import { useCallback, useEffect, useRef } from 'react'
import { endAsrStream, startAsrStream, uploadAsrStreamChunk } from '../api/asrStream'
import { transcribeAudio } from '../api/hermes'
import { correctAsrText } from '../utils/asrCorrect'

interface UseStreamingAsrOptions {
  onInterimText: (text: string) => void
  /** 本地调试：跟嘴指标（?vad-qa=1 时展示） */
  onDebugStats?: (stats: StreamingAsrDebugStats) => void
}

export interface StreamingAsrDebugStats {
  firstInterimMs: number
  webmPreviewCount: number
  streamTextHits: number
  liveSource: 'stream' | 'webm' | ''
}

export interface StreamingAsrResult {
  text: string
  usedFallback: boolean
  /** 最终文本主要来源 */
  finalSource: 'baidu-end' | 'webm-preview' | 'fallback-asr' | ''
}

const sessionIdleTimeoutMs = 30_000
/** PCM 上传合并窗口（与 worklet 10_240 批次配合） */
const pcmUploadBufferMs = 80
const pcmFirstUploadDelayMs = 0
/** webm 累积 /asr 预览：跟嘴主路径 */
const webmPreviewIntervalMs = 420
const webmPreviewIntervalWithInterimMs = 900
const webmPreviewMinBytes = 900
const webmPreviewFirstMinBytes = 350
const livePreviewLoopMs = 520
const livePreviewFirstDelayMs = 80
const livePreviewEarlyProbeMs = 200
const finalAsrMinBytes = 3_000

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

function collapseRepeatedPhrases(text: string): string {
  let result = text
  for (let guard = 0; guard < 12; guard += 1) {
    const next = result
      .replace(/(.{4,80}?)\1+/g, '$1')
      .replace(/(.{10,120}?)(\1){1,}/g, '$1')
    if (next === result) break
    result = next
  }
  return result
}

function applyStreamPiece(
  committed: string,
  hypothesis: string,
  incoming: string,
): { committed: string; hypothesis: string } {
  if (!incoming) return { committed, hypothesis }
  const displayed = `${committed}${hypothesis}`
  if (!displayed) return { committed: '', hypothesis: incoming }
  if (
    incoming.startsWith(displayed)
    || displayed.startsWith(incoming)
    || similarityByShorter(displayed, incoming) >= 0.42
  ) {
    const next = incoming.length >= displayed.length ? incoming : displayed
    return { committed: '', hypothesis: next }
  }
  if (
    hypothesis
    && (incoming.startsWith(hypothesis)
      || hypothesis.startsWith(incoming)
      || similarityByShorter(hypothesis, incoming) >= 0.45)
  ) {
    const nextHyp = incoming.length >= hypothesis.length ? incoming : hypothesis
    return { committed, hypothesis: nextHyp }
  }
  if (incoming.length <= Math.max(24, displayed.length * 0.55)) {
    const nextCommitted = hypothesis
      ? (committed.endsWith(hypothesis) ? committed : `${committed}${hypothesis}`)
      : committed
    return { committed: nextCommitted, hypothesis: incoming }
  }
  const next = incoming.length >= displayed.length ? incoming : displayed
  return { committed: '', hypothesis: next }
}

function mergeInterimText(current: string, incoming: string): string {
  if (!current) return incoming
  if (!incoming) return current
  const applied = applyStreamPiece('', current, incoming)
  return `${applied.committed}${applied.hypothesis}`
}

function pickStreamState(
  committed: string,
  hypothesis: string,
  pieces: string[],
): { committed: string; hypothesis: string } {
  return pieces
    .map((piece) => piece.trim())
    .filter(Boolean)
    .reduce(
      (state, piece) => applyStreamPiece(state.committed, state.hypothesis, piece),
      { committed, hypothesis },
    )
}

function chooseFinalText(
  finalText: string,
  interimText: string,
  bestInterimText = '',
): { text: string; usedFallback: boolean } {
  const clean = (value: string) => correctAsrText(collapseRepeatedPhrases(value.trim()))
  const candidates = [finalText, interimText, bestInterimText].map(clean).filter(Boolean)
  if (candidates.length === 0) return { text: '', usedFallback: true }
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

export function useStreamingAsr({ onInterimText, onDebugStats }: UseStreamingAsrOptions) {
  const onInterimTextRef = useRef(onInterimText)
  const onDebugStatsRef = useRef(onDebugStats)
  const sessionIdRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<string | null> | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const streamFailedRef = useRef(false)
  const committedTextRef = useRef('')
  const hypothesisTextRef = useRef('')
  const interimTextRef = useRef('')
  const bestInterimRef = useRef('')
  const pendingChunksRef = useRef<Blob[]>([])
  const chunkTimerRef = useRef(0)
  const uploadInFlightRef = useRef(false)
  const pcmSentCountRef = useRef(0)
  const generationRef = useRef(0)
  const lastWebmPreviewAtRef = useRef(0)
  const webmPreviewInFlightRef = useRef(false)
  const latestWebmRef = useRef<Blob | null>(null)
  const webmPreviewControllerRef = useRef<AbortController | null>(null)
  const livePreviewTimerRef = useRef(0)
  const livePreviewGenerationRef = useRef(0)
  const speechStartedAtRef = useRef(0)
  const debugStatsRef = useRef<StreamingAsrDebugStats>({
    firstInterimMs: 0,
    webmPreviewCount: 0,
    streamTextHits: 0,
    liveSource: '',
  })
  const sessionControllerRef = useRef<AbortController | null>(null)
  const idleTimerRef = useRef(0)

  useEffect(() => {
    onInterimTextRef.current = onInterimText
  }, [onInterimText])

  useEffect(() => {
    onDebugStatsRef.current = onDebugStats
  }, [onDebugStats])

  const emitDebugStats = useCallback(() => {
    onDebugStatsRef.current?.({ ...debugStatsRef.current })
  }, [])

  useEffect(() => {
    if (onDebugStatsRef.current) emitDebugStats()
  }, [emitDebugStats, onDebugStats])

  const resetDebugStats = useCallback(() => {
    debugStatsRef.current = {
      firstInterimMs: 0,
      webmPreviewCount: 0,
      streamTextHits: 0,
      liveSource: '',
    }
    emitDebugStats()
  }, [emitDebugStats])

  const clearIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = 0
  }, [])

  const clearChunkTimer = useCallback(() => {
    window.clearTimeout(chunkTimerRef.current)
    chunkTimerRef.current = 0
  }, [])

  const resetSessionState = useCallback((clearDisplay = false) => {
    clearIdleTimer()
    clearChunkTimer()
    window.clearTimeout(livePreviewTimerRef.current)
    livePreviewTimerRef.current = 0
    webmPreviewControllerRef.current?.abort()
    webmPreviewControllerRef.current = null
    sessionControllerRef.current?.abort()
    sessionControllerRef.current = null
    sessionIdRef.current = null
    startPromiseRef.current = null
    uploadQueueRef.current = Promise.resolve()
    streamFailedRef.current = false
    committedTextRef.current = ''
    hypothesisTextRef.current = ''
    interimTextRef.current = ''
    bestInterimRef.current = ''
    pendingChunksRef.current = []
    uploadInFlightRef.current = false
    pcmSentCountRef.current = 0
    lastWebmPreviewAtRef.current = 0
    latestWebmRef.current = null
    webmPreviewInFlightRef.current = false
    speechStartedAtRef.current = 0
    if (clearDisplay) onInterimTextRef.current('')
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
    resetSessionState(false)
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

  const prepareSession = useCallback(() => {
    if (sessionIdRef.current && !streamFailedRef.current) {
      armIdleCleanup(sessionIdRef.current, generationRef.current)
    }
  }, [armIdleCleanup])

  const primeSession = useCallback(() => {
    startSession()
  }, [startSession])

  const stopLivePreviewLoop = useCallback(() => {
    window.clearTimeout(livePreviewTimerRef.current)
    livePreviewTimerRef.current = 0
    livePreviewGenerationRef.current += 1
    webmPreviewControllerRef.current?.abort()
    webmPreviewControllerRef.current = null
    webmPreviewInFlightRef.current = false
  }, [])

  const applyPreviewText = useCallback((incoming: string) => {
    const trimmed = incoming.trim()
    if (!trimmed) return
    const nextState = pickStreamState(committedTextRef.current, hypothesisTextRef.current, [trimmed])
    committedTextRef.current = nextState.committed
    hypothesisTextRef.current = nextState.hypothesis
    const nextText = correctAsrText(`${nextState.committed}${nextState.hypothesis}`)
    if (!nextText || nextText === interimTextRef.current) return
    if (debugStatsRef.current.firstInterimMs === 0 && speechStartedAtRef.current > 0) {
      debugStatsRef.current.firstInterimMs = Math.round(performance.now() - speechStartedAtRef.current)
      emitDebugStats()
    }
    interimTextRef.current = nextText
    if (nextText.length > bestInterimRef.current.length) bestInterimRef.current = nextText
    onInterimTextRef.current(nextText)
  }, [emitDebugStats])

  const requestWebmPreview = useCallback((blob: Blob, urgent = false) => {
    const isFirstPreview = lastWebmPreviewAtRef.current === 0
    const minBytes = isFirstPreview && urgent ? webmPreviewFirstMinBytes : webmPreviewMinBytes
    if (!blob.size || blob.size < minBytes) return
    const now = performance.now()
    const hasInterim = interimTextRef.current.length > 0
    const minInterval = hasInterim ? webmPreviewIntervalWithInterimMs : webmPreviewIntervalMs
    // 在途时不打断：避免 /asr 未完成就被 abort 导致全程无字（v71）
    if (webmPreviewInFlightRef.current) return
    if (!urgent && now - lastWebmPreviewAtRef.current < minInterval) return
    lastWebmPreviewAtRef.current = now
    webmPreviewInFlightRef.current = true
    const controller = new AbortController()
    webmPreviewControllerRef.current = controller
    const generation = generationRef.current
    debugStatsRef.current.webmPreviewCount += 1
    debugStatsRef.current.liveSource = 'webm'
    emitDebugStats()
    void transcribeAudio(blob, controller.signal).then((text) => {
      webmPreviewInFlightRef.current = false
      if (controller.signal.aborted || generationRef.current !== generation) return
      applyPreviewText(text)
    }).catch(() => {
      if (!controller.signal.aborted) webmPreviewInFlightRef.current = false
    })
  }, [applyPreviewText, emitDebugStats])

  const beginSpeechTiming = useCallback(() => {
    stopLivePreviewLoop()
    resetDebugStats()
    speechStartedAtRef.current = performance.now()
  }, [resetDebugStats, stopLivePreviewLoop])

  /** 开口即启 webm /asr 预览环（跟嘴主路径；chunk 无 MID） */
  const beginLivePreview = useCallback(() => {
    beginSpeechTiming()
    const generation = generationRef.current
    livePreviewGenerationRef.current = generation
    const tick = () => {
      if (livePreviewGenerationRef.current !== generationRef.current) return
      const blob = latestWebmRef.current
      if (blob) {
        const isFirst = lastWebmPreviewAtRef.current === 0
        requestWebmPreview(blob, isFirst)
      }
      livePreviewTimerRef.current = window.setTimeout(tick, livePreviewLoopMs)
    }
    livePreviewTimerRef.current = window.setTimeout(tick, livePreviewFirstDelayMs)
    window.setTimeout(() => {
      if (livePreviewGenerationRef.current !== generationRef.current) return
      const blob = latestWebmRef.current
      if (blob && blob.size >= webmPreviewFirstMinBytes && lastWebmPreviewAtRef.current === 0) {
        requestWebmPreview(blob, true)
      }
    }, livePreviewEarlyProbeMs)
  }, [beginSpeechTiming, requestWebmPreview])

  const pumpUploads = useCallback(() => {
    const generation = generationRef.current
    uploadQueueRef.current = uploadQueueRef.current.catch(() => undefined).then(async () => {
      while (
        generationRef.current === generation
        && !streamFailedRef.current
        && pendingChunksRef.current.length > 0
      ) {
        uploadInFlightRef.current = true
        const pendingChunks = pendingChunksRef.current
        pendingChunksRef.current = []
        const blob = new Blob(pendingChunks, { type: pendingChunks[0]?.type || 'audio/webm' })
        if (blob.type === 'audio/pcm') pcmSentCountRef.current += 1
        const sessionId = await startPromiseRef.current
        if (!sessionId || streamFailedRef.current || generationRef.current !== generation) {
          uploadInFlightRef.current = false
          return
        }
        try {
          await retryOnce(() => uploadAsrStreamChunk(
            sessionId,
            blob,
            sessionControllerRef.current?.signal,
          ))
          armIdleCleanup(sessionId, generation)
        } catch {
          if (generationRef.current === generation) streamFailedRef.current = true
          uploadInFlightRef.current = false
          return
        }
      }
      uploadInFlightRef.current = false
      if (
        pendingChunksRef.current.length > 0
        && generationRef.current === generation
        && !streamFailedRef.current
      ) {
        pumpUploads()
      }
    })
  }, [armIdleCleanup])

  const flushPendingChunks = useCallback(() => {
    clearChunkTimer()
    if (pendingChunksRef.current.length === 0) return
    pumpUploads()
  }, [clearChunkTimer, pumpUploads])

  const enqueueChunk = useCallback((blob: Blob) => {
    if (!blob.size) return
  // 仅上传音频给 asr-stream 会话攒包；跟嘴不走 chunk text
    if (blob.type !== 'audio/pcm') return
    pendingChunksRef.current.push(blob)
    const delay = pcmSentCountRef.current === 0 ? pcmFirstUploadDelayMs : pcmUploadBufferMs
    if (uploadInFlightRef.current) {
      if (!chunkTimerRef.current) {
        chunkTimerRef.current = window.setTimeout(flushPendingChunks, delay)
      }
      return
    }
    if (delay === 0) {
      flushPendingChunks()
      return
    }
    if (chunkTimerRef.current) return
    chunkTimerRef.current = window.setTimeout(flushPendingChunks, delay)
  }, [flushPendingChunks])

  /** MediaRecorder 累积 webm → 周期性 /asr 预览跟嘴 */
  const enqueueWebmSnapshot = useCallback((blob: Blob) => {
    latestWebmRef.current = blob
    if (blob.size >= webmPreviewFirstMinBytes) {
      requestWebmPreview(blob, lastWebmPreviewAtRef.current === 0)
    }
  }, [requestWebmPreview])

  const finishSession = useCallback(async (fullRecording: Blob): Promise<StreamingAsrResult> => {
    stopLivePreviewLoop()
    const generation = generationRef.current
    const interimBeforeFlush = interimTextRef.current.trim()
    const bestBeforeFlush = bestInterimRef.current.trim()
    clearIdleTimer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    await waitWithTimeout(
      uploadQueueRef.current.catch(() => undefined),
      interimBeforeFlush || bestBeforeFlush ? 4_500 : 10_000,
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
    let finalSource: StreamingAsrResult['finalSource'] = finalText.trim()
      ? 'baidu-end'
      : (chosen.text ? 'webm-preview' : '')

    if (chosen.text && generationRef.current === generation) {
      const preview = correctAsrText(chosen.text)
      interimTextRef.current = preview
      if (preview.length > bestInterimRef.current.length) bestInterimRef.current = preview
      onInterimTextRef.current(preview)
    }

    resetSessionState(true)

    if (!chosen.text && fullRecording.size >= finalAsrMinBytes) {
      try {
        chosen = {
          text: correctAsrText(collapseRepeatedPhrases((await transcribeAudio(fullRecording)).trim())),
          usedFallback: true,
        }
        finalSource = 'fallback-asr'
      } catch {
        chosen = { text: '', usedFallback: true }
      }
    }

    if (chosen.text && generationRef.current === generation) {
      onInterimTextRef.current(correctAsrText(chosen.text))
    }

    if (chosen.text) return { ...chosen, finalSource }
    if (!fullRecording.size) return { text: '', usedFallback: true, finalSource: '' }
    try {
      return {
        text: correctAsrText(collapseRepeatedPhrases(await transcribeAudio(fullRecording))),
        usedFallback: true,
        finalSource: 'fallback-asr',
      }
    } catch {
      return { text: '', usedFallback: true, finalSource: '' }
    }
  }, [clearIdleTimer, flushPendingChunks, resetSessionState, stopLivePreviewLoop])

  const cleanupSession = useCallback(() => {
    const pendingStart = startPromiseRef.current
    const activeSessionId = sessionIdRef.current
    generationRef.current += 1
    resetSessionState(true)
    if (activeSessionId) {
      void endAsrStream(activeSessionId).catch(() => undefined)
    } else {
      void pendingStart?.then((sessionId) => {
        if (sessionId) return endAsrStream(sessionId).catch(() => undefined)
      })
    }
  }, [resetSessionState])

  useEffect(() => cleanupSession, [cleanupSession])

  return {
    beginLivePreview,
    beginSpeechTiming,
    cleanupSession,
    enqueueChunk,
    enqueueWebmSnapshot,
    finishSession,
    prepareSession,
    primeSession,
    startSession,
    stopLivePreview: stopLivePreviewLoop,
  }
}
