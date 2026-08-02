import { useCallback, useEffect, useRef, useState } from 'react'

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function useMediaRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const isSupported = typeof window !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined'

  const stop = useCallback(() => new Promise<Blob | null>((resolve) => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      stopStream(streamRef.current)
      streamRef.current = null
      setIsRecording(false)
      resolve(null)
      return
    }

    stopResolverRef.current = resolve
    recorder.stop()
  }), [])

  const start = useCallback(async () => {
    if (!isSupported || recorderRef.current?.state === 'recording') return

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    try {
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        throw new Error('当前浏览器不支持 audio/webm 录音')
      }
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        stopStream(stream)
        streamRef.current = null
        recorderRef.current = null
        setIsRecording(false)
        stopResolverRef.current?.(null)
        stopResolverRef.current = null
      }
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null
        chunksRef.current = []
        stopStream(stream)
        streamRef.current = null
        recorderRef.current = null
        setIsRecording(false)
        stopResolverRef.current?.(blob)
        stopResolverRef.current = null
      }
      recorderRef.current = recorder
      streamRef.current = stream
      recorder.start()
      setIsRecording(true)
    } catch (error) {
      stopStream(stream)
      throw error
    }
  }, [isSupported])

  useEffect(() => () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stopStream(streamRef.current)
    streamRef.current = null
  }, [])

  return { start, stop, isRecording, isSupported }
}
