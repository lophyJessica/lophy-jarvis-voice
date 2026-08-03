import { useCallback, useEffect, useRef, useState } from 'react'
import { REQUEST_TIMEOUT_MS } from '../api/request'
import { extractCompleteSentences } from '../utils/ttsSentences'

type PlaybackStartHandler = () => void

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
  const prefetchRef = useRef<{ text: string; promise: Promise<Blob>; controller: AbortController } | null>(null)
  const onPlaybackStartRef = useRef<PlaybackStartHandler | null>(null)
  const playbackStartedRef = useRef(false)
  const drainResolversRef = useRef<Array<() => void>>([])
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

  const stop = useCallback(() => {
    sessionIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sentenceQueueRef.current = []
    streamBufferRef.current = ''
    prefetchRef.current?.controller.abort()
    prefetchRef.current = null
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
  }, [releaseObjectUrl, resolveDrainWaiters])

  useEffect(() => stop, [stop])

  const fetchTtsBlob = useCallback(async (text: string, sessionId: number, signal: AbortSignal) => {
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
  }, [])

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

  const pumpQueue = useCallback(async (sessionId: number) => {
    if (pumpRunningRef.current) return
    pumpRunningRef.current = true
    setIsSpeaking(true)

    try {
      while (sentenceQueueRef.current.length > 0 && sessionIdRef.current === sessionId) {
        const sentence = sentenceQueueRef.current.shift()
        if (!sentence) continue

        if (!playbackStartedRef.current) {
          playbackStartedRef.current = true
          onPlaybackStartRef.current?.()
        }

        const controller = new AbortController()
        abortControllerRef.current = controller
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
          let blob: Blob
          if (prefetchRef.current?.text === sentence) {
            const pref = prefetchRef.current
            prefetchRef.current = null
            try {
              blob = await pref.promise
            } catch (prefetchError) {
              if (isAbortError(prefetchError) || controller.signal.aborted || sessionIdRef.current !== sessionId) {
                throw prefetchError instanceof Error ? prefetchError : new DOMException('Aborted', 'AbortError')
              }
              // 预取失败则当场重试这一句，不中断整段播报
              blob = await fetchTtsBlob(sentence, sessionId, controller.signal)
            }
          } else {
            prefetchRef.current?.controller.abort()
            prefetchRef.current = null
            blob = await fetchTtsBlob(sentence, sessionId, controller.signal)
          }

          const nextSentence = sentenceQueueRef.current[0]
          if (nextSentence && sessionIdRef.current === sessionId) {
            const prefetchController = new AbortController()
            prefetchRef.current = {
              text: nextSentence,
              promise: fetchTtsBlob(nextSentence, sessionId, prefetchController.signal),
              controller: prefetchController,
            }
          }

          if (sessionIdRef.current !== sessionId) break
          await playBlob(blob, sessionId)
        } catch (error) {
          // 仅用户取消 / session 切换才整段停止；单句 TTS 失败则跳过继续播
          const aborted = isAbortError(error)
            || controller.signal.aborted
            || sessionIdRef.current !== sessionId
          if (aborted) break
          console.warn('TTS sentence skipped:', sentence.slice(0, 48), error)
        } finally {
          window.clearTimeout(timeoutId)
          abortControllerRef.current = null
        }
      }
    } finally {
      pumpRunningRef.current = false
      prefetchRef.current?.controller.abort()
      prefetchRef.current = null

      if (sessionIdRef.current === sessionId && sentenceQueueRef.current.length > 0) {
        // 泵退出期间又有新句子入队（或上一轮软失败后仍有剩余），继续泵
        resolveDrainWaiters()
        void pumpQueue(sessionId)
        return
      }

      if (sessionIdRef.current === sessionId) {
        setIsSpeaking(false)
      }
      resolveDrainWaiters()
    }
  }, [fetchTtsBlob, playBlob, resolveDrainWaiters])

  const enqueueSentences = useCallback((sentences: string[], sessionId: number) => {
    if (!isSupported || sentences.length === 0) return
    sentenceQueueRef.current.push(...sentences)
    void pumpQueue(sessionId)
  }, [isSupported, pumpQueue])

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
