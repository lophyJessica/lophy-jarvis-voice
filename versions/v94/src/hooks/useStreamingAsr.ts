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
  streamChunkCount: number
  streamTextHits: number
  liveSource: 'stream' | 'webm' | ''
}

export interface StreamingAsrResult {
  text: string
  usedFallback: boolean
  /** 最终文本主要来源 */
  finalSource: 'baidu-end' | 'baidu-stream' | 'fallback-asr' | 'webm-preview' | ''
}

const sessionIdleTimeoutMs = 30_000
/** PCM 上传：首包零延迟，后续短合并 */
const pcmUploadBufferMs = 35
const pcmFirstUploadDelayMs = 0
/** webm /asr：chunk 无 MID 时的跟嘴兜底 */
const webmPreviewIntervalMs = 480
const webmPreviewIntervalWithInterimMs = 1_200
const webmPreviewMinBytes = 900
const webmPreviewFirstMinBytes = 400
const webmPreviewFirstLaunchBytes = 2_400
const livePreviewLoopMs = 600
const livePreviewFirstDelayMs = 120
const maxChunkUploadFailures = 3
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

function waitForPreviewIdle(inFlight: () => boolean, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (!inFlight()) {
      resolve()
      return
    }
    const startedAt = performance.now()
    const tick = () => {
      if (!inFlight() || performance.now() - startedAt >= timeoutMs) {
        resolve()
        return
      }
      window.setTimeout(tick, 40)
    }
    tick()
  })
}

