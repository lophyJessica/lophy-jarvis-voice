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
  finalSource: 'tencent-end' | 'tencent-asr' | 'live-preview' | ''
}

const sessionIdleTimeoutMs = 30_000
/** webm 降级路径：仍需定时切片，但不能到秒级才出字 */
const chunkUploadIntervalMs = 400
/** PCM：首包零延迟；后续块短缓冲合并 */
const pcmUploadBufferMs = 35
const pcmFirstUploadDelayMs = 0
/** webm 整段预览：无流式 interim 时更勤，有 interim 时降频省带宽 */
const webmPreviewIntervalMs = 480
const webmPreviewIntervalWithInterimMs = 1_400
const webmPreviewMinBytes = 900
const webmPreviewFirstMinBytes = 400
/** 跟嘴专用：录音中定时 webm /asr（百度时代 chunk 有 MID；腾讯 chunk 常空，靠此补跟嘴） */
const livePreviewLoopMs = 700
const livePreviewFirstDelayMs = 160
const livePreviewEarlyProbeMs = 300
/** 收尾优先整段腾讯 /asr 的录音体积阈值 */
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

/** 去掉紧邻重复片段（含较长句级误拼接） */
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

/**
 * 流式文本合并（适配 VPS 可能回「整段累积」或「当前句」两种形态）：
 * 1) 与当前全文相似度高 / 前缀扩展 → 整段替换（同一次发言的修订）
 * 2) 明显是新短句 → 才把旧 hypothesis 提交到 committed
 */
