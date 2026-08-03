import { useCallback, useEffect, useRef, useState } from 'react'
import { REQUEST_TIMEOUT_MS } from '../api/request'
import { extractCompleteSentences } from '../utils/ttsSentences'

type PlaybackStartHandler = () => void

/** 播放时向前预取的句子数（含即将播放的下一段） */
const PREFETCH_DEPTH = 3
/** 同时进行的 /tts 请求上限 */
const MAX_PARALLEL_FETCH = 3
/** 下一段未就绪时的最长等待（极端情况） */
const READY_WAIT_MS = 8_000

type PrefetchEntry = {
  text: string
  controller: AbortController
  promise: Promise<Blob | null>
  status: 'loading' | 'ready' | 'failed'
  blob: Blob | null
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
  const playbackResolverRef = useRef<(() => void) | null>(null)
  const sentenceQueueRef = useRef<string[]>([])
  const streamBufferRef = useRef('')
  const pumpRunningRef = useRef(false)
  /** 与 sentenceQueue 队头对齐的预取流水线 */
  const prefetchQueueRef = useRef<PrefetchEntry[]>([])
  /** 全局进行中的 /tts 请求数（含当前句与预取） */
  const activeFetchesRef = useRef(0)
  const onPlaybackStartRef = useRef<PlaybackStartHandler | null>(null)
  const playbackStartedRef = useRef(false)
  const drainResolversRef = useRef<Array<() => void>>([])
  const fillPrefetchRef = useRef<(sessionId: number) => void>(() => undefined)
  const isSupported = typeof window !== 'undefined'
    && typeof window.fetch === 'function'
    && typeof window.Audio === 'function'
    && typeof window.URL.createObjectURL === 'function'

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      window.URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const resolveDrainWaiters = useCallback(() => {
    if (sentenceQueueRef.current.length > 0 || pumpRunningRef.current || audioRef.current) return
    const waiters = drainResolversRef.current.splice(0)
    waiters.forEach((resolve) => resolve())
  }, [])

  const abortAllPrefetch = useCallback(() => {
    for (const entry of prefetchQueueRef.current) {
      entry.controller.abort()
    }
    prefetchQueueRef.current = []
  }, [])

  const stop = useCallback(() => {
    sessionIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sentenceQueueRef.current = []
    streamBufferRef.current = ''
    abortAllPrefetch()
    pumpRunningRef.current = false
    playbackStartedRef.current = false
    onPlaybackStartRef.current = null
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }
    playbackResolverRef.current?.()
    playbackResolverRef.current = null
    releaseObjectUrl()
    setIsSpeaking(false)
    resolveDrainWaiters()
  }, [abortAllPrefetch, releaseObjectUrl, resolveDrainWaiters])

  useEffect(() => stop, [stop])

  const fetchTtsBlob = useCallback(async (text: string, sessionId: number, signal: AbortSignal) => {
    activeFetchesRef.current += 1
    try {
      const ttsUrl = `/tts?text=${encodeURIComponent(text)}`
      let response = await fetch(ttsUrl, { method: 'POST', signal })
      if (response.status === 405) {
        response = await fetch(ttsUrl, { signal })
      }
      if (!response.ok) throw new Error(`Edge TTS request failed (${response.status})`)
      if (sessionIdRef.current !== sessionId) throw new DOMException('Aborted', 'AbortError')
      const blob = await response.blob()
      if (blob.size === 0) throw new Error('Edge TTS returned empty audio')
      return blob
    } finally {
      activeFetchesRef.current = Math.max(0, activeFetchesRef.current - 1)
      // 有空位时继续填满流水线
      fillPrefetchRef.current(sessionId)
    }
  }, [])

  const fillPrefetch = useCallback((sessionId: number) => {
    if (sessionIdRef.current !== sessionId) return

    const target = Math.min(PREFETCH_DEPTH, sentenceQueueRef.current.length)
    while (prefetchQueueRef.current.length < target) {
      if (activeFetchesRef.current >= MAX_PARALLEL_FETCH) break

      const index = prefetchQueueRef.current.length
      const text = sentenceQueueRef.current[index]
      if (!text) break

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      const entry: PrefetchEntry = {
        text,
        controller,
        status: 'loading',
        blob: null,
        promise: Promise.resolve(null),
      }

      entry.promise = (async () => {
        try {
          const blob = await fetchTtsBlob(text, sessionId, controller.signal)
          if (sessionIdRef.current !== sessionId) return null
          entry.blob = blob
          entry.status = 'ready'
          return blob
        } catch (error) {
          entry.status = 'failed'
          entry.blob = null
          if (isAbortError(error) || sessionIdRef.current !== sessionId) return null
          console.warn('TTS prefetch failed:', text.slice(0, 48), error)
          return null
        } finally {
          window.clearTimeout(timeoutId)
        }
      })()

      prefetchQueueRef.current.push(entry)
    }
  }, [fetchTtsBlob])

  fillPrefetchRef.current = fillPrefetch

  const playBlob = useCallback(async (blob: Blob, sessionId: number) => {
    const audioUrl = window.URL.createObjectURL(blob)
    if (sessionIdRef.current !== sessionId) {
      window.URL.revokeObjectURL(audioUrl)
      return
    }

    releaseObjectUrl()
    objectUrlRef.current = audioUrl
    const audio = new Audio(audioUrl)
    audioRef.current = audio

    await new Promise<void>((resolve) => {
      const finishPlayback = () => {
        playbackResolverRef.current = null
        audioRef.current = null
        releaseObjectUrl()
        resolve()
      }
      playbackResolverRef.current = finishPlayback
      audio.onended = finishPlayback
      audio.onerror = finishPlayback
      void audio.play().catch(finishPlayback)
    })
  }, [releaseObjectUrl])

  const awaitPrefetchBlob = useCallback(async (entry: PrefetchEntry, sessionId: number) => {
    if (entry.status === 'ready') return entry.blob
    if (entry.status === 'failed') return null

    let timeoutId = 0
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(null), READY_WAIT_MS)
    })
    try {
      const blob = await Promise.race([entry.promise, timeoutPromise])
      if (sessionIdRef.current !== sessionId) return null
      return blob
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const takeNextReadyBlob = useCallback(async (sessionId: number) => {
    fillPrefetch(sessionId)
    const sentence = sentenceQueueRef.current.shift()
    if (!sentence) return null

    let entry: PrefetchEntry | undefined
    if (prefetchQueueRef.current[0]?.text === sentence) {
      entry = prefetchQueueRef.current.shift()
    } else {
      // 队头错位时丢弃不匹配的预取，避免播错句
      while (prefetchQueueRef.current.length > 0 && prefetchQueueRef.current[0]?.text !== sentence) {
        prefetchQueueRef.current[0]?.controller.abort()
        prefetchQueueRef.current.shift()
      }
      if (prefetchQueueRef.current[0]?.text === sentence) {
        entry = prefetchQueueRef.current.shift()
      }
    }

    // 取出当前段后立刻补预取 N+1…N+3
    fillPrefetch(sessionId)

    if (entry) {
      const blob = await awaitPrefetchBlob(entry, sessionId)
      if (blob) return { text: sentence, blob }
      if (sessionIdRef.current !== sessionId) return null
    }

    // 预取未命中 / 失败：当场拉取（短暂等待）
    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const blob = await fetchTtsBlob(sentence, sessionId, controller.signal)
      return { text: sentence, blob }
    } catch (error) {
      if (isAbortError(error) || sessionIdRef.current !== sessionId) return null
      console.warn('TTS sentence skipped:', sentence.slice(0, 48), error)
      return null
    } finally {
      window.clearTimeout(timeoutId)
      abortControllerRef.current = null
    }
  }, [awaitPrefetchBlob, fetchTtsBlob, fillPrefetch])

  const pumpQueue = useCallback(async (sessionId: number) => {
    if (pumpRunningRef.current) return
    pumpRunningRef.current = true
    setIsSpeaking(true)
    fillPrefetch(sessionId)

    try {
      while (sentenceQueueRef.current.length > 0 && sessionIdRef.current === sessionId) {
        const next = await takeNextReadyBlob(sessionId)
        if (sessionIdRef.current !== sessionId) break
        if (!next) {
          // 单句失败已跳过；继续后续句子
          fillPrefetch(sessionId)
          continue
        }

        if (!playbackStartedRef.current) {
          playbackStartedRef.current = true
          onPlaybackStartRef.current?.()
        }

        // 播放当前段的同时，流水线已在拉后面几段
        fillPrefetch(sessionId)
        await playBlob(next.blob, sessionId)
      }
    } finally {
      pumpRunningRef.current = false

      if (sessionIdRef.current === sessionId && sentenceQueueRef.current.length > 0) {
        resolveDrainWaiters()
        void pumpQueue(sessionId)
        return
      }

      if (sessionIdRef.current === sessionId) {
        abortAllPrefetch()
        setIsSpeaking(false)
      }
      resolveDrainWaiters()
    }
  }, [abortAllPrefetch, fillPrefetch, playBlob, resolveDrainWaiters, takeNextReadyBlob])

  const enqueueSentences = useCallback((sentences: string[], sessionId: number) => {
    if (!isSupported || sentences.length === 0) return
    sentenceQueueRef.current.push(...sentences)
    fillPrefetch(sessionId)
    void pumpQueue(sessionId)
  }, [fillPrefetch, isSupported, pumpQueue])

  const beginStreamingSpeech = useCallback((onPlaybackStart?: PlaybackStartHandler) => {
    if (!isSupported) return
    stop()
    const sessionId = sessionIdRef.current
    streamBufferRef.current = ''
    onPlaybackStartRef.current = onPlaybackStart ?? null
    playbackStartedRef.current = false
    return sessionId
  }, [isSupported, stop])

  const appendStreamingSpeechText = useCallback((chunk: string) => {
    if (!isSupported || !chunk) return
    const sessionId = sessionIdRef.current
    streamBufferRef.current += chunk
    const { complete, remainder } = extractCompleteSentences(streamBufferRef.current, false)
    streamBufferRef.current = remainder
    enqueueSentences(complete, sessionId)
  }, [enqueueSentences, isSupported])

  const endStreamingSpeech = useCallback(() => {
    if (!isSupported) return
    const sessionId = sessionIdRef.current
    const { complete, remainder } = extractCompleteSentences(streamBufferRef.current, true)
    streamBufferRef.current = remainder
    enqueueSentences(complete, sessionId)
  }, [enqueueSentences, isSupported])

  const waitForSpeechDrain = useCallback(() => new Promise<void>((resolve) => {
    if (sentenceQueueRef.current.length === 0 && !pumpRunningRef.current && !audioRef.current) {
      resolve()
      return
    }
    drainResolversRef.current.push(resolve)
  }), [])

  const speak = useCallback(async (text: string, onPlaybackStart?: () => void) => {
    const sessionId = beginStreamingSpeech(onPlaybackStart)
    if (sessionId === undefined) return
    appendStreamingSpeechText(text)
    endStreamingSpeech()
    await waitForSpeechDrain()
  }, [appendStreamingSpeechText, beginStreamingSpeech, endStreamingSpeech, waitForSpeechDrain])

  return {
    speak,
    beginStreamingSpeech,
    appendStreamingSpeechText,
    endStreamingSpeech,
    waitForSpeechDrain,
    stop,
    cancel: stop,
    isSpeaking,
    isSupported,
  }
}
