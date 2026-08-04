import { useCallback, useEffect, useRef } from 'react'
import { endAsrStream, startAsrStream, uploadAsrStreamChunk } from '../api/asrStream'
import { transcribeAudio } from '../api/hermes'
import { correctAsrText } from '../utils/asrCorrect'
import { preferWebmStreamingCapture } from '../utils/platform'

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
  /** 会话内最长 MID 字数（调试） */
  liveCharCount: number
}

export interface StreamingAsrResult {
  text: string
  usedFallback: boolean
  /** 最终文本主要来源 */
  finalSource: 'baidu-end' | 'baidu-stream' | 'fallback-asr' | 'webm-preview' | ''
}

const sessionIdleTimeoutMs = 30_000
/** PCM 上传：首包零延迟，后续短合并（v53） */
const pcmUploadBufferMs = 50
const pcmFirstUploadDelayMs = 0
/** Capacitor：webm 切片合并后上传 asr-stream/chunk（AudioWorklet 不可靠） */
const webmStreamFirstMinBytes = 1_200
const webmStreamMinBytes = 3_500
const webmStreamFirstWaitMs = 320
const webmStreamWaitMs = 480
/** webm /asr：chunk 无 MID 时的跟嘴兜底 */
const webmPreviewIntervalMs = 480
const webmPreviewIntervalWithInterimMs = 1_200
const webmPreviewMinBytes = 900
const webmPreviewFirstMinBytes = 400
const webmPreviewFirstLaunchBytes = 2_000
const maxChunkUploadFailures = 3
const finalAsrMinBytes = 3_000

async function retryOnce<T>(request: () => Promise<T>) {
  try {
    return await request()
  } catch {
    return request()
  }
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
  return collapseRepeatedOpenings(result)
}

/** 去掉「您的API密钥…」类整段开头重复（webm 多次整段识别叠加） */
function collapseRepeatedOpenings(text: string): string {
  let result = text.trim()
  for (let guard = 0; guard < 10; guard += 1) {
    const headLen = Math.min(28, result.length)
    if (headLen < 14) break
    const head = result.slice(0, headLen)
    const repeatAt = result.indexOf(head, headLen)
    if (repeatAt < headLen) break
    result = result.slice(0, repeatAt) + result.slice(repeatAt + head.length)
  }
  return result
}

function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index += 1
  return index
}

/** chunk MID：前缀扩展或接新句尾，禁止把整段开头再拼一遍 */
function mergeChunkMid(current: string, incoming: string): string {
  const inc = incoming.trim()
  if (!inc) return current
  const cur = current.trim()
  if (!cur) return inc
  if (inc === cur) return cur
  if (inc.startsWith(cur)) return inc
  if (cur.startsWith(inc)) return cur
  if (inc.includes(cur) && inc.length > cur.length) return inc
  if (cur.includes(inc)) return cur
  const incHead = inc.slice(0, Math.min(16, inc.length))
  if (incHead.length >= 10 && cur.includes(incHead)) return cur
  const sep = /[，。！？、；：,\.!?;:\s]$/.test(cur) ? '' : '，'
  return `${cur}${sep}${inc}`
}

/** webm 整段识别：新结果更长且共享前缀 → 整段替换，不追加 */
function mergeWebmCumulative(current: string, incoming: string): string {
  const inc = incoming.trim()
  if (!inc) return current
  const cur = current.trim()
  if (!cur) return inc
  if (inc === cur) return cur
  if (inc.startsWith(cur)) return inc
  if (cur.startsWith(inc)) return cur
  if (inc.includes(cur) && inc.length > cur.length) return inc
  const prefix = sharedPrefixLength(cur, inc)
  if (prefix >= 10 && inc.length > cur.length) return inc
  if (inc.length > cur.length * 1.12) return inc
  return mergeChunkMid(cur, inc)
}

/**
 * 录音中展示。后端按会话累积文本，chunk 返回的就是当前完整识别结果，
 * 因此同源修订一律以新的为准；绝不因为「新的更短」而长期拒收，
 * 否则一旦显示被顶到前面就会卡死不动。
 */
