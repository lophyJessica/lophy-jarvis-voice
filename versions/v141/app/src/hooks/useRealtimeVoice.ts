import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiBase } from '../api/base'
import { JARVIS_TOKEN_KEY } from '../auth'

export type RealtimeVoicePhase = 'idle' | 'connecting' | 'connected' | 'speaking' | 'error'

interface RealtimeVoiceState {
  phase: RealtimeVoicePhase
  transcript: string
  error: string | null
}

interface RealtimeEvent {
  type?: unknown
  event?: unknown
  code?: unknown
  event_code?: unknown
  eventCode?: unknown
  text?: unknown
  transcript?: unknown
  content?: unknown
  data?: unknown
  [key: string]: unknown
}

const CAPTURE_BATCH_BYTES = 3_200
const OUTPUT_SAMPLE_RATE = 24_000
let activeRealtimeSession: { owner: symbol; stop: () => void } | null = null

function getWebSocketUrl() {
  const token = encodeURIComponent(localStorage.getItem(JARVIS_TOKEN_KEY) ?? '')
  const suffix = `?token=${token}`
  const apiBase = getApiBase()
  if (apiBase) return `${apiBase.replace(/^http/i, 'ws')}/p/jarvis/realtime${suffix}`
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/p/jarvis/realtime${suffix}`
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function disconnect(node: AudioNode | null) {
  try {
    node?.disconnect()
  } catch {
    return
  }
}

function audioContextConstructor() {
  return window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

function eventValue(payload: RealtimeEvent, keys: string[]) {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number') return value
  }
  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data as Record<string, unknown>
    for (const key of keys) {
      const value = nested[key]
      if (typeof value === 'string' || typeof value === 'number') return value
    }
  }
  return null
}

function isInterruption(payload: RealtimeEvent) {
  const eventType = String(payload.type ?? payload.event ?? '').toLowerCase()
  const eventCode = eventValue(payload, ['event_code', 'eventCode', 'code', 'event'])
  return eventType === 'asrinfo' || eventType.includes('asrinfo') || Number(eventCode) === 450
}

function eventText(payload: RealtimeEvent) {
  const value = eventValue(payload, ['text', 'transcript', 'content'])
  return value == null ? '' : String(value).trim()
}

export function useRealtimeVoice() {
  const [state, setState] = useState<RealtimeVoiceState>({ phase: 'idle', transcript: '', error: null })
  const ownerRef = useRef(Symbol('robin-realtime-voice'))
  const activeRef = useRef(false)
  const sessionRef = useRef(0)
  const socketRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureContextRef = useRef<AudioContext | null>(null)
  const playbackContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const sinkRef = useRef<GainNode | null>(null)
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const nextPlaybackTimeRef = useRef(0)

  const stopPlayback = useCallback(() => {
    const context = playbackContextRef.current
    for (const source of playbackSourcesRef.current) {
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    playbackSourcesRef.current.clear()
    nextPlaybackTimeRef.current = context?.currentTime ?? 0
    if (activeRef.current) setState((current) => current.phase === 'speaking' ? { ...current, phase: 'connected' } : current)
  }, [])

  const playPcm = useCallback((frame: ArrayBuffer) => {
    const context = playbackContextRef.current
    if (!context || frame.byteLength < 4 || frame.byteLength % 4 !== 0) return
    const samples = new Float32Array(frame)
    const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const startAt = Math.max(context.currentTime + 0.015, nextPlaybackTimeRef.current)
    nextPlaybackTimeRef.current = startAt + buffer.duration
    playbackSourcesRef.current.add(source)
    source.onended = () => {
      playbackSourcesRef.current.delete(source)
      source.disconnect()
      if (activeRef.current && playbackSourcesRef.current.size === 0) {
        setState((current) => current.phase === 'speaking' ? { ...current, phase: 'connected' } : current)
      }
    }
    source.start(startAt)
    setState((current) => current.phase === 'connected' ? { ...current, phase: 'speaking' } : current)
  }, [])

  const stop = useCallback(() => {
    if (activeRealtimeSession?.owner === ownerRef.current) activeRealtimeSession = null
    sessionRef.current += 1
    activeRef.current = false
    stopPlayback()
    const socket = socketRef.current
    socketRef.current = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client-stop')
    disconnect(workletRef.current)
    disconnect(sinkRef.current)
    disconnect(sourceRef.current)
    workletRef.current = null
    sinkRef.current = null
    sourceRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    void captureContextRef.current?.close()
    void playbackContextRef.current?.close()
    captureContextRef.current = null
    playbackContextRef.current = null
    setState({ phase: 'idle', transcript: '', error: null })
  }, [stopPlayback])

  const start = useCallback(async () => {
    if (activeRef.current) return
    const AudioContextConstructor = audioContextConstructor()
    if (!AudioContextConstructor || !navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined') {
      throw new Error('当前环境不支持实时语音对话')
    }
    activeRealtimeSession?.stop()
    activeRealtimeSession = { owner: ownerRef.current, stop }
    const sessionId = sessionRef.current + 1
    sessionRef.current = sessionId
    activeRef.current = true
    setState({ phase: 'connecting', transcript: '', error: null })
    let stream: MediaStream | null = null
    let captureContext: AudioContext | null = null
    let playbackContext: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let worklet: AudioWorkletNode | null = null
    let sink: GainNode | null = null
    let socket: WebSocket | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!activeRef.current || sessionRef.current !== sessionId) { stopStream(stream); return }
      captureContext = new AudioContextConstructor({ sampleRate: 16_000 })
      playbackContext = new AudioContextConstructor({ sampleRate: OUTPUT_SAMPLE_RATE })
      await Promise.all([captureContext.resume(), playbackContext.resume()])
      source = captureContext.createMediaStreamSource(stream)
      if (!captureContext.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('当前浏览器不支持 AudioWorklet 实时采集')
      await captureContext.audioWorklet.addModule(new URL('pcm-capture-worklet.js', document.baseURI).toString())
      worklet = new AudioWorkletNode(captureContext, 'jarvis-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      sink = captureContext.createGain()
      sink.gain.value = 0
      source.connect(worklet)
      worklet.connect(sink)
      sink.connect(captureContext.destination)
      socket = new WebSocket(getWebSocketUrl())
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        if (!activeRef.current || sessionRef.current !== sessionId || !socket) { socket?.close(1000, 'stale-session'); return }
        socketRef.current = socket
        worklet?.port.postMessage({ type: 'config', batchBytes: CAPTURE_BATCH_BYTES })
        worklet?.port.postMessage({ type: 'start' })
        setState((current) => ({ ...current, phase: 'connected' }))
      }
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) { playPcm(event.data); return }
        if (event.data instanceof Blob) { void event.data.arrayBuffer().then(playPcm); return }
        if (typeof event.data !== 'string') return
        try {
          const payload = JSON.parse(event.data) as RealtimeEvent
          if (isInterruption(payload)) stopPlayback()
          const text = eventText(payload)
          if (text) setState((current) => ({ ...current, transcript: text }))
        } catch { return }
      }
      socket.onerror = () => {
        if (activeRef.current && sessionRef.current === sessionId) setState((current) => ({ ...current, phase: 'error', error: '实时语音连接失败' }))
      }
      socket.onclose = () => {
        if (!activeRef.current || sessionRef.current !== sessionId) return
        activeRef.current = false
        setState((current) => ({ ...current, phase: 'error', error: '实时语音连接已断开' }))
      }
      worklet.port.onmessage = (event: MessageEvent<{ type?: string; buffer?: ArrayBuffer }>) => {
        if (event.data?.type === 'pcm' && event.data.buffer && socket?.readyState === WebSocket.OPEN) socket.send(event.data.buffer)
      }
      streamRef.current = stream
      captureContextRef.current = captureContext
      playbackContextRef.current = playbackContext
      sourceRef.current = source
      workletRef.current = worklet
      sinkRef.current = sink
      socketRef.current = socket
    } catch (error) {
      activeRef.current = false
      if (activeRealtimeSession?.owner === ownerRef.current) activeRealtimeSession = null
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
      disconnect(worklet)
      disconnect(sink)
      disconnect(source)
      stopStream(stream)
      void captureContext?.close()
      void playbackContext?.close()
      setState({ phase: 'error', transcript: '', error: error instanceof Error ? error.message : '实时语音启动失败' })
      throw error
    }
  }, [playPcm, stop, stopPlayback])

  useEffect(() => stop, [stop])
  return { ...state, start, stop, stopPlayback }
}
