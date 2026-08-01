import { useCallback, useEffect, useRef, useState } from 'react'

interface UseVoiceActivityDetectorOptions {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  silenceThreshold?: number
  speechStartDelayMs?: number
  speechEndDelayMs?: number
}

const defaultSilenceThreshold = 0.025
const defaultSpeechStartDelayMs = 300
const defaultSpeechEndDelayMs = 1_500

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function useVoiceActivityDetector({
  onSpeechStart,
  onSpeechEnd,
  silenceThreshold = defaultSilenceThreshold,
  speechStartDelayMs = defaultSpeechStartDelayMs,
  speechEndDelayMs = defaultSpeechEndDelayMs,
}: UseVoiceActivityDetectorOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef(0)
  const isListeningRef = useRef(false)
  const isStartingRef = useRef(false)
  const isSpeakingRef = useRef(false)
  const startIdRef = useRef(0)
  const speechStartedAtRef = useRef<number | null>(null)
  const silenceStartedAtRef = useRef<number | null>(null)
  const callbacksRef = useRef({ onSpeechStart, onSpeechEnd })

  useEffect(() => {
    callbacksRef.current = { onSpeechStart, onSpeechEnd }
  }, [onSpeechEnd, onSpeechStart])

  const stop = useCallback(() => {
    startIdRef.current += 1
    isStartingRef.current = false
    window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = 0
    sourceRef.current?.disconnect()
    sourceRef.current = null
    analyserRef.current?.disconnect()
    analyserRef.current = null
    stopMediaStream(streamRef.current)
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    isListeningRef.current = false
    isSpeakingRef.current = false
    speechStartedAtRef.current = null
    silenceStartedAtRef.current = null
    setIsListening(false)
  }, [])

  const start = useCallback(async () => {
    if (isListeningRef.current || isStartingRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风访问')
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) {
      throw new Error('当前浏览器不支持 Web Audio API')
    }

    const startId = startIdRef.current + 1
    startIdRef.current = startId
    isStartingRef.current = true
    let pendingStream: MediaStream | null = null
    let pendingAudioContext: AudioContext | null = null
    let pendingAnalyser: AnalyserNode | null = null
    let pendingSource: MediaStreamAudioSourceNode | null = null

    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (startIdRef.current !== startId) {
        stopMediaStream(pendingStream)
        return
      }

      pendingAudioContext = new AudioContextConstructor()
      pendingAnalyser = pendingAudioContext.createAnalyser()
      pendingAnalyser.fftSize = 1024
      pendingAnalyser.smoothingTimeConstant = 0.62
      pendingSource = pendingAudioContext.createMediaStreamSource(pendingStream)
      pendingSource.connect(pendingAnalyser)
      await pendingAudioContext.resume()

      if (startIdRef.current !== startId) {
        pendingSource.disconnect()
        pendingAnalyser.disconnect()
        stopMediaStream(pendingStream)
        void pendingAudioContext.close()
        return
      }
    } catch (error) {
      pendingSource?.disconnect()
      pendingAnalyser?.disconnect()
      stopMediaStream(pendingStream)
      void pendingAudioContext?.close()
      throw error
    } finally {
      if (startIdRef.current === startId) {
        isStartingRef.current = false
      }
    }

    const stream = pendingStream
    const audioContext = pendingAudioContext
    const analyser = pendingAnalyser
    const source = pendingSource
    if (!stream || !audioContext || !analyser || !source) return

    streamRef.current = stream
    audioContextRef.current = audioContext
    analyserRef.current = analyser
    sourceRef.current = source
    isListeningRef.current = true
    setIsListening(true)

    const samples = new Uint8Array(analyser.fftSize)
    const readVolume = () => {
      analyser.getByteTimeDomainData(samples)
      let sumSquares = 0
      for (let index = 0; index < samples.length; index += 1) {
        const centered = (samples[index] - 128) / 128
        sumSquares += centered * centered
      }
      return Math.sqrt(sumSquares / samples.length)
    }

    const tick = () => {
      const now = performance.now()
      const volume = readVolume()
      const hasVoice = volume >= silenceThreshold

      if (hasVoice) {
        silenceStartedAtRef.current = null
        if (!isSpeakingRef.current) {
          speechStartedAtRef.current ??= now
          if (now - speechStartedAtRef.current >= speechStartDelayMs) {
            isSpeakingRef.current = true
            callbacksRef.current.onSpeechStart?.()
          }
        }
      } else {
        speechStartedAtRef.current = null
        if (isSpeakingRef.current) {
          silenceStartedAtRef.current ??= now
          if (now - silenceStartedAtRef.current >= speechEndDelayMs) {
            isSpeakingRef.current = false
            silenceStartedAtRef.current = null
            callbacksRef.current.onSpeechEnd?.()
          }
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [silenceThreshold, speechEndDelayMs, speechStartDelayMs])

  useEffect(() => stop, [stop])

  return { isListening, start, stop }
}
