import { useCallback, useEffect, useRef, useState } from 'react'

interface UseVoiceActivityDetectorOptions {
  enabled?: boolean
  mockMode?: boolean
  playbackActive?: boolean
  silenceThreshold?: number
  speechStartDelayMs?: number
  /** 持续有声多久才预热 ASR（早于开录） */
  speechPrimeDelayMs?: number
  speechEndDelayMs?: number
  canStartSpeech?: () => boolean
  /** 刚检测到声音时立刻调用（早于正式开录），用于提前创建 ASR 会话 */
  onSpeechPrime?: () => void
  /** 开录前声音消失：仅取消 prime 上传，保留预热 ASR 会话 */
  onSpeechPrimeCancel?: () => void
  /** 麦克风监听就绪（可提前预热 ASR） */
  onListeningReady?: () => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onRecordingChunk?: (blob: Blob) => void
  /** PCM 流式时 MediaRecorder 仍录 webm；定期整段预览补跟嘴 */
  onRecordingWebmSnapshot?: (blob: Blob) => void
  onRecordingComplete?: (blob: Blob) => void
}

/** 办公室环境：0.032 平衡误触与轻声 */
const defaultSilenceThreshold = 0.032
/** 预热 ASR：持续有声 ~120ms 再上传预滚动 */
const defaultSpeechPrimeDelayMs = 120
/** 开录须晚于 prime */
const defaultSpeechStartDelayMs = 220
/**
 * 静音多久才判定「说完了」并分段发送。
 * 长文朗读段间停顿常见 3–6s；7s 降低误切，说完后多停一会再等人回复。
 */
const SPEECH_END_SILENCE_MS = 7_000
const defaultSpeechEndDelayMs = SPEECH_END_SILENCE_MS
const playbackThresholdMultiplier = 1.35
const pcmFlushTimeoutMs = 600

type StreamingChunkMode = 'pcm' | 'webm' | null

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function disconnectAudioNode(node: AudioNode | null) {
  node?.disconnect()
}

