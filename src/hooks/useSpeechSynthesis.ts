import { useCallback, useEffect, useRef, useState } from 'react'

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const queueRef = useRef<string[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
  const isProcessingRef = useRef(false)
  const playbackResolverRef = useRef<(() => void) | null>(null)
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

  const stop = useCallback(() => {
    if (!isSupported) return
    sessionIdRef.current += 1
    queueRef.current = []
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }
    playbackResolverRef.current?.()
    playbackResolverRef.current = null
    releaseObjectUrl()
    isProcessingRef.current = false
    setIsSpeaking(false)
  }, [isSupported, releaseObjectUrl])

  useEffect(() => stop, [stop])

  const processQueue = useCallback(async () => {
    if (!isSupported || isProcessingRef.current) return
    isProcessingRef.current = true
    const sessionId = sessionIdRef.current
    setIsSpeaking(true)

    try {
      while (queueRef.current.length > 0 && sessionIdRef.current === sessionId) {
        const content = queueRef.current.shift()
        if (!content) continue
        const abortController = new AbortController()
        abortControllerRef.current = abortController

        try {
          const response = await fetch(`/tts?text=${encodeURIComponent(content)}`, {
            signal: abortController.signal,
          })
          if (!response.ok) throw new Error('Edge TTS request failed')

          const audioUrl = window.URL.createObjectURL(await response.blob())
          if (sessionIdRef.current !== sessionId) {
            window.URL.revokeObjectURL(audioUrl)
            break
          }

          objectUrlRef.current = audioUrl
          const audio = new Audio(audioUrl)
          audioRef.current = audio
          await new Promise<void>((resolve) => {
            const finishPlayback = () => {
              playbackResolverRef.current = null
              resolve()
            }
            playbackResolverRef.current = finishPlayback
            audio.onended = finishPlayback
            audio.onerror = finishPlayback
            void audio.play().catch(finishPlayback)
          })
        } catch (error) {
          if (!abortController.signal.aborted && sessionIdRef.current === sessionId) {
            console.warn(error)
          }
          if (sessionIdRef.current !== sessionId) break
        } finally {
          if (audioRef.current) {
            audioRef.current.onended = null
            audioRef.current.onerror = null
          }
          audioRef.current = null
          abortControllerRef.current = null
          playbackResolverRef.current = null
          releaseObjectUrl()
        }
      }
    } finally {
      if (sessionIdRef.current === sessionId) {
        isProcessingRef.current = false
        audioRef.current = null
        abortControllerRef.current = null
        releaseObjectUrl()
        setIsSpeaking(false)
      }
    }
  }, [isSupported, releaseObjectUrl])

  const speak = useCallback((text: string) => {
    const content = text.trim()
    if (!isSupported || !content) return
    queueRef.current.push(content)
    setIsSpeaking(true)
    void processQueue()
  }, [isSupported, processQueue])

  return { speak, stop, cancel: stop, isSpeaking, isSupported }
}