export function useStreamingAsr({ onInterimText, onDebugStats }: UseStreamingAsrOptions) {
  const onInterimTextRef = useRef(onInterimText)
  const onDebugStatsRef = useRef(onDebugStats)
  const sessionIdRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<string | null> | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())
  const streamFailedRef = useRef(false)
  const streamLiveActiveRef = useRef(false)
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
  const chunkUploadFailuresRef = useRef(0)
  const speechStartedAtRef = useRef(0)
  const debugStatsRef = useRef<StreamingAsrDebugStats>({
    firstInterimMs: 0,
    webmPreviewCount: 0,
    streamChunkCount: 0,
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
      streamChunkCount: 0,
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
    streamLiveActiveRef.current = false
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
    chunkUploadFailuresRef.current = 0
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

  const applyStreamPieces = useCallback((pieces: string[]) => {
    const incoming = pieces
      .map((piece) => piece.trim())
      .filter(Boolean)
      .reduce((a, b) => (a.length >= b.length ? a : b), '')
    if (!incoming) return
    const incomingClean = correctAsrText(incoming)
    if (incomingClean.length > bestInterimRef.current.length) {
      bestInterimRef.current = incomingClean
    }
    const displayed = correctAsrText(`${committedTextRef.current}${hypothesisTextRef.current}`)
    const isExtension = incomingClean.length >= displayed.length
      || incomingClean.startsWith(displayed.slice(0, Math.min(16, displayed.length)))
      || similarityByShorter(displayed, incomingClean) >= 0.55
    if (displayed && !isExtension) return

    committedTextRef.current = ''
    hypothesisTextRef.current = incomingClean
    const nextText = incomingClean
    if (!nextText || nextText === interimTextRef.current) return
    streamLiveActiveRef.current = true
    stopLivePreviewLoop()
    if (speechStartedAtRef.current === 0) {
      speechStartedAtRef.current = performance.now()
    }
    if (debugStatsRef.current.firstInterimMs === 0 && speechStartedAtRef.current > 0) {
      debugStatsRef.current.firstInterimMs = Math.round(performance.now() - speechStartedAtRef.current)
      emitDebugStats()
    }
    interimTextRef.current = nextText
    if (nextText.length > bestInterimRef.current.length) bestInterimRef.current = nextText
    onInterimTextRef.current(nextText)
  }, [emitDebugStats, stopLivePreviewLoop])

  const requestWebmPreview = useCallback((blob: Blob, urgent = false) => {
    if (streamLiveActiveRef.current && !streamFailedRef.current) return
    const awaitingFirst = lastWebmPreviewAtRef.current === 0
    const minBytes = awaitingFirst
      ? (urgent ? webmPreviewFirstMinBytes : webmPreviewFirstLaunchBytes)
      : webmPreviewMinBytes
    if (!blob.size || blob.size < minBytes) return
    const now = performance.now()
    const hasInterim = interimTextRef.current.length > 0
    const minInterval = hasInterim ? webmPreviewIntervalWithInterimMs : webmPreviewIntervalMs
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

  const beginSpeechTiming = useCallback(() => {
    stopLivePreviewLoop()
    // prime 阶段已有 MID 时勿重置指标/计时，避免开录瞬间「流式命中×0」又等一轮
    if (!streamLiveActiveRef.current) {
      resetDebugStats()
      speechStartedAtRef.current = performance.now()
    }
  }, [resetDebugStats, stopLivePreviewLoop])

  /** 开口计时；chunk MID 为主，无 MID 时 webm 预览环兜底 */
  const beginLivePreview = useCallback(() => {
    beginSpeechTiming()
    const generation = generationRef.current
    livePreviewGenerationRef.current = generation
    const tick = () => {
      if (livePreviewGenerationRef.current !== generationRef.current) return
      if (!streamLiveActiveRef.current) {
        const blob = latestWebmRef.current
        if (blob) requestWebmPreview(blob, lastWebmPreviewAtRef.current === 0)
      }
      livePreviewTimerRef.current = window.setTimeout(tick, livePreviewLoopMs)
    }
    livePreviewTimerRef.current = window.setTimeout(tick, livePreviewFirstDelayMs)
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
        const chunk = pendingChunksRef.current.shift()
        if (!chunk?.size) {
          uploadInFlightRef.current = false
          continue
        }
        const blob = new Blob([chunk], { type: chunk.type || 'audio/pcm' })
        if (blob.type === 'audio/pcm') pcmSentCountRef.current += 1
        const sessionId = await startPromiseRef.current
        if (!sessionId || streamFailedRef.current || generationRef.current !== generation) {
          pendingChunksRef.current.unshift(chunk)
          uploadInFlightRef.current = false
          return
        }
        try {
          const pieces = await retryOnce(() => uploadAsrStreamChunk(
            sessionId,
            blob,
            sessionControllerRef.current?.signal,
          ))
          chunkUploadFailuresRef.current = 0
          armIdleCleanup(sessionId, generation)
          debugStatsRef.current.streamChunkCount += 1
          applyStreamPieces(pieces)
          const hadStreamText = pieces.some((piece) => piece.trim())
          if (hadStreamText) {
            debugStatsRef.current.streamTextHits += 1
            debugStatsRef.current.liveSource = 'stream'
          }
          emitDebugStats()
        } catch {
          pendingChunksRef.current.unshift(chunk)
          chunkUploadFailuresRef.current += 1
          if (chunkUploadFailuresRef.current >= maxChunkUploadFailures) {
            if (generationRef.current === generation) {
              streamFailedRef.current = true
              const fallbackBlob = latestWebmRef.current
              if (fallbackBlob) requestWebmPreview(fallbackBlob, true)
            }
            uploadInFlightRef.current = false
            return
          }
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
  }, [applyStreamPieces, armIdleCleanup, emitDebugStats, requestWebmPreview])

  const flushPendingChunks = useCallback(() => {
    clearChunkTimer()
    if (pendingChunksRef.current.length === 0) return
    pumpUploads()
  }, [clearChunkTimer, pumpUploads])

  const enqueueChunk = useCallback((blob: Blob) => {
    if (!blob.size) return
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

  /** 缓存 webm；无 chunk MID 时走 /asr 预览跟嘴 */
  const enqueueWebmSnapshot = useCallback((blob: Blob) => {
    latestWebmRef.current = blob
    if (!streamLiveActiveRef.current) {
      requestWebmPreview(blob, lastWebmPreviewAtRef.current === 0)
    } else if (streamFailedRef.current) {
      requestWebmPreview(blob, true)
    }
  }, [requestWebmPreview])

  const finishSession = useCallback(async (fullRecording: Blob): Promise<StreamingAsrResult> => {
    const generation = generationRef.current
    await waitForPreviewIdle(() => webmPreviewInFlightRef.current, 2_000)
    stopLivePreviewLoop()
    const interimBeforeFlush = interimTextRef.current.trim()
    const bestBeforeFlush = bestInterimRef.current.trim()
    const streamHitsBeforeFlush = debugStatsRef.current.streamTextHits
    const streamWorked = streamHitsBeforeFlush > 0 || debugStatsRef.current.liveSource === 'stream'
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

    const endClean = correctAsrText(collapseRepeatedPhrases(finalText.trim()))
    let chosen: { text: string; usedFallback: boolean }
    let finalSource: StreamingAsrResult['finalSource'] = ''

    if (endClean || bestInterimText || interimText) {
      chosen = chooseFinalText(endClean, interimText, bestInterimText)
      finalSource = endClean ? 'baidu-end' : (streamWorked ? 'baidu-stream' : 'webm-preview')
    } else {
      chosen = { text: '', usedFallback: true }
    }

    const bestClean = correctAsrText(collapseRepeatedPhrases(bestInterimText))
    const chosenClean = correctAsrText(collapseRepeatedPhrases(chosen.text))
    if (
      streamWorked
      && fullRecording.size >= finalAsrMinBytes
      && chosenClean.length < Math.max(bestClean.length, 24) - 4
    ) {
      try {
        const webmText = correctAsrText(collapseRepeatedPhrases((await transcribeAudio(fullRecording)).trim()))
        if (webmText) {
          const merged = chooseFinalText(endClean, webmText, bestInterimText || interimText)
          if (merged.text.length > chosen.text.length) {
            chosen = merged
            if (webmText.length > endClean.length) finalSource = 'fallback-asr'
          }
        }
      } catch {
        // 保持 end + 流式合并
      }
    }

    if (chosen.text && generationRef.current === generation) {
      const preview = correctAsrText(chosen.text)
      interimTextRef.current = preview
      if (preview.length > bestInterimRef.current.length) bestInterimRef.current = preview
      onInterimTextRef.current(preview)
    }

    resetSessionState(true)

    if (fullRecording.size >= finalAsrMinBytes && !streamWorked && !endClean) {
      try {
        const fallbackText = correctAsrText(collapseRepeatedPhrases((await transcribeAudio(fullRecording)).trim()))
        if (fallbackText && fallbackText.length > chosen.text.length) {
          chosen = { text: fallbackText, usedFallback: true }
          finalSource = 'fallback-asr'
        }
      } catch {
        // 保持流式/预览结果
      }
    } else if (chosen.text) {
      chosen = {
        text: correctAsrText(collapseRepeatedPhrases(chosen.text)),
        usedFallback: chosen.usedFallback,
      }
    }

    if (!chosen.text && fullRecording.size >= finalAsrMinBytes) {
      try {
        return {
          text: correctAsrText(collapseRepeatedPhrases(await transcribeAudio(fullRecording))),
          usedFallback: true,
          finalSource: 'fallback-asr',
        }
      } catch {
        return { text: '', usedFallback: true, finalSource: '' }
      }
    }

    if (chosen.text) return { ...chosen, finalSource }
    return { text: '', usedFallback: true, finalSource: '' }
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