export function useVoiceActivityDetector({
  enabled = true,
  mockMode = false,
  playbackActive = false,
  silenceThreshold = defaultSilenceThreshold,
  speechStartDelayMs = defaultSpeechStartDelayMs,
  speechPrimeDelayMs = defaultSpeechPrimeDelayMs,
  speechEndDelayMs = defaultSpeechEndDelayMs,
  canStartSpeech,
  onSpeechPrime,
  onSpeechPrimeCancel,
  onListeningReady,
  onSpeechStart,
  onSpeechEnd,
  onRecordingChunk,
  onRecordingWebmSnapshot,
  onRecordingComplete,
}: UseVoiceActivityDetectorOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const pcmWorkletRef = useRef<AudioWorkletNode | null>(null)
  const pcmSinkRef = useRef<GainNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const oscillatorRef = useRef<OscillatorNode | null>(null)
  const oscillatorStartedRef = useRef(false)
  const animationFrameRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamingChunkModeRef = useRef<StreamingChunkMode>(null)
  const pcmFlushPromiseRef = useRef<Promise<void> | null>(null)
  const pcmFlushResolverRef = useRef<(() => void) | null>(null)
  const discardRecordingRef = useRef(false)
  const isListeningRef = useRef(false)
  const isStartingRef = useRef(false)
  const isVoiceActiveRef = useRef(false)
  const startIdRef = useRef(0)
  const speechStartedAtRef = useRef<number | null>(null)
  const silenceStartedAtRef = useRef<number | null>(null)
  const ignoredUntilRef = useRef(0)
  const mockVolumeRef = useRef(0)
  const lastVolumeUpdateRef = useRef(0)
  const speechPrimedRef = useRef(false)
  const primedStreamingRef = useRef(false)
  const speechPrimeStartedAtRef = useRef<number | null>(null)
  const speechSessionStartedRef = useRef(false)
  const callbacksRef = useRef({
    canStartSpeech,
    onSpeechPrime,
    onSpeechPrimeCancel,
    onListeningReady,
    onSpeechStart,
    onSpeechEnd,
    onRecordingChunk,
    onRecordingWebmSnapshot,
    onRecordingComplete,
  })
  const settingsRef = useRef({
    enabled,
    playbackActive,
    silenceThreshold,
    speechStartDelayMs,
    speechPrimeDelayMs,
    speechEndDelayMs,
  })

  useEffect(() => {
    callbacksRef.current = {
      canStartSpeech,
      onSpeechPrime,
      onSpeechPrimeCancel,
      onListeningReady,
      onSpeechStart,
      onSpeechEnd,
      onRecordingChunk,
      onRecordingWebmSnapshot,
      onRecordingComplete,
    }
  }, [canStartSpeech, onListeningReady, onRecordingChunk, onRecordingComplete, onRecordingWebmSnapshot, onSpeechEnd, onSpeechPrime, onSpeechPrimeCancel, onSpeechStart])

  useEffect(() => {
    settingsRef.current = {
      enabled,
      playbackActive,
      silenceThreshold,
      speechStartDelayMs,
      speechPrimeDelayMs,
      speechEndDelayMs,
    }
  }, [enabled, playbackActive, silenceThreshold, speechEndDelayMs, speechPrimeDelayMs, speechStartDelayMs])

  const requestPcmFlush = useCallback(() => {
    const worklet = pcmWorkletRef.current
    if (!worklet || streamingChunkModeRef.current !== 'pcm') return null
    const promise = new Promise<void>((resolve) => {
      let completed = false
      const timeoutId = window.setTimeout(() => finish(), pcmFlushTimeoutMs)
      const finish = () => {
        if (completed) return
        completed = true
        window.clearTimeout(timeoutId)
        if (pcmFlushResolverRef.current === finish) pcmFlushResolverRef.current = null
        resolve()
      }
      pcmFlushResolverRef.current = finish
      worklet.port.postMessage({ type: 'stop' })
    })
    pcmFlushPromiseRef.current = promise
    return promise
  }, [])

  const startRecorder = useCallback(() => {
    const stream = streamRef.current
    if (!stream || recorderRef.current?.state === 'recording') return false
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/webm')) {
      setError('当前浏览器不支持 audio/webm 录音')
      return false
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const usePcmStreaming = Boolean(pcmWorkletRef.current)
    chunksRef.current = []
    discardRecordingRef.current = false
    streamingChunkModeRef.current = usePcmStreaming ? 'pcm' : 'webm'
    pcmFlushPromiseRef.current = null
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
        if (streamingChunkModeRef.current === 'webm') {
          callbacksRef.current.onRecordingChunk?.(event.data)
        } else {
          const partial = new Blob(chunksRef.current, { type: 'audio/webm' })
          callbacksRef.current.onRecordingWebmSnapshot?.(partial)
        }
      }
    }
    recorder.onerror = () => {
      chunksRef.current = []
      recorderRef.current = null
      isVoiceActiveRef.current = false
      streamingChunkModeRef.current = null
      setIsRecording(false)
      setError('录音失败，请重试')
    }
    recorder.onstop = async () => {
      await pcmFlushPromiseRef.current
      const shouldDiscard = discardRecordingRef.current
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      chunksRef.current = []
      recorderRef.current = null
      discardRecordingRef.current = false
      streamingChunkModeRef.current = null
      pcmFlushPromiseRef.current = null
      setIsRecording(false)
      // 空 blob 也要回调：PCM 流式路径可能已有 interim，不能卡在「识别中」
      if (!shouldDiscard) callbacksRef.current.onRecordingComplete?.(blob)
      // 结束后继续预滚动，供下一句补开头
      if (isListeningRef.current && pcmWorkletRef.current) {
        pcmWorkletRef.current.port.postMessage({ type: 'preroll' })
      }
    }
    recorderRef.current = recorder
    recorder.start(350)
    if (usePcmStreaming) {
      // 兜底：若开录早于 prime 定时，在此补预热与预滚动上传
      if (!speechSessionStartedRef.current && callbacksRef.current.canStartSpeech?.() !== false) {
        speechSessionStartedRef.current = true
        callbacksRef.current.onSpeechPrime?.()
      }
      if (!speechPrimedRef.current && callbacksRef.current.canStartSpeech?.() !== false) {
        speechPrimedRef.current = true
        primedStreamingRef.current = true
        pcmWorkletRef.current?.port.postMessage({ type: 'flush_preroll' })
      }
      pcmWorkletRef.current?.port.postMessage({ type: 'start' })
    }
    setIsRecording(true)
    return true
  }, [])

  const finishRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return false
    isVoiceActiveRef.current = false
    speechStartedAtRef.current = null
    speechSessionStartedRef.current = false
    silenceStartedAtRef.current = null
    callbacksRef.current.onSpeechEnd?.()
    requestPcmFlush()
    recorder.stop()
    return true
  }, [requestPcmFlush])

  const beginManualRecording = useCallback(() => {
    if (!isListeningRef.current || isVoiceActiveRef.current) return false
    if (!startRecorder()) return false
    isVoiceActiveRef.current = true
    callbacksRef.current.onSpeechStart?.()
    return true
  }, [startRecorder])

  const suppressFor = useCallback((durationMs: number) => {
    ignoredUntilRef.current = performance.now() + Math.max(0, durationMs)
    speechStartedAtRef.current = null
    silenceStartedAtRef.current = null
  }, [])

  const setMockVolume = useCallback((nextVolume: number) => {
    mockVolumeRef.current = Math.max(0, nextVolume)
    if (oscillatorRef.current && !oscillatorStartedRef.current) {
      oscillatorRef.current.start()
      oscillatorStartedRef.current = true
    }
    void audioContextRef.current?.resume()
  }, [])

  const stop = useCallback(() => {
    startIdRef.current += 1
    isStartingRef.current = false
    window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = 0
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      discardRecordingRef.current = true
      requestPcmFlush()
      recorderRef.current.stop()
    }
    recorderRef.current = null
    if (oscillatorRef.current && oscillatorStartedRef.current) oscillatorRef.current.stop()
    oscillatorRef.current?.disconnect()
    oscillatorRef.current = null
    oscillatorStartedRef.current = false
    sourceRef.current?.disconnect()
    sourceRef.current = null
    pcmWorkletRef.current?.disconnect()
    pcmWorkletRef.current = null
    pcmSinkRef.current?.disconnect()
    pcmSinkRef.current = null
    analyserRef.current?.disconnect()
    analyserRef.current = null
    stopMediaStream(streamRef.current)
    streamRef.current = null
    void audioContextRef.current?.close()
    audioContextRef.current = null
    isListeningRef.current = false
    isVoiceActiveRef.current = false
    streamingChunkModeRef.current = null
    pcmFlushPromiseRef.current = null
    pcmFlushResolverRef.current = null
    speechStartedAtRef.current = null
    silenceStartedAtRef.current = null
    mockVolumeRef.current = 0
    setVolume(0)
    setIsRecording(false)
    setIsListening(false)
  }, [requestPcmFlush])

  const start = useCallback(async () => {
    if (isListeningRef.current || isStartingRef.current) return
    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor || typeof MediaRecorder === 'undefined') {
      throw new Error('当前浏览器不支持实时语音所需的 Web Audio API')
    }
    if (!mockMode && !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风访问')
    }

    const startId = startIdRef.current + 1
    startIdRef.current = startId
    isStartingRef.current = true
    setError(null)
    let pendingStream: MediaStream | null = null
    let pendingAudioContext: AudioContext | null = null
    let pendingAnalyser: AnalyserNode | null = null
    let pendingSource: MediaStreamAudioSourceNode | null = null
    let pendingOscillator: OscillatorNode | null = null
    let pendingPcmWorklet: AudioWorkletNode | null = null
    let pendingPcmSink: GainNode | null = null

    try {
      pendingAudioContext = new AudioContextConstructor({ sampleRate: 16_000 })
      if (mockMode) {
        const destination = pendingAudioContext.createMediaStreamDestination()
        const gain = pendingAudioContext.createGain()
        pendingOscillator = pendingAudioContext.createOscillator()
        pendingOscillator.frequency.value = 440
        gain.gain.value = 0.08
        pendingOscillator.connect(gain)
        gain.connect(destination)
        pendingStream = destination.stream
      } else {
        pendingStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      }
      if (startIdRef.current !== startId) {
        pendingOscillator?.stop()
        stopMediaStream(pendingStream)
        void pendingAudioContext.close()
        return
      }

      pendingAnalyser = pendingAudioContext.createAnalyser()
      pendingAnalyser.fftSize = 1024
      pendingAnalyser.smoothingTimeConstant = 0.62
      pendingSource = pendingAudioContext.createMediaStreamSource(pendingStream)
      pendingSource.connect(pendingAnalyser)
      if (pendingAudioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          const workletUrl = new URL('pcm-capture-worklet.js', document.baseURI).toString()
          await pendingAudioContext.audioWorklet.addModule(workletUrl)
          pendingPcmWorklet = new AudioWorkletNode(pendingAudioContext, 'jarvis-pcm-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          })
          pendingPcmSink = pendingAudioContext.createGain()
          pendingPcmSink.gain.value = 0
          pendingSource.connect(pendingPcmWorklet)
          pendingPcmWorklet.connect(pendingPcmSink)
          pendingPcmSink.connect(pendingAudioContext.destination)
        } catch {
          disconnectAudioNode(pendingPcmWorklet)
          disconnectAudioNode(pendingPcmSink)
          pendingPcmWorklet = null
          pendingPcmSink = null
        }
      }
      if (!mockMode) await pendingAudioContext.resume()

      if (startIdRef.current !== startId) {
        pendingOscillator?.stop()
        pendingSource.disconnect()
        disconnectAudioNode(pendingPcmWorklet)
        disconnectAudioNode(pendingPcmSink)
        pendingAnalyser.disconnect()
        stopMediaStream(pendingStream)
        void pendingAudioContext.close()
        return
      }
    } catch (startError) {
      pendingOscillator?.stop()
      pendingSource?.disconnect()
      disconnectAudioNode(pendingPcmWorklet)
      disconnectAudioNode(pendingPcmSink)
      pendingAnalyser?.disconnect()
      stopMediaStream(pendingStream)
      void pendingAudioContext?.close()
      throw startError
    } finally {
      if (startIdRef.current === startId) isStartingRef.current = false
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
    pcmWorkletRef.current = pendingPcmWorklet
    pcmSinkRef.current = pendingPcmSink
    if (pendingPcmWorklet) {
      pendingPcmWorklet.port.onmessage = (event: MessageEvent<{ type?: string; buffer?: ArrayBuffer }>) => {
        if (
          event.data?.type === 'pcm'
          && event.data.buffer
          && (streamingChunkModeRef.current === 'pcm' || primedStreamingRef.current)
        ) {
          callbacksRef.current.onRecordingChunk?.(new Blob([event.data.buffer], { type: 'audio/pcm' }))
        }
        if (event.data?.type === 'flushed') pcmFlushResolverRef.current?.()
      }
      pendingPcmWorklet.onprocessorerror = () => {
        pendingPcmWorklet.disconnect()
        pcmWorkletRef.current = null
        if (streamingChunkModeRef.current === 'pcm') streamingChunkModeRef.current = 'webm'
      }
      // 监听阶段持续预滚动，开录时补回句首
      pendingPcmWorklet.port.postMessage({ type: 'preroll' })
    }
    oscillatorRef.current = pendingOscillator
    oscillatorStartedRef.current = false
    isListeningRef.current = true
    setIsListening(true)
    callbacksRef.current.onListeningReady?.()

    const samples = new Uint8Array(analyser.fftSize)
    const readVolume = () => {
      if (mockMode) return mockVolumeRef.current
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
      const nextVolume = readVolume()
      if (now - lastVolumeUpdateRef.current >= 80) {
        lastVolumeUpdateRef.current = now
        setVolume(nextVolume)
      }

      const settings = settingsRef.current
      if (!settings.enabled || now < ignoredUntilRef.current) {
        speechStartedAtRef.current = null
        speechPrimeStartedAtRef.current = null
        speechSessionStartedRef.current = false
        silenceStartedAtRef.current = null
        animationFrameRef.current = window.requestAnimationFrame(tick)
        return
      }

      const effectiveThreshold = settings.silenceThreshold
        * (settings.playbackActive ? playbackThresholdMultiplier : 1)
      const hasVoice = nextVolume >= effectiveThreshold

      if (hasVoice) {
        silenceStartedAtRef.current = null
        if (!isVoiceActiveRef.current) {
          speechStartedAtRef.current ??= now
          if (!speechPrimedRef.current && callbacksRef.current.canStartSpeech?.() !== false) {
            speechPrimeStartedAtRef.current ??= now
            if (!speechSessionStartedRef.current) {
              speechSessionStartedRef.current = true
              callbacksRef.current.onSpeechPrime?.()
            }
            if (now - speechPrimeStartedAtRef.current >= settings.speechPrimeDelayMs) {
              if (!speechPrimedRef.current) {
                speechPrimedRef.current = true
                primedStreamingRef.current = true
                pcmWorkletRef.current?.port.postMessage({ type: 'flush_preroll' })
              }
            }
          }
          if (now - speechStartedAtRef.current >= settings.speechStartDelayMs) {
            if (callbacksRef.current.canStartSpeech?.() === false) {
              speechStartedAtRef.current = now
            } else if (startRecorder()) {
              isVoiceActiveRef.current = true
              speechStartedAtRef.current = null
              speechPrimedRef.current = false
              primedStreamingRef.current = false
              callbacksRef.current.onSpeechStart?.()
            }
          }
        }
      } else {
        if (!isVoiceActiveRef.current) {
          speechPrimeStartedAtRef.current = null
          speechSessionStartedRef.current = false
          if (speechPrimedRef.current) {
            speechPrimedRef.current = false
            primedStreamingRef.current = false
            callbacksRef.current.onSpeechPrimeCancel?.()
          }
        }
        speechStartedAtRef.current = null
        if (isVoiceActiveRef.current) {
          silenceStartedAtRef.current ??= now
          if (now - silenceStartedAtRef.current >= settings.speechEndDelayMs) finishRecording()
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [finishRecording, mockMode, startRecorder])

  useEffect(() => stop, [stop])

  const isSupported = typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    && (mockMode || Boolean(navigator.mediaDevices?.getUserMedia))

  return {
    beginManualRecording,
    error,
    finishRecording,
    isListening,
    isRecording,
    isSupported,
    setMockVolume,
    start,
    stop,
    suppressFor,
    volume,
  }
}
