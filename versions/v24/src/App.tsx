import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type UIEvent } from 'react'
import {
  AudioOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LoadingOutlined,
  LogoutOutlined,
  PictureOutlined,
  SendOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { App as AntApp, Button, Card, ConfigProvider, Empty, Input, Slider, Switch, Tag, Tooltip, Typography, theme } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import {
  clearJarvisAuth,
  getJarvisToken,
  JARVIS_USERNAME_KEY,
  setUnauthorizedHandler,
} from './auth'
import {
  checkHermesConnection,
  defaultSystemPrompt,
  HermesError,
  streamChatCompletion,
  type ChatMessage,
} from './api/hermes'
import { clearCloudHistory, loadCloudHistory, saveCloudHistory } from './api/history'
import {
  collectClipboardFiles,
  isDocumentFile,
  isImageFile,
  MAX_DOCUMENT_BYTES,
  type PendingDocument,
  uploadJarvisFile,
} from './api/docUpload'
import {
  clearLocalMessages,
  createStoredMessage,
  getLocalMessages,
  mergeMessages,
  replaceLocalMessages,
  toChatHistory,
  type StoredMessage,
} from './db'
import JarvisCore, { type JarvisStatus } from './components/JarvisCore'
import LoginPage from './components/LoginPage'
import ChatMessageRow from './components/ChatMessageRow'
import { MessageRichContent } from './components/MessageRichContent'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { useStreamingAsr } from './hooks/useStreamingAsr'
import { useVoiceActivityDetector } from './hooks/useVoiceActivityDetector'
import { copyTextToClipboard } from './utils/clipboard'
import { readImageFiles } from './utils/images'
import { cleanSpeechText } from './utils/ttsSentences'
import { buildComposerMessageContent, buildMessageContent, getMessageText } from './types/messages'
import './App.css'

type ConnectionState = 'checking' | 'online' | 'offline'
type HistorySyncState = 'syncing' | 'synced' | 'fallback'
type InputMode = 'text' | 'voice'

const systemPrompt = defaultSystemPrompt
const assistantName = '罗宾'
const modeStorageKey = 'robin-mode'
const ttsAutoPlayStorageKey = 'robin-tts-autoplay'
const maxSavedMessages = 200

function readTtsAutoPlay() {
  return localStorage.getItem(ttsAutoPlayStorageKey) !== '0'
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatMessageDisplayTime(createdAt: string) {
  const parsed = Date.parse(createdAt)
  if (Number.isNaN(parsed)) return '--:--'
  return timeFormatter.format(new Date(parsed))
}

function readStoredMode(): InputMode {
  return localStorage.getItem(modeStorageKey) === 'voice' ? 'voice' : 'text'
}

function statusLabel(status: JarvisStatus) {
  return {
    idle: '监听中',
    recording: '录音中',
    transcribing: '识别中…',
    thinking: '思考中',
    speaking: '播报中',
  }[status]
}

function VoiceConsole({ username, onLogout, isDev }: { username: string; onLogout: () => void; isDev: boolean }) {
  const { message: messageApi } = AntApp.useApp()
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
  const [docUploads, setDocUploads] = useState<Array<{ id: string; filename: string }>>([])
  const [transcript, setTranscript] = useState('')
  const [streamingTranscript, setStreamingTranscript] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<JarvisStatus>('idle')
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [historySyncState, setHistorySyncState] = useState<HistorySyncState>('syncing')
  const [copiedKey, setCopiedKey] = useState('')
  const [autoMode, setAutoMode] = useState(true)
  const [vadThreshold, setVadThreshold] = useState(0.03)
  const [mode, setMode] = useState<InputMode>(() => readStoredMode())
  const [ttsAutoPlay, setTtsAutoPlay] = useState(() => readTtsAutoPlay())
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set())
  const qaMode = useMemo(() => {
    const hostname = window.location.hostname
    return (hostname === 'localhost' || hostname === '127.0.0.1')
      && new URLSearchParams(window.location.search).has('vad-qa')
  }, [])
  const messageListRef = useRef<HTMLElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const activeRequestRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const historyRef = useRef(history)
  const historyInitializedRef = useRef(false)
  const statusRef = useRef<JarvisStatus>('idle')
  const autoModeRef = useRef(autoMode)
  const modeRef = useRef(mode)
  const ttsAutoPlayRef = useRef(ttsAutoPlay)
  const suppressVadRef = useRef<(durationMs: number) => void>(() => undefined)
  const copyResetTimerRef = useRef(0)
  const inputTextAreaRef = useRef<TextAreaRef>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    speak,
    beginStreamingSpeech,
    appendStreamingSpeechText,
    endStreamingSpeech,
    waitForSpeechDrain,
    cancel: cancelSpeech,
    isSpeaking,
    isSupported: synthesisSupported,
  } = useSpeechSynthesis()
  const {
    enqueueChunk: enqueueStreamingAsrChunk,
    finishSession: finishStreamingAsr,
    startSession: startStreamingAsr,
  } = useStreamingAsr({ onInterimText: setStreamingTranscript })

  const transitionTo = useCallback((nextStatus: JarvisStatus) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const writeClipboard = useCallback(async (text: string, sourceElement?: HTMLTextAreaElement | null) => {
    if (!text.trim()) {
      void messageApi.info('无可复制内容')
      return false
    }
    try {
      if (!await copyTextToClipboard(text, sourceElement)) throw new Error('Clipboard write was rejected')
      void messageApi.success('已复制')
      return true
    } catch {
      void messageApi.error('复制失败，请检查剪贴板权限')
      return false
    }
  }, [messageApi])

  const copyText = useCallback(async (text: string, key: string, sourceElement?: HTMLTextAreaElement | null) => {
    if (!await writeClipboard(text, sourceElement)) return
    window.clearTimeout(copyResetTimerRef.current)
    setCopiedKey(key)
    copyResetTimerRef.current = window.setTimeout(() => setCopiedKey(''), 2_000)
  }, [writeClipboard])

  const toggleMessageExpanded = useCallback((id: string) => {
    setExpandedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const stopSpeaking = useCallback(() => {
    cancelSpeech()
    if (statusRef.current === 'speaking') transitionTo('idle')
  }, [cancelSpeech, transitionTo])

  const stopCurrentTurn = useCallback(() => {
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    cancelSpeech()
    setStreamingText('')
    transitionTo('idle')
  }, [cancelSpeech, transitionTo])

  // Cloud sync only (Robin). Local Dexie cache is written by the messages-change effect
  // so that every rendered message (in exact order) survives a refresh.
  const persistTurn = useCallback(async (nextMessages: StoredMessage[]) => {
    try {
      await saveCloudHistory(nextMessages)
      setHistorySyncState('synced')
    } catch (historyError) {
      console.error('Robin history upload failed', historyError)
      setHistorySyncState('fallback')
    }
  }, [])

  const sendMessage = useCallback(async (overrideText?: string, overrideImages?: string[], overrideDocuments?: PendingDocument[]) => {
    const images = overrideImages ?? pendingImages
    const documents = overrideDocuments ?? pendingDocuments
    const userInstruction = (overrideText ?? input).trim()

    if (documents.length > 0 && !userInstruction) {
      void messageApi.info('请输入你想让我对这份文档做什么')
      return
    }
    if (!userInstruction && images.length === 0 && documents.length === 0) {
      transitionTo('idle')
      return
    }
    if (!historyInitializedRef.current) {
      transitionTo('idle')
      void messageApi.info('历史记录同步中，请稍候')
      return
    }

    cancelSpeech()
    setInput('')
    setPendingImages([])
    setPendingDocuments([])
    setStreamingText('')

    const content = documents.length > 0
      ? buildComposerMessageContent(userInstruction, images, documents)
      : buildMessageContent(userInstruction, images)
    const userMessage = createStoredMessage('user', content)
    const messagesBeforeTurn = messagesRef.current
    const pendingMessages = [...messagesBeforeTurn, userMessage].slice(-maxSavedMessages)
    messagesRef.current = pendingMessages
    setMessages(pendingMessages)
    transitionTo('thinking')

    const requestController = new AbortController()
    activeRequestRef.current = requestController
    let responseText = ''
    const shouldStreamTts = synthesisSupported && (modeRef.current === 'voice' || ttsAutoPlayRef.current)
    if (shouldStreamTts) {
      beginStreamingSpeech(() => {
        transitionTo('speaking')
        suppressVadRef.current(200)
      })
    }

    try {
      responseText = await streamChatCompletion(
        [{ role: userMessage.role, content: userMessage.content }],
        (delta) => {
          responseText += delta
          setStreamingText(responseText)
          if (shouldStreamTts) appendStreamingSpeechText(delta)
        },
        requestController.signal,
        systemPrompt,
        historyRef.current,
      )
      if (!responseText.trim()) throw new HermesError('罗宾返回了空回复', 'network')

      const assistantMessage = createStoredMessage('assistant', responseText)
      const nextMessages = [...pendingMessages, assistantMessage].slice(-maxSavedMessages)
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      setHistory(toChatHistory(nextMessages))
      setStreamingText('')
      setConnectionState('online')
      await persistTurn(nextMessages)

      if (shouldStreamTts) {
        endStreamingSpeech()
        await waitForSpeechDrain()
      }
      if (statusRef.current !== 'recording' && statusRef.current !== 'transcribing') {
        transitionTo('idle')
      }
    } catch (error) {
      if (requestController.signal.aborted) {
        if (shouldStreamTts) cancelSpeech()
        return
      }
      if (error instanceof HermesError && error.kind === 'unauthorized') {
        transitionTo('idle')
        return
      }
      const fallback = error instanceof HermesError ? error.message : '罗宾暂时不可用，请稍后再试'
      setStreamingText('')
      if (error instanceof HermesError) setConnectionState('offline')
      const errorMessages = [...messagesRef.current, createStoredMessage('assistant', fallback)].slice(-maxSavedMessages)
      messagesRef.current = errorMessages
      setMessages(errorMessages)
      transitionTo('idle')
      void messageApi.error(fallback)
      if (shouldStreamTts) cancelSpeech()
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = null
    }
  }, [appendStreamingSpeechText, beginStreamingSpeech, cancelSpeech, endStreamingSpeech, input, messageApi, pendingDocuments, pendingImages, persistTurn, synthesisSupported, transitionTo, waitForSpeechDrain])

  const handleVadSpeechStart = useCallback(() => {
    if (statusRef.current === 'speaking') cancelSpeech()
    if (statusRef.current === 'thinking') {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    startStreamingAsr()
    transitionTo('recording')
  }, [cancelSpeech, startStreamingAsr, transitionTo])

  const handleVadSpeechEnd = useCallback(() => {
    if (statusRef.current === 'recording') transitionTo('transcribing')
  }, [transitionTo])

  const processRecording = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      transitionTo('idle')
      void messageApi.info('没有录到有效音频，请再试一次')
      return
    }
    try {
      const { text } = await finishStreamingAsr(blob)
      setStreamingTranscript('')
      setTranscript(text)
      if (!text) {
        transitionTo('idle')
        void messageApi.info('没有识别到语音，请再试一次')
        return
      }
      try {
        await sendMessage(text, [])
      } finally {
        setTranscript('')
      }
    } catch (error) {
      const fallback = error instanceof HermesError ? error.message : '录音处理失败，请重试'
      transitionTo('idle')
      void messageApi.error(fallback)
    }
  }, [finishStreamingAsr, messageApi, sendMessage, transitionTo])

  const canVadStartSpeech = useCallback(() => (
    modeRef.current === 'voice'
      && autoModeRef.current
      && (statusRef.current === 'idle' || statusRef.current === 'speaking')
  ), [])

  const {
    beginManualRecording,
    error: vadError,
    finishRecording,
    isListening: vadListening,
    isSupported: vadSupported,
    setMockVolume,
    start: startVad,
    stop: stopVad,
    suppressFor,
    volume: vadVolume,
  } = useVoiceActivityDetector({
    enabled: mode === 'voice' && autoMode,
    mockMode: qaMode,
    playbackActive: isSpeaking,
    silenceThreshold: vadThreshold,
    canStartSpeech: canVadStartSpeech,
    onSpeechStart: handleVadSpeechStart,
    onSpeechEnd: handleVadSpeechEnd,
    onRecordingChunk: enqueueStreamingAsrChunk,
    onRecordingComplete: processRecording,
  })

  const handleVoiceButton = useCallback(() => {
    if (statusRef.current === 'recording') {
      finishRecording()
      return
    }
    if (statusRef.current === 'speaking') {
      stopSpeaking()
      return
    }
    if (statusRef.current === 'idle' && !autoModeRef.current && !beginManualRecording()) {
      void messageApi.warning('麦克风尚未就绪')
    }
  }, [beginManualRecording, finishRecording, messageApi, stopSpeaking])

  const enterVoiceMode = useCallback(() => {
    if (!vadSupported) {
      void messageApi.warning('当前浏览器不支持麦克风录音')
      return
    }
    modeRef.current = 'voice'
    setMode('voice')
    localStorage.setItem(modeStorageKey, 'voice')
    transitionTo('idle')
    startVad().catch((error: unknown) => {
      const fallback = error instanceof Error ? error.message : '麦克风监听启动失败'
      void messageApi.warning(fallback)
    })
  }, [messageApi, startVad, transitionTo, vadSupported])

  const exitVoiceMode = useCallback(() => {
    modeRef.current = 'text'
    setMode('text')
    localStorage.setItem(modeStorageKey, 'text')
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    cancelSpeech()
    stopVad()
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    transitionTo('idle')
  }, [cancelSpeech, stopVad, transitionTo])

  const appendImages = useCallback(async (files: FileList | File[]) => {
    try {
      const dataUrls = await readImageFiles(files)
      if (dataUrls.length > 0) setPendingImages((current) => [...current, ...dataUrls])
    } catch {
      void messageApi.error('图片处理失败，请重试')
    }
  }, [messageApi])

  const processDocumentPaste = useCallback(async (files: File[]) => {
    for (const file of files) {
      if (!isDocumentFile(file)) continue
      if (file.size > MAX_DOCUMENT_BYTES) {
        void messageApi.error(`文件过大（>${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB）：${file.name}`)
        continue
      }

      const uploadId = crypto.randomUUID()
      setDocUploads((current) => [...current, { id: uploadId, filename: file.name }])
      try {
        const result = await uploadJarvisFile(file, username)
        setPendingDocuments((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            filename: result.filename,
            path: result.path,
          },
        ])
      } catch (error) {
        const fallback = error instanceof Error ? error.message : '文件上传失败，请重试'
        void messageApi.error(fallback)
      } finally {
        setDocUploads((current) => current.filter((item) => item.id !== uploadId))
      }
    }
  }, [messageApi, username])

  const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    const clipboardFiles = items ? collectClipboardFiles(items) : []
    const legacyFiles = event.clipboardData?.files ? Array.from(event.clipboardData.files) : []
    const allFiles = clipboardFiles.length > 0 ? clipboardFiles : legacyFiles
    if (allFiles.length === 0) return

    const imageFiles = allFiles.filter(isImageFile)
    const documentFiles = allFiles.filter(isDocumentFile)
    if (imageFiles.length === 0 && documentFiles.length === 0) return

    event.preventDefault()
    if (imageFiles.length > 0) void appendImages(imageFiles)
    if (documentFiles.length > 0) void processDocumentPaste(documentFiles)
  }, [appendImages, processDocumentPaste])

  // Mount: hydrate history from cloud, fall back to Dexie local cache on failure.
  useEffect(() => {
    let active = true
    setHistorySyncState('syncing')
    ;(async () => {
      try {
        const [server, local] = await Promise.all([loadCloudHistory(maxSavedMessages), getLocalMessages()])
        if (!active) return
        const merged = mergeMessages(local, server).slice(-maxSavedMessages)
        messagesRef.current = merged
        setMessages(merged)
        setHistory(toChatHistory(merged))
        historyInitializedRef.current = true
        setHistorySyncState('synced')
        try {
          await replaceLocalMessages(merged)
        } catch (dbError) {
          console.error('Robin local cache sync failed', dbError)
        }
      } catch (historyError) {
        if (!active) return
        console.warn('Robin cloud history unavailable; restoring from Dexie', historyError)
        const local = await getLocalMessages().catch(() => [])
        if (!active) return
        messagesRef.current = local
        setMessages(local)
        setHistory(toChatHistory(local))
        historyInitializedRef.current = true
        setHistorySyncState('fallback')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    checkHermesConnection().then((online) => {
      if (active) setConnectionState(online ? 'online' : 'offline')
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    autoModeRef.current = autoMode
  }, [autoMode])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    ttsAutoPlayRef.current = ttsAutoPlay
    localStorage.setItem(ttsAutoPlayStorageKey, ttsAutoPlay ? '1' : '0')
  }, [ttsAutoPlay])

  useEffect(() => {
    suppressVadRef.current = suppressFor
  }, [suppressFor])

  // Voice capture only runs in voice mode; text mode keeps the mic released.
  useEffect(() => {
    if (mode !== 'voice') return
    let active = true
    startVad().catch((error: unknown) => {
      if (!active) return
      const fallback = error instanceof Error ? error.message : '麦克风监听启动失败'
      void messageApi.warning(fallback)
    })
    return () => {
      active = false
      stopVad()
    }
  }, [messageApi, mode, startVad, stopVad])

  useEffect(() => {
    if (vadError) void messageApi.warning(vadError)
  }, [messageApi, vadError])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Persist every rendered message to Dexie (id/role/content/createdAt, original order)
  // once history has hydrated, so an offline refresh restores the exact list & timestamps.
  useEffect(() => {
    if (!historyInitializedRef.current) return
    void replaceLocalMessages(messages).catch((dbError) => {
      console.error('Robin local cache write failed', dbError)
    })
  }, [messages])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useLayoutEffect(() => {
    const messageList = messageListRef.current
    if (!messageList || !shouldAutoScrollRef.current) return
    messageList.scrollTop = messageList.scrollHeight
  }, [messages, streamingText])

  useEffect(() => {
    if (status === 'speaking' && !isSpeaking) transitionTo('idle')
  }, [isSpeaking, status, transitionTo])

  useEffect(() => () => {
    activeRequestRef.current?.abort()
    cancelSpeech()
    stopVad()
    window.clearTimeout(copyResetTimerRef.current)
  }, [cancelSpeech, stopVad])

  const clearConversation = useCallback(async () => {
    cancelSpeech()
    if (statusRef.current === 'speaking') transitionTo('idle')
    shouldAutoScrollRef.current = true
    messagesRef.current = []
    setMessages([])
    setHistory([])
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    setExpandedMessageIds(new Set())
    try {
      await clearLocalMessages()
    } catch (dbError) {
      console.error('Robin local cache clear failed', dbError)
    }
    if (!historyInitializedRef.current) return
    try {
      await clearCloudHistory()
      setHistorySyncState('synced')
    } catch (historyError) {
      console.error('Robin history clear failed', historyError)
      setHistorySyncState('fallback')
    }
  }, [cancelSpeech, transitionTo])

  const handleMessageScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const messageList = event.currentTarget
    const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom <= 72
  }, [])

  const lastAssistantText = useMemo(() => {
    const last = [...messages].reverse().find((message) => message.role === 'assistant')
    return last ? getMessageText(last.content) : ''
  }, [messages])

  const replayableSpeechText = useMemo(
    () => cleanSpeechText(streamingText || lastAssistantText),
    [streamingText, lastAssistantText],
  )
  const canReplaySpeech = synthesisSupported
    && replayableSpeechText.length > 0
    && status !== 'thinking'
    && status !== 'transcribing'

  const replayAssistantSpeech = useCallback(async () => {
    if (!replayableSpeechText || !synthesisSupported) {
      void messageApi.info('暂无可朗读内容')
      return
    }
    cancelSpeech()
    transitionTo('speaking')
    try {
      await speak(replayableSpeechText, () => suppressVadRef.current(200))
    } finally {
      if (statusRef.current === 'speaking') transitionTo('idle')
    }
  }, [cancelSpeech, messageApi, replayableSpeechText, speak, synthesisSupported, transitionTo])

  const handleHeaderSpeechClick = useCallback(() => {
    if (status === 'thinking') {
      stopCurrentTurn()
      return
    }
    if (status === 'speaking' || isSpeaking) {
      stopSpeaking()
      return
    }
    void replayAssistantSpeech()
  }, [isSpeaking, replayAssistantSpeech, status, stopCurrentTurn, stopSpeaking])

  const isVoiceMode = mode === 'voice'
  const isThinking = status === 'thinking'
  const canStopCurrentTurn = status === 'thinking' || status === 'speaking'
  const headerSpeechStopping = canStopCurrentTurn || isSpeaking
  const hasInputText = input.trim().length > 0
  const canSendComposer = hasInputText || pendingImages.length > 0
  const docParsingInProgress = docUploads.length > 0
  const primaryAction: 'send' | 'voice' | 'close' = canSendComposer ? 'send' : isVoiceMode ? 'close' : 'voice'
  const primaryDisabled = primaryAction === 'send'
    && (historySyncState === 'syncing' || isThinking || status === 'transcribing' || docParsingInProgress)

  const visibleStatusText = status === 'idle'
    ? vadListening
      ? autoMode ? '监听中' : '手动待机'
      : isVoiceMode ? '等待麦克风' : '待命中'
    : statusLabel(status)
  const normalizedVolume = Math.min(1, vadVolume / Math.max(vadThreshold * 2, 0.001))
  const connectionTag = {
    checking: { color: 'processing', icon: <LoadingOutlined />, text: 'Hermes 检测中' },
    online: { color: 'success', icon: <CheckCircleOutlined />, text: 'Hermes 在线' },
    offline: { color: 'error', icon: <CloseCircleOutlined />, text: 'Hermes 离线' },
  }[connectionState]
  const historySyncTag = {
    syncing: { color: 'processing', text: '同步中…' },
    synced: { color: 'success', text: '云端已同步' },
    fallback: { color: 'warning', text: '本地兜底' },
  }[historySyncState]

  const primaryButton = (() => {
    if (primaryAction === 'send') {
      return (
        <Button
          type="primary"
          shape="circle"
          data-testid="composer-primary-button"
          data-state="send"
          icon={<SendOutlined />}
          onClick={() => void sendMessage()}
          loading={isThinking}
          disabled={primaryDisabled}
          aria-label="发送消息"
        />
      )
    }
    if (primaryAction === 'close') {
      return (
        <Button
          shape="circle"
          data-testid="composer-primary-button"
          data-state="close"
          icon={<CloseOutlined />}
          onClick={() => {
            if (statusRef.current === 'speaking' || statusRef.current === 'thinking' || isSpeaking) {
              stopCurrentTurn()
            }
            exitVoiceMode()
          }}
          aria-label="退出语音模式"
        />
      )
    }
    return (
      <Button
        type="primary"
        shape="circle"
        data-testid="composer-primary-button"
        data-state="voice"
        icon={<AudioOutlined />}
        onClick={enterVoiceMode}
        aria-label="切换语音模式"
      />
    )
  })()

  return (
    <main className="jarvis-shell">
      <section className="core-panel">
        <div className="brand-lockup">
          <span className="brand-mark" />
          <div>
            <Typography.Title level={4}>ROBIN</Typography.Title>
            <Typography.Text>个人 AI 助手 · 语音 / 文字</Typography.Text>
          </div>
        </div>
        <div className={`status-readout status-${status}`}>
          <span className="status-dot" />
          <span className="status-label" data-testid="voice-status">{visibleStatusText}</span>
          {(status === 'thinking' || status === 'transcribing') && <span className="thinking-dots"><i /><i /><i /></span>}
        </div>
        <JarvisCore status={status} />
        {isVoiceMode && (
          <div className="voice-control">
            <button
              type="button"
              data-testid="voice-control-button"
              className={`voice-button voice-button-${status} ${status === 'idle' && vadListening && autoMode ? 'voice-button-listening' : ''}`}
              onClick={handleVoiceButton}
              disabled={status === 'transcribing' || status === 'thinking' || (status === 'idle' && autoMode)}
              aria-label={status === 'recording' ? '停止录音' : status === 'speaking' ? '停止播报' : autoMode ? '自动监听中' : '开始录音'}
            >
              {status === 'recording' ? <StopOutlined /> : status === 'speaking' ? <SoundOutlined /> : status === 'idle' ? <AudioOutlined /> : <LoadingOutlined />}
            </button>
            <span className="voice-hint">
              {status === 'idle'
                ? autoMode ? '直接说话即可' : '点击开始录音'
                : status === 'recording' ? '说完后自动识别' : statusLabel(status)}
            </span>
          </div>
        )}
        <div className="core-footer">
          <div className="core-tags">
            <Tag icon={connectionTag.icon} color={connectionTag.color}>{connectionTag.text}</Tag>
            <Tag icon={<AudioOutlined />} color={isVoiceMode ? (vadListening ? 'processing' : 'default') : 'default'}>
              {isVoiceMode ? (vadListening ? (autoMode ? 'VAD 监听中' : '手动模式') : vadSupported ? '等待麦克风' : '麦克风不可用') : '文字模式'}
            </Tag>
          </div>
          <span>CORE / {status.toUpperCase()}</span>
        </div>
      </section>

      <Card className="conversation-panel" variant="borderless">
        <header className="conversation-header">
          <div>
            <Typography.Title level={4}>与罗宾对话</Typography.Title>
            <Typography.Text type="secondary">{username || 'Robin'} · {isVoiceMode ? '语音实时 · 百度 ASR / Edge TTS' : '文字思考 · 支持图片'}</Typography.Text>
          </div>
          <div className="conversation-actions">
            <Tag data-testid="history-sync-status" icon={<CloudSyncOutlined />} color={historySyncTag.color}>
              {historySyncTag.text}
            </Tag>
            <Tooltip title="清除对话">
              <Button
                type="text"
                shape="circle"
                icon={<DeleteOutlined />}
                onClick={() => void clearConversation()}
                disabled={messages.length === 0 && !streamingText}
                aria-label="清除对话"
              />
            </Tooltip>
            <Tooltip title={
              !synthesisSupported
                ? '浏览器不支持音频播放'
                : headerSpeechStopping
                  ? (status === 'thinking' ? '停止当前回合' : '停止播报')
                  : ttsAutoPlay
                    ? '朗读上一条回复（回复后自动朗读已开启）'
                    : '朗读上一条回复'
            }>
              <Button
                data-testid="stop-current-turn-header"
                type="text"
                shape="circle"
                danger={headerSpeechStopping}
                icon={headerSpeechStopping ? <StopOutlined /> : <SoundOutlined />}
                onClick={(event) => {
                  if (event.shiftKey) {
                    setTtsAutoPlay((current) => {
                      const next = !current
                      void messageApi.info(next ? '已开启回复后自动朗读' : '已关闭回复后自动朗读')
                      return next
                    })
                    return
                  }
                  handleHeaderSpeechClick()
                }}
                disabled={!synthesisSupported || (!headerSpeechStopping && !canReplaySpeech)}
                aria-label={headerSpeechStopping ? '停止播报' : '朗读回复'}
                aria-pressed={ttsAutoPlay}
              />
            </Tooltip>
            {!isDev && (
              <Tooltip title={`退出登录（${username}）`}>
                <Button type="text" shape="circle" icon={<LogoutOutlined />} onClick={onLogout} aria-label="退出登录" />
              </Tooltip>
            )}
          </div>
        </header>

        {isVoiceMode && (
          <section className="voice-settings" aria-label="语音检测设置">
            <div className="mode-setting">
              <div>
                <span className="setting-title">对话模式</span>
                <span className="setting-description">{autoMode ? '说话即回复，可随时打断' : '点击中央按钮录音'}</span>
              </div>
              <Switch
                checked={autoMode}
                onChange={(checked) => {
                  autoModeRef.current = checked
                  setAutoMode(checked)
                }}
                checkedChildren="自动"
                unCheckedChildren="手动"
                aria-label="自动语音模式"
              />
            </div>
            <div className="threshold-setting">
              <div className="threshold-heading">
                <span className="setting-title">VAD 灵敏度</span>
                <code>{vadThreshold.toFixed(3)}</code>
              </div>
              <Slider
                min={0.015}
                max={0.08}
                step={0.005}
                value={vadThreshold}
                onChange={setVadThreshold}
                tooltip={{ formatter: (value) => value?.toFixed(3) }}
                aria-label="VAD 音量阈值"
              />
            </div>
            {qaMode && (
              <div className="qa-controls" aria-label="VAD 测试控制">
                <Tag color="magenta">MOCK VAD</Tag>
                <Button size="small" data-testid="mock-speech" onClick={() => setMockVolume(vadThreshold * 2.5)}>模拟说话</Button>
                <Button size="small" data-testid="mock-silence" onClick={() => setMockVolume(0)}>模拟静音</Button>
              </div>
            )}
          </section>
        )}

        {isVoiceMode && (
          <section className="voice-live-panel" aria-live="polite">
            <div className="live-block">
              <span className="live-label">识别文本</span>
              {status === 'recording' ? (
                <div className={`streaming-asr-panel ${streamingTranscript ? 'has-text' : ''}`} data-testid="streaming-asr-text">
                  <span className="streaming-asr-status"><i />识别中</span>
                  <p>{streamingTranscript || '正在等待实时识别结果…'}</p>
                </div>
              ) : (
                <p>{transcript || (vadListening ? '正在监听你的声音…' : '等待麦克风…')}</p>
              )}
              <div className="volume-waveform" data-testid="volume-waveform" aria-label={`当前音量 ${vadVolume.toFixed(3)}`}>
                {Array.from({ length: 12 }, (_, index) => (
                  <i
                    key={index}
                    style={{ transform: `scaleY(${Math.max(0.12, normalizedVolume * (0.55 + ((index * 7) % 6) / 10))})` }}
                  />
                ))}
              </div>
            </div>
            <div className="live-divider" />
            <div className="live-block">
              <span className="live-label">回复文本</span>
              <p>{streamingText || lastAssistantText || '等待罗宾回复…'}</p>
            </div>
          </section>
        )}

        <section
          ref={messageListRef}
          className="message-list"
          data-testid="message-list"
          tabIndex={0}
          aria-label="聊天历史"
          aria-live="polite"
          onScroll={handleMessageScroll}
        >
          {messages.length === 0 && !streamingText ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isVoiceMode ? '直接对罗宾说话即可开始' : '输入文字或粘贴图片，开始与罗宾对话'} />
          ) : (
            messages.map((chatMessage) => (
              <ChatMessageRow
                key={chatMessage.id}
                chatMessage={chatMessage}
                assistantLabel={assistantName}
                displayTime={formatMessageDisplayTime(chatMessage.createdAt)}
                expanded={expandedMessageIds.has(chatMessage.id)}
                copied={copiedKey === chatMessage.id}
                onToggleExpand={toggleMessageExpanded}
                onCopy={(text, key) => void copyText(text, key)}
              />
            ))
          )}
          {streamingText && (
            <article className="message-row assistant streaming">
              <div className="message-meta">
                <span>{assistantName}</span>
                <time>实时回复</time>
                <Tooltip title={copiedKey === 'streaming' ? '已复制' : '复制消息'}>
                  <Button
                    className="message-copy-button"
                    type="text"
                    size="small"
                    shape="circle"
                    icon={copiedKey === 'streaming' ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={() => void copyText(streamingText, 'streaming')}
                    aria-label="复制实时回复"
                  />
                </Tooltip>
              </div>
              <div className="message-bubble message-content streaming-bubble">
                <MessageRichContent
                  content={streamingText}
                  className="expand-content message-markdown"
                  onCopy={(text) => void copyText(text, 'streaming')}
                />
                <span className="stream-caret" />
              </div>
            </article>
          )}
        </section>

        <footer className="composer">
          {isVoiceMode && (streamingTranscript || (status === 'recording')) && (
            <div className="live-transcript"><span />{streamingTranscript || '正在聆听…'}</div>
          )}
          {docUploads.length > 0 && (
            <div className="composer-doc-upload-list" aria-live="polite">
              {docUploads.map((upload) => (
                <div key={upload.id} className="composer-doc-upload">
                  <LoadingOutlined spin />
                  <span>{`📄 正在上传 ${upload.filename}…`}</span>
                </div>
              ))}
            </div>
          )}
          {pendingDocuments.length > 0 && (
            <div className="composer-doc-preview">
              {pendingDocuments.map((doc) => (
                <div key={doc.id} className="composer-doc-chip">
                  <FileTextOutlined />
                  <span className="composer-doc-chip-name" title={doc.filename}>{doc.filename}</span>
                  <Button
                    type="text"
                    size="small"
                    shape="circle"
                    icon={<CloseCircleOutlined />}
                    onClick={() => setPendingDocuments((current) => current.filter((item) => item.id !== doc.id))}
                    aria-label={`移除文档 ${doc.filename}`}
                  />
                </div>
              ))}
            </div>
          )}
          {pendingImages.length > 0 && (
            <div className="composer-image-preview">
              {pendingImages.map((src, index) => (
                <div key={`${src.slice(0, 32)}-${index}`} className="composer-image-chip">
                  <img src={src} alt={`待发送图片 ${index + 1}`} />
                  <Button
                    type="text"
                    size="small"
                    shape="circle"
                    icon={<CloseCircleOutlined />}
                    onClick={() => setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label="移除图片"
                  />
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            className="composer-file-input"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              if (event.target.files) void appendImages(event.target.files)
              event.target.value = ''
            }}
          />
          <Input.TextArea
            ref={inputTextAreaRef}
            className="composer-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handleComposerPaste}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            autoSize={{ minRows: 1, maxRows: 5 }}
            placeholder={isVoiceMode ? '语音模式 · 也可输入文字，Enter 发送' : '输入指令，Shift + Enter 换行，可粘贴图片或文档（PDF/DOCX/XLSX）'}
            disabled={historySyncState === 'syncing' || status === 'transcribing'}
            aria-label="文字消息"
          />
          <div className="composer-actions">
            <Tooltip title="上传图片">
              <Button
                shape="circle"
                icon={<PictureOutlined />}
                onClick={() => fileInputRef.current?.click()}
                disabled={isThinking}
                aria-label="上传图片"
              />
            </Tooltip>
            {canStopCurrentTurn ? (
              <Button
                data-testid="stop-current-turn-button"
                danger
                shape="circle"
                icon={<StopOutlined />}
                onClick={stopCurrentTurn}
                aria-label="停止当前回合"
              />
            ) : primaryButton}
          </div>
        </footer>
      </Card>
    </main>
  )
}

function AppShell() {
  const { message: messageApi } = AntApp.useApp()
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const [authToken, setAuthToken] = useState(() => isDev ? 'local-development' : getJarvisToken())
  const [username, setUsername] = useState(() => (
    isDev ? '本地调试' : localStorage.getItem(JARVIS_USERNAME_KEY) ?? ''
  ))

  const performLogout = useCallback((expired = false) => {
    if (isDev) return
    clearJarvisAuth()
    setAuthToken(null)
    setUsername('')
    if (expired) void messageApi.warning('登录已过期，请重新登录')
  }, [isDev, messageApi])

  useEffect(() => {
    if (isDev) {
      setUnauthorizedHandler(null)
      return
    }
    setUnauthorizedHandler(() => performLogout(true))
    return () => setUnauthorizedHandler(null)
  }, [isDev, performLogout])

  const handleLoginSuccess = useCallback((token: string, loggedInUsername: string) => {
    setAuthToken(token)
    setUsername(loggedInUsername)
  }, [])

  if (!isDev && !authToken) return <LoginPage onSuccess={handleLoginSuccess} />
  return <VoiceConsole username={username} onLogout={() => performLogout()} isDev={isDev} />
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorBgBase: '#0a0e27',
          colorBgContainer: '#10172f',
          borderRadius: 14,
          fontSize: 14,
        },
      }}
    >
      <AntApp>
        <AppShell />
      </AntApp>
    </ConfigProvider>
  )
}