function applyStreamPiece(
  committed: string,
  hypothesis: string,
  incoming: string,
): { committed: string; hypothesis: string } {
  if (!incoming) return { committed, hypothesis }
  const displayed = `${committed}${hypothesis}`

  if (!displayed) return { committed: '', hypothesis: incoming }

  // 整段累积 / 同段修订：绝不能拆成多句追加
  if (
    incoming.startsWith(displayed)
    || displayed.startsWith(incoming)
    || similarityByShorter(displayed, incoming) >= 0.42
  ) {
    const next = incoming.length >= displayed.length ? incoming : displayed
    return { committed: '', hypothesis: next }
  }

  // 只像在改当前句
  if (
    hypothesis
    && (incoming.startsWith(hypothesis)
      || hypothesis.startsWith(incoming)
      || similarityByShorter(hypothesis, incoming) >= 0.45)
  ) {
    const nextHyp = incoming.length >= hypothesis.length ? incoming : hypothesis
    return { committed, hypothesis: nextHyp }
  }

  // 新短句：旧句入库
  if (incoming.length <= Math.max(24, displayed.length * 0.55)) {
    const nextCommitted = hypothesis
      ? (committed.endsWith(hypothesis) ? committed : `${committed}${hypothesis}`)
      : committed
    return { committed: nextCommitted, hypothesis: incoming }
  }

  // 其它情况：取更长的一条，避免爆炸式重复
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

export function useStreamingAsr({ onInterimText, onDebugStats }: UseStreamingAsrOptions) {
  const onInterimTextRef = useRef(onInterimText)
  const onDebugStatsRef = useRef(onDebugStats)
  const sessionIdRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<string | null> | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const streamFailedRef = useRef(false)
  /** 已确认的句子累积（百度 FIN 句） */
  const committedTextRef = useRef('')
  /** 当前句临时假设（百度 MID） */
  const hypothesisTextRef = useRef('')
  const interimTextRef = useRef('')
  /** 会话内出现过的最长识别文本（防中途短窗口把结果缩短） */
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

  /** 监听就绪：仅续期已有会话，不提前建（避免服务端空闲后 chunk 空 text） */
  const prepareSession = useCallback(() => {
    if (sessionIdRef.current && !streamFailedRef.current) {
      armIdleCleanup(sessionIdRef.current, generationRef.current)
    }
  }, [armIdleCleanup])

  /** 每次开口新建会话，不复用可能已失效的预热会话 */
  const primeSession = useCallback(() => {
    startSession()
  }, [startSession])

  const applyStreamPieces = useCallback((pieces: string[]) => {
    const nextState = pickStreamState(
      committedTextRef.current,
      hypothesisTextRef.current,
      pieces,
    )
    committedTextRef.current = nextState.committed
    hypothesisTextRef.current = nextState.hypothesis
    const rawText = `${nextState.committed}${nextState.hypothesis}`
    const nextText = correctAsrText(rawText)
    if (!nextText || nextText === interimTextRef.current) return
    if (
      debugStatsRef.current.firstInterimMs === 0
      && speechStartedAtRef.current > 0
    ) {
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
    // 在途时不打断：避免 /asr 未完成就被 abort 导致全程无字（v71 回归）
    if (webmPreviewInFlightRef.current) return
    if (!urgent && now - lastWebmPreviewAtRef.current < minInterval) return
    if (hasInterim && interimTextRef.current.length > 20 && !streamFailedRef.current && !urgent) return
    lastWebmPreviewAtRef.current = now
    webmPreviewInFlightRef.current = true
    const controller = new AbortController()
    webmPreviewControllerRef.current = controller
    const generation = generationRef.current
    debugStatsRef.current.webmPreviewCount += 1
    if (debugStatsRef.current.liveSource !== 'stream') {
      debugStatsRef.current.liveSource = 'webm'
    }
    emitDebugStats()
    void transcribeAudio(blob, controller.signal).then((text) => {
      webmPreviewInFlightRef.current = false
      if (controller.signal.aborted || generationRef.current !== generation) return
      const trimmed = correctAsrText(text.trim())
      if (trimmed) applyStreamPieces([trimmed])
    }).catch(() => {
      if (!controller.signal.aborted) webmPreviewInFlightRef.current = false
    })
  }, [applyStreamPieces, emitDebugStats])

  const stopLivePreviewLoop = useCallback(() => {
    window.clearTimeout(livePreviewTimerRef.current)
    livePreviewTimerRef.current = 0
    livePreviewGenerationRef.current += 1
    webmPreviewControllerRef.current?.abort()
    webmPreviewControllerRef.current = null
    webmPreviewInFlightRef.current = false
  }, [])

  const beginLivePreview = useCallback(() => {
    stopLivePreviewLoop()
    resetDebugStats()
    speechStartedAtRef.current = performance.now()
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
  }, [requestWebmPreview, resetDebugStats, stopLivePreviewLoop])

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
          const pieces = await retryOnce(() => uploadAsrStreamChunk(
            sessionId,
            blob,
            sessionControllerRef.current?.signal,
          ))
          armIdleCleanup(sessionId, generation)
          applyStreamPieces(pieces)
          const hadStreamText = pieces.some((piece) => piece.trim())
          if (hadStreamText) {
            debugStatsRef.current.streamTextHits += 1
            debugStatsRef.current.liveSource = 'stream'
            emitDebugStats()
          } else if (
            !hadStreamText
            && blob.type === 'audio/pcm'
            && pcmSentCountRef.current >= 2
            && latestWebmRef.current
          ) {
            requestWebmPreview(latestWebmRef.current, true)
          }
        } catch {
          if (generationRef.current === generation) streamFailedRef.current = true
          uploadInFlightRef.current = false
          return
        }
      }
      uploadInFlightRef.current = false
      // 上传收尾瞬间又进来的块：立刻再泵，避免卡在 pending
      if (
        pendingChunksRef.current.length > 0
        && generationRef.current === generation
        && !streamFailedRef.current
      ) {
        pumpUploads()
      }
    })
  }, [applyStreamPieces, armIdleCleanup, emitDebugStats, requestWebmPreview])

  const flushPendingChunks = useCallback(() => {
    clearChunkTimer()
    if (pendingChunksRef.current.length === 0) return
    pumpUploads()
  }, [clearChunkTimer, pumpUploads])

  const enqueueChunk = useCallback((blob: Blob) => {
    if (!blob.size) return
    pendingChunksRef.current.push(blob)
    const isPcm = blob.type === 'audio/pcm'
    const delay = isPcm
      ? (pcmSentCountRef.current === 0 ? pcmFirstUploadDelayMs : pcmUploadBufferMs)
      : chunkUploadIntervalMs
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

  const enqueueWebmSnapshot = useCallback((blob: Blob) => {
    latestWebmRef.current = blob
    // 首段 webm 一到立刻预览，不等定时环（压首字延迟）
    if (blob.size >= webmPreviewFirstMinBytes && lastWebmPreviewAtRef.current === 0) {
      requestWebmPreview(blob, true)
    }
  }, [requestWebmPreview])

  const finishSession = useCallback(async (fullRecording: Blob): Promise<StreamingAsrResult> => {
    stopLivePreviewLoop()
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
    let finalSource: StreamingAsrResult['finalSource'] = finalText.trim() ? 'tencent-end' : ''

    // end 有结果时立刻推到 UI（收尾识别阶段可见），避免全程「正在等待…」
    if (chosen.text && generationRef.current === generation) {
      const preview = correctAsrText(chosen.text)
      interimTextRef.current = preview
      if (preview.length > bestInterimRef.current.length) bestInterimRef.current = preview
      onInterimTextRef.current(preview)
    }

    resetSessionState(true)

    // 收尾优先腾讯整段 /asr（准确度高于流式中间 preview）
    if (fullRecording.size >= finalAsrMinBytes) {
      try {
        const fallbackText = correctAsrText(collapseRepeatedPhrases((await transcribeAudio(fullRecording)).trim()))
        const streamCollapsed = correctAsrText(collapseRepeatedPhrases(chosen.text))
        const streamInflated = chosen.text.length > streamCollapsed.length * 1.35
        if (
          fallbackText
          && (fallbackText.length > chosen.text.length
            || chosen.text.length < fallbackText.length * 0.92
            || (streamInflated && fallbackText.length >= streamCollapsed.length))
        ) {
          chosen = { text: fallbackText, usedFallback: true }
          finalSource = 'tencent-asr'
        } else {
          chosen = { text: streamCollapsed, usedFallback: chosen.usedFallback }
        }
      } catch {
        chosen = {
          text: correctAsrText(collapseRepeatedPhrases(chosen.text)),
          usedFallback: chosen.usedFallback,
        }
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
        finalSource: 'tencent-asr',
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