function updateStreamDisplay(current: string, incoming: string): string {
  const inc = incoming.trim()
  if (!inc) return current
  const cur = current.trim()
  if (!cur) return inc
  if (inc === cur) return cur
  if (inc.startsWith(cur)) return inc
  if (cur.startsWith(inc)) return cur
  if (sharedPrefixLength(cur, inc) >= 4) return inc
  return inc.length >= cur.length ? inc : cur
}

function chooseFinalText(
  finalText: string,
  interimText: string,
  bestInterimText = '',
): { text: string; usedFallback: boolean } {
  const clean = (value: string) => correctAsrText(collapseRepeatedPhrases(value.trim()))
  const candidates = [finalText, interimText, bestInterimText].map(clean).filter(Boolean)
  if (candidates.length === 0) return { text: '', usedFallback: true }
  const best = pickLongestMerged(...candidates)
  const usedFallback = !finalText || clean(finalText) !== best
  return { text: best, usedFallback }
}

function pickLongestMerged(...texts: string[]): string {
  const parts = texts
    .map((value) => correctAsrText(collapseRepeatedPhrases(value.trim())))
    .filter(Boolean)
  if (parts.length === 0) return ''
  return parts.reduce((best, part) => {
    if (!best) return part
    if (part.startsWith(best)) return part
    if (best.startsWith(part)) return best
    const prefix = sharedPrefixLength(best, part)
    if (prefix >= 10 && part.length > best.length) return part
    if (prefix >= 10 && best.length > part.length) return best
    return part.length > best.length ? part : best
  }, '')
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
  const liveAccumRef = useRef('')
  const sessionDisplayRef = useRef('')
  const peakRawMidRef = useRef('')
  const pendingChunksRef = useRef<Blob[]>([])
  const streamWebmBufferRef = useRef<Blob[]>([])
  const streamWebmBytesRef = useRef(0)
  const webmStreamSentCountRef = useRef(0)
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
  const stagnantStreamHitsRef = useRef(0)
  const stagnantWebmUsedRef = useRef(false)
  /** 本会话是否已上传过音频；未上传过的会话可被下一次 prime 直接复用 */
  const sessionAudioSentRef = useRef(false)
  const speechStartedAtRef = useRef(0)
  const debugStatsRef = useRef<StreamingAsrDebugStats>({
    firstInterimMs: 0,
    webmPreviewCount: 0,
    streamChunkCount: 0,
    streamTextHits: 0,
    liveSource: '',
    liveCharCount: 0,
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
      liveCharCount: 0,
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
    liveAccumRef.current = ''
    sessionDisplayRef.current = ''
    peakRawMidRef.current = ''
    pendingChunksRef.current = []
    streamWebmBufferRef.current = []
    streamWebmBytesRef.current = 0
    webmStreamSentCountRef.current = 0
    uploadInFlightRef.current = false
    pcmSentCountRef.current = 0
    lastWebmPreviewAtRef.current = 0
    latestWebmRef.current = null
    webmPreviewInFlightRef.current = false
    chunkUploadFailuresRef.current = 0
    stagnantStreamHitsRef.current = 0
    stagnantWebmUsedRef.current = false
    sessionAudioSentRef.current = false
    if (clearDisplay) {
      speechStartedAtRef.current = 0
    }
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

  /**
   * 丢弃当前会话前先通知后端释放，避免服务端会话堆积（百度并发上限）。
   * 故意不 abort 正在飞的 start 请求：拿到 session_id 才能 end 掉它。
   */
  const releaseActiveSession = useCallback(() => {
    const activeSessionId = sessionIdRef.current
    const pendingStart = startPromiseRef.current
    sessionControllerRef.current = null
    sessionIdRef.current = null
    startPromiseRef.current = null
    if (activeSessionId) {
      void endAsrStream(activeSessionId).catch(() => undefined)
      return
    }
    void pendingStart?.then((sessionId) => {
      if (sessionId) return endAsrStream(sessionId).catch(() => undefined)
    }).catch(() => undefined)
  }, [])

  const startSession = useCallback(() => {
    releaseActiveSession()
    const generation = generationRef.current + 1
    generationRef.current = generation
    resetSessionState(false)
    onInterimTextRef.current('')
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
  }, [armIdleCleanup, releaseActiveSession, resetSessionState])

  /** 预热后没真正开口：释放这条没用上的会话，别让它占着百度并发 */
  const releaseIdleSession = useCallback(() => {
    if (sessionAudioSentRef.current) return
    if (!startPromiseRef.current && !sessionIdRef.current) return
    releaseActiveSession()
    resetSessionState(false)
  }, [releaseActiveSession, resetSessionState])

  const prepareSession = useCallback(() => {
    if (sessionIdRef.current && !streamFailedRef.current) {
      armIdleCleanup(sessionIdRef.current, generationRef.current)
    }
  }, [armIdleCleanup])

  /**
   * VAD 预热。同一次开口可能因音量抖动被反复调用，
   * 只要现有会话还没上传过音频就直接复用，绝不每次都新建（否则击穿百度并发）。
   */
  const primeSession = useCallback(() => {
    const hasUsableSession = Boolean(startPromiseRef.current)
      && !streamFailedRef.current
      && !sessionAudioSentRef.current
    if (hasUsableSession) {
      if (sessionIdRef.current) armIdleCleanup(sessionIdRef.current, generationRef.current)
      return
    }
    startSession()
  }, [armIdleCleanup, startSession])

  const stopLivePreviewLoop = useCallback(() => {
    window.clearTimeout(livePreviewTimerRef.current)
    livePreviewTimerRef.current = 0
    livePreviewGenerationRef.current += 1
    webmPreviewControllerRef.current?.abort()
    webmPreviewControllerRef.current = null
    webmPreviewInFlightRef.current = false
  }, [])

  const publishLiveText = useCallback((fromChunk = false) => {
    const nextText = correctAsrText(collapseRepeatedPhrases(sessionDisplayRef.current))
    if (!nextText) return false
    committedTextRef.current = ''
    hypothesisTextRef.current = nextText
    if (nextText === interimTextRef.current) {
      debugStatsRef.current.liveCharCount = Math.max(
        debugStatsRef.current.liveCharCount,
        nextText.length,
      )
      emitDebugStats()
      return false
    }
    if (fromChunk) {
      streamLiveActiveRef.current = true
      debugStatsRef.current.liveSource = 'stream'
    }
    if (speechStartedAtRef.current === 0) {
      speechStartedAtRef.current = performance.now()
    }
    if (
      fromChunk
      && debugStatsRef.current.firstInterimMs === 0
      && speechStartedAtRef.current > 0
    ) {
      debugStatsRef.current.firstInterimMs = Math.round(performance.now() - speechStartedAtRef.current)
    }
    interimTextRef.current = nextText
    debugStatsRef.current.liveCharCount = nextText.length
    onInterimTextRef.current(nextText)
    emitDebugStats()
    return true
  }, [emitDebugStats])

  const applyStreamPieces = useCallback((pieces: string[]) => {
    for (const piece of pieces) {
      const trimmed = piece.trim()
      if (!trimmed) continue
      const rawClean = correctAsrText(trimmed)
      if (rawClean.length > peakRawMidRef.current.length) {
        peakRawMidRef.current = rawClean
      }
      sessionDisplayRef.current = updateStreamDisplay(sessionDisplayRef.current, rawClean)
      liveAccumRef.current = updateStreamDisplay(liveAccumRef.current, rawClean)
      bestInterimRef.current = updateStreamDisplay(bestInterimRef.current, rawClean)
    }
    return publishLiveText(true)
  }, [publishLiveText])

  const applyWebmTranscript = useCallback((transcript: string) => {
    const inc = correctAsrText(collapseRepeatedPhrases(transcript.trim()))
    if (!inc) return false
    sessionDisplayRef.current = mergeWebmCumulative(sessionDisplayRef.current, inc)
    liveAccumRef.current = mergeWebmCumulative(liveAccumRef.current, inc)
    bestInterimRef.current = mergeWebmCumulative(bestInterimRef.current, inc)
    if (inc.length > peakRawMidRef.current.length) {
      peakRawMidRef.current = inc
    }
    return publishLiveText(false)
  }, [publishLiveText])

  /** 仅在流式失败时兜底；正常流式期间不得插入，否则会把显示顶到 chunk 前面 */
  const requestWebmPreview = useCallback((blob: Blob, urgent = false) => {
    if (streamLiveActiveRef.current && !streamFailedRef.current && !urgent) return
    const awaitingFirst = lastWebmPreviewAtRef.current === 0
    const minBytes = awaitingFirst
      ? (urgent ? webmPreviewFirstMinBytes : webmPreviewFirstLaunchBytes)
      : webmPreviewMinBytes
    if (!blob.size || blob.size < minBytes) return
    const now = performance.now()
    const minInterval = interimTextRef.current.length > 0
      ? webmPreviewIntervalWithInterimMs
      : webmPreviewIntervalMs
    if (webmPreviewInFlightRef.current) return
    if (!urgent && !awaitingFirst && now - lastWebmPreviewAtRef.current < minInterval) return
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
      if (trimmed) applyWebmTranscript(trimmed)
    }).catch(() => {
      if (!controller.signal.aborted) webmPreviewInFlightRef.current = false
    })
  }, [applyWebmTranscript, emitDebugStats])

  const beginSpeechTiming = useCallback(() => {
    stopLivePreviewLoop()
    if (!streamLiveActiveRef.current && debugStatsRef.current.streamChunkCount === 0) {
      resetDebugStats()
      speechStartedAtRef.current = performance.now()
    } else if (speechStartedAtRef.current === 0) {
      speechStartedAtRef.current = performance.now()
    }
  }, [resetDebugStats, stopLivePreviewLoop])

  /**
   * 开口计时。录音中**只**用 chunk MID 跟嘴：
   * 后端已按会话累积文本，中途再插 webm `/asr` 会把显示顶到 chunk 前面，
   * 之后 chunk 的累积文本反而被当成「更短」而全部拒绝，造成十几秒卡死。
   * webm 仅保留为流式彻底失败时的降级路径。
   */
  const beginLivePreview = useCallback(() => {
    beginSpeechTiming()
  }, [beginSpeechTiming])

  const pumpUploads = useCallback(() => {
    const generation = generationRef.current
    uploadQueueRef.current = uploadQueueRef.current.catch(() => undefined).then(async () => {
      while (
        generationRef.current === generation
        && pendingChunksRef.current.length > 0
      ) {
        uploadInFlightRef.current = true
        const pendingChunks = pendingChunksRef.current
        pendingChunksRef.current = []
        const blob = new Blob(pendingChunks, { type: pendingChunks[0]?.type || 'audio/webm' })
        if (!blob.size) {
          uploadInFlightRef.current = false
          continue
        }
        if (blob.type === 'audio/pcm') pcmSentCountRef.current += 1
        else if (blob.type.includes('webm') || blob.type.includes('ogg') || blob.type.includes('mp4')) {
          webmStreamSentCountRef.current += 1
        }
        const sessionId = await startPromiseRef.current
        if (!sessionId || generationRef.current !== generation) {
          pendingChunksRef.current = pendingChunks.concat(pendingChunksRef.current)
          uploadInFlightRef.current = false
          if (!sessionId && startPromiseRef.current) {
            void startPromiseRef.current.then(() => {
              if (pendingChunksRef.current.length > 0) pumpUploads()
            })
          }
          return
        }
        if (streamFailedRef.current) {
          uploadInFlightRef.current = false
          continue
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
          const hadStreamText = pieces.some((piece) => piece.trim())
          if (hadStreamText) {
            const prevChars = debugStatsRef.current.liveCharCount
            applyStreamPieces(pieces)
            debugStatsRef.current.streamTextHits += 1
            if (debugStatsRef.current.liveCharCount <= prevChars) {
              stagnantStreamHitsRef.current += 1
            } else {
              stagnantStreamHitsRef.current = 0
            }
            emitDebugStats()
          }
        } catch {
          pendingChunksRef.current = pendingChunks.concat(pendingChunksRef.current)
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

  const flushStreamWebmBuffer = useCallback(() => {
    clearChunkTimer()
    if (streamWebmBufferRef.current.length === 0) return
    const slices = streamWebmBufferRef.current
    streamWebmBufferRef.current = []
    streamWebmBytesRef.current = 0
    pendingChunksRef.current.push(new Blob(slices, { type: slices[0]?.type || 'audio/webm' }))
    pumpUploads()
  }, [clearChunkTimer, pumpUploads])

  const enqueueChunk = useCallback((blob: Blob) => {
    if (!blob.size) return
    sessionAudioSentRef.current = true

    if (blob.type === 'audio/pcm') {
      if (preferWebmStreamingCapture()) return
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
      return
    }

    const isStreamableWebm = blob.type.includes('webm')
      || blob.type.includes('ogg')
      || blob.type.includes('mp4')
      || blob.type.includes('aac')
    if (!isStreamableWebm) return

    streamWebmBufferRef.current.push(blob)
    streamWebmBytesRef.current += blob.size
    const isFirst = webmStreamSentCountRef.current === 0
    const minBytes = isFirst ? webmStreamFirstMinBytes : webmStreamMinBytes
    const waitMs = isFirst ? webmStreamFirstWaitMs : webmStreamWaitMs
    if (streamWebmBytesRef.current >= minBytes) {
      flushStreamWebmBuffer()
      return
    }
    if (chunkTimerRef.current) return
    chunkTimerRef.current = window.setTimeout(flushStreamWebmBuffer, waitMs)
  }, [flushPendingChunks, flushStreamWebmBuffer])

  /** 缓存累积 webm；长句定时 /asr 与收尾补全 */
  const enqueueWebmSnapshot = useCallback((blob: Blob) => {
    latestWebmRef.current = blob
  }, [])

  const finishSession = useCallback(async (fullRecording: Blob): Promise<StreamingAsrResult> => {
    const generation = generationRef.current
    const wholeAsrPromise = fullRecording.size >= finalAsrMinBytes
      ? transcribeAudio(fullRecording).catch(() => '')
      : Promise.resolve('')
    await waitForPreviewIdle(() => webmPreviewInFlightRef.current, 2_000)
    stopLivePreviewLoop()
    const interimBeforeFlush = interimTextRef.current.trim()
    const bestBeforeFlush = bestInterimRef.current.trim()
    const peakBeforeFlush = peakRawMidRef.current.trim()
    const accumBeforeFlush = liveAccumRef.current.trim()
    const displayBeforeFlush = sessionDisplayRef.current.trim()
    const streamHitsBeforeFlush = debugStatsRef.current.streamTextHits
    const streamWorked = streamHitsBeforeFlush > 0 || debugStatsRef.current.liveSource === 'stream'
    clearIdleTimer()
    flushStreamWebmBuffer()
    flushPendingChunks()
    const sessionId = await startPromiseRef.current
    await waitWithTimeout(
      uploadQueueRef.current.catch(() => undefined),
      interimBeforeFlush || bestBeforeFlush ? 4_500 : 10_000,
    )
    const interimText = interimTextRef.current.trim() || interimBeforeFlush
    const bestInterimText = pickLongestMerged(
      bestInterimRef.current.trim().length >= bestBeforeFlush.length
        ? bestInterimRef.current.trim()
        : bestBeforeFlush,
      peakBeforeFlush,
      accumBeforeFlush,
      displayBeforeFlush,
      interimText,
    )
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

    let wholeAsrText = ''

    try {
      wholeAsrText = correctAsrText(collapseRepeatedPhrases((await wholeAsrPromise).trim()))
    } catch {
      wholeAsrText = ''
    }

    if (wholeAsrText) {
      const merged = chooseFinalText(endClean, wholeAsrText, bestInterimText)
      chosen = { text: merged.text, usedFallback: merged.usedFallback }
      if (wholeAsrText.length > endClean.length) finalSource = 'fallback-asr'
    }

    const absoluteBest = pickLongestMerged(
      chosen.text,
      wholeAsrText,
      bestInterimText,
      peakBeforeFlush,
      accumBeforeFlush,
      displayBeforeFlush,
      sessionDisplayRef.current.trim(),
      interimText,
      endClean,
    )
    if (absoluteBest.length > chosen.text.length) {
      chosen = { text: absoluteBest, usedFallback: chosen.usedFallback }
      if (wholeAsrText.length >= chosen.text.length - 4) finalSource = 'fallback-asr'
    }

    if (chosen.text && generationRef.current === generation) {
      const preview = correctAsrText(collapseRepeatedPhrases(chosen.text))
      chosen = { text: preview, usedFallback: chosen.usedFallback }
      interimTextRef.current = preview
      bestInterimRef.current = preview
      onInterimTextRef.current(preview)
    }

    resetSessionState(false)

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
  }, [clearIdleTimer, flushPendingChunks, flushStreamWebmBuffer, resetSessionState, stopLivePreviewLoop])

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
    releaseIdleSession,
    startSession,
    stopLivePreview: stopLivePreviewLoop,
  }
}
