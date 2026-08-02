import { useCallback, useEffect, useRef, useState } from 'react'
import { REQUEST_TIMEOUT_MS } from '../api/request'

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
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
    sessionIdRef.current += 1
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
    setIsSpeaking(false)
  }, [releaseObjectUrl])

  useEffect(() => stop, [stop])

  const speak = useCallback(async (text: string, onPlaybackStart?: () => void) => {
    const content = text.trim()
    if (!isSupported || !content) return

    stop()
    const sessionId = sessionIdRef.current
    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsSpeaking(true)
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const ttsUrl = `/tts?text=${encodeURIComponent(content)}`
      let response = await fetch(ttsUrl, {
        method: 'POST',
        signal: controller.signal,
      })
      // The new contract is POST. Keep a narrow 405 fallback while the current VPS still serves legacy GET.
      if (response.status === 405) {
        response = await fetch(ttsUrl, { signal: controller.signal })
      }
      if (!response.ok) throw new Error(`Edge TTS request failed (${response.status})`)

      const audioUrl = window.URL.createObjectURL(await response.blob())
      if (sessionIdRef.current !== sessionId) {
        window.URL.revokeObjectURL(audioUrl)
        return
      }

      objectUrlRef.current = audioUrl
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      const playbackComplete = new Promise<void>((resolve) => {
        const finishPlayback = () => {
          playbackResolverRef.current = null
          resolve()
        }
        playbackResolverRef.current = finishPlayback
        audio.onended = finishPlayback
        audio.onerror = finishPlayback
      })
      await audio.play()
      onPlaybackStart?.()
      await playbackComplete
    } catch (error) {
      if (!controller.signal.aborted) console.warn(error)
    } finally {
      window.clearTimeout(timeoutId)
      if (audioRef.current) {
        audioRef.current.onended = null
        audioRef.current.onerror = null
      }
      audioRef.current = null
      abortControllerRef.current = null
      playbackResolverRef.current = null
      releaseObjectUrl()
      if (sessionIdRef.current === sessionId) setIsSpeaking(false)
    }
  }, [isSupported, releaseObjectUrl, stop])

  return { speak, stop, cancel: stop, isSpeaking, isSupported }
}
