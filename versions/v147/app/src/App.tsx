import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import {
  AudioOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  LoadingOutlined,
  LogoutOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Alert, App as AntApp, Button, Card, ConfigProvider, Slider, Switch, Tag, Tooltip, Typography, theme } from 'antd'
import {
  clearJarvisAuth,
  getJarvisToken,
  JARVIS_USERNAME_KEY,
  setUnauthorizedHandler,
  verifyJarvisToken,
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
  isDocumentFile,
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
import type { JarvisStatus } from './components/JarvisCore'
import LoginPage from './components/LoginPage'
import ComposerStack from './components/ComposerStack'
import MessageListView from './components/MessageListView'
import VersionBadge from './components/VersionBadge'
import { useRealtimeVoice } from './hooks/useRealtimeVoice'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { useStreamingAsr, type StreamingAsrDebugStats } from './hooks/useStreamingAsr'
import { useTypewriterFollowAlong } from './hooks/useTypewriterFollowAlong'
import { useVoiceActivityDetector } from './hooks/useVoiceActivityDetector'
import { copyTextToClipboard } from './utils/clipboard'
import { readImageFiles } from './utils/images'
import { cleanSpeechText } from './utils/ttsSentences'
import { buildComposerMessageContent, buildMessageContent, getMessageText } from './types/messages'
import { isBrowserDevMode, isCapacitorNative } from './utils/platform'
import './App.css'

type ConnectionState = 'checking' | 'online' | 'offline'
type HistorySyncState = 'syncing' | 'synced' | 'fallback'
type InputMode = 'text' | 'voice' | 'realtime'

const systemPrompt = defaultSystemPrompt
const assistantName = '罗宾'
const modeStorageKey = 'robin-mode'
const ttsAutoPlayStorageKey = 'robin-tts-autoplay'
const maxSavedMessages = 200
/** APK 整段识别完成后，识别区逐字展开速度（略放慢，避免抢主线程影响输入） */
const APK_ASR_CHAR_REVEAL_MS = 38

function readTtsAutoPlay() {
  return localStorage.getItem(ttsAutoPlayStorageKey) !== '0'
}

function readInitialMode(): InputMode {
  localStorage.setItem(modeStorageKey, 'text')
  return 'text'
}

function isWeChatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent)
}

function WeChatBrowserNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="wechat-browser-notice" role="status" aria-live="polite">
      <Alert
        type="warning"
        showIcon
        closable
        onClose={onDismiss}
        message="微信内置浏览器提示"
        description="检测到微信内置浏览器，语音/长回复可能无法正常使用。请点击右上角「...」→ 在浏览器中打开，体验更佳。"
      />
    </div>
  )
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
  const { message: messageApi, modal } = AntApp.useApp()
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
  const [docUploads, setDocUploads] = useState<Array<{ id: string; filename: string }>>([])
  const [transcript, setTranscript] = useState('')
  const [streamingTranscript, setStreamingTranscript] = useState('')
  /** APK 识别全文（录音中周期 /asr + 收尾）；打字机只读 reveal 串 */
  const [apkAsrFullText, setApkAsrFullText] = useState('')
  const [apkAsrRevealText, setApkAsrRevealText] = useState('')
  const [apkRevealActive, setApkRevealActive] = useState(false)
  const [streamingDebug, setStreamingDebug] = useState<StreamingAsrDebugStats | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<JarvisStatus>('idle')
  const liveAsrText = streamingTranscript || transcript
  const followAlongEnabled = status === 'recording' || status === 'transcribing'
  const displayedAsrText = useTypewriterFollowAlong(liveAsrText, followAlongEnabled)
  const apkAsrRevealTimerRef = useRef(0)
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [historySyncState, setHistorySyncState] = useState<HistorySyncState>('syncing')
  const [copiedKey, setCopiedKey] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  const [vadThreshold, setVadThreshold] = useState(0.032)
  const [mode, setMode] = useState<InputMode>(() => readInitialMode())
  const [ttsAutoPlay, setTtsAutoPlay] = useState(() => readTtsAutoPlay())
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set())
  const vadQaDebug = useMemo(() => {
    return isBrowserDevMode()
      && new URLSearchParams(window.location.search).has('vad-qa')
  }, [])
  /** 仅 ?vad-qa=mock 时用振荡器；?vad-qa=1 仍走真实麦克风 */
  const vadMockMode = useMemo(() => {
    if (!vadQaDebug) return false
    return new URLSearchParams(window.location.search).get('vad-qa') === 'mock'
  }, [vadQaDebug])
  const messageListRef = useRef<HTMLElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const activeRequestRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const historyRef = useRef(history)
  const historyInitializedRef = useRef(false)
  const historyRefreshIdRef = useRef(0)
  const statusRef = useRef<JarvisStatus>('idle')
  const autoModeRef = useRef(autoMode)
  const modeRef = useRef(mode)
  const ttsAutoPlayRef = useRef(ttsAutoPlay)
  const suppressVadRef = useRef<(durationMs: number) => void>(() => undefined)
  const copyResetTimerRef = useRef(0)

  const refreshHistory = useCallback(async () => {
    const refreshId = historyRefreshIdRef.current + 1
    historyRefreshIdRef.current = refreshId
    setHistorySyncState('syncing')
    try {
      const [server, local] = await Promise.all([loadCloudHistory(maxSavedMessages), getLocalMessages()])
      if (historyRefreshIdRef.current !== refreshId) return
      const merged = mergeMessages(local, server).slice(-maxSavedMessages)
      shouldAutoScrollRef.current = true
      messagesRef.current = merged
      setMessages(merged)
      setHistory(toChatHistory(merged))
      historyInitializedRef.current = true
      setHistorySyncState('synced')
      await replaceLocalMessages(merged).catch((error) => console.error('Robin local cache sync failed', error))
    } catch (historyError) {
      if (historyRefreshIdRef.current !== refreshId) return
      console.warn('Robin cloud history unavailable; restoring from Dexie', historyError)
      const local = await getLocalMessages().catch(() => [])
      if (historyRefreshIdRef.current !== refreshId) return
      messagesRef.current = local
      setMessages(local)
      setHistory(toChatHistory(local))
      historyInitializedRef.current = true
      setHistorySyncState('fallback')
    }
  }, [])

  const clearApkAsrReveal = useCallback(() => {
    window.clearInterval(apkAsrRevealTimerRef.current)
    apkAsrRevealTimerRef.current = 0
    setApkRevealActive(false)
    setApkAsrFullText('')
    setApkAsrRevealText('')
  }, [])

  /**
   * APK 收尾专用：固定 45ms/字从空串逐字 reveal（不用 useTypewriterFollowAlong）。
   * 录音中的周期 /asr 结果走 applyAsrLiveText 实时替换显示。
   */
  const revealApkAsrText = useCallback((fullText: string) => {
    const trimmed = fullText.trim()
    window.clearInterval(apkAsrRevealTimerRef.current)
    apkAsrRevealTimerRef.current = 0
    setApkAsrFullText(trimmed)
    setTranscript(trimmed)
    if (!trimmed) {
      setApkRevealActive(false)
      setApkAsrRevealText('')
      return Promise.resolve()
    }
    setApkRevealActive(true)
    setApkAsrRevealText('')

    return new Promise<void>((resolve) => {
      let index = 0
      apkAsrRevealTimerRef.current = window.setInterval(() => {
        index += 1
        if (index >= trimmed.length) {
          window.clearInterval(apkAsrRevealTimerRef.current)
          apkAsrRevealTimerRef.current = 0
          setApkAsrRevealText(trimmed)
          setApkRevealActive(false)
          resolve()
          return
        }
        setApkAsrRevealText(trimmed.slice(0, index))
      }, APK_ASR_CHAR_REVEAL_MS)
    })
  }, [])

  const applyAsrLiveText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setStreamingTranscript('')
      if (isCapacitorNative()) clearApkAsrReveal()
      return
    }
    // APK 录音中周期 /asr：实时替换识别区；收尾打字机由 revealApkAsrText 接管。
    if (isCapacitorNative()) {
      setApkAsrFullText(trimmed)
      setTranscript(trimmed)
      return
    }
    setStreamingTranscript(trimmed)
  }, [clearApkAsrReveal])
  const realtimeThinkingAudioRef = useRef<HTMLAudioElement | null>(null)
  const realtimeThinkingPromptPlayingRef = useRef(false)
  const realtimeThinkingPromptSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const realtimeThinkingAudioContextRef = useRef<AudioContext | null>(null)
  const realtimeThinkingPromptBufferRef = useRef<AudioBuffer | null>(null)
  const realtimeThinkingPromptLoadRef = useRef<Promise<AudioBuffer | null> | null>(null)
  const realtimeThinkingPromptRequestRef = useRef(0)
  const realtimeThinkingAudioUnlockedRef = useRef(false)
  const cancelRealtimeThinkingPrompt = useCallback(() => {
    realtimeThinkingPromptRequestRef.current += 1
    const source = realtimeThinkingPromptSourceRef.current
    realtimeThinkingPromptSourceRef.current = null
    if (source) {
      try { source.stop() } catch { /* already stopped */ }
      try { source.disconnect() } catch { /* already disconnected */ }
    }
    const audio = realtimeThinkingAudioRef.current
    realtimeThinkingAudioRef.current = null
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
    realtimeThinkingPromptPlayingRef.current = false
  }, [])
  const preloadRealtimeThinkingPrompt = useCallback((context: AudioContext) => {
    if (realtimeThinkingPromptBufferRef.current) return Promise.resolve(realtimeThinkingPromptBufferRef.current)
    if (realtimeThinkingPromptLoadRef.current) return realtimeThinkingPromptLoadRef.current
    const load = fetch('/robin-thinking.mp3')
      .then((response) => {
        if (!response.ok) throw new Error(`本地提示音加载失败（${response.status}）`)
        return response.arrayBuffer()
      })
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        if (realtimeThinkingAudioContextRef.current === context) realtimeThinkingPromptBufferRef.current = buffer
        return buffer
      })
      .catch((error: unknown) => {
        console.warn('Robin local thinking prompt preload failed', error)
        return null
      })
    realtimeThinkingPromptLoadRef.current = load
    return load
  }, [])
  const unlockRealtimeThinkingAudio = useCallback(() => {
    if (typeof window === 'undefined') return
    const AudioContextConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return
    try {
      let context = realtimeThinkingAudioContextRef.current
      if (!context || context.state === 'closed') {
        context = new AudioContextConstructor()
        realtimeThinkingAudioContextRef.current = context
        realtimeThinkingPromptBufferRef.current = null
        realtimeThinkingPromptLoadRef.current = null
        realtimeThinkingAudioUnlockedRef.current = false
      }
      if (context.state !== 'running') {
        void context.resume().catch((error: unknown) => {
          console.warn('Robin thinking AudioContext resume failed', error)
        })
      }
      if (!realtimeThinkingAudioUnlockedRef.current) {
        const silentBuffer = context.createBuffer(1, 1, context.sampleRate)
        const silentSource = context.createBufferSource()
        silentSource.buffer = silentBuffer
        silentSource.connect(context.destination)
        silentSource.start(0)
        realtimeThinkingAudioUnlockedRef.current = true
      }
      void preloadRealtimeThinkingPrompt(context)
    } catch (error) {
      console.warn('Robin thinking AudioContext unlock failed', error)
    }
  }, [preloadRealtimeThinkingPrompt])
  const {
    speak,
    warmUpSpeech,
    beginStreamingSpeech,
    appendStreamingSpeechText,
    endStreamingSpeech,
    waitForSpeechDrain,
    cancel: cancelSpeech,
    isSpeaking,
    isSupported: synthesisSupported,
  } = useSpeechSynthesis()
  const {
    error: realtimeError,
    phase: realtimePhase,
    start: startRealtime,
    stop: stopRealtime,
    stopPlayback: stopRealtimePlayback,
    transcript: realtimeTranscript,
  } = useRealtimeVoice({
    thinkingPromptAudioRef: realtimeThinkingAudioRef,
    thinkingPromptPlayingRef: realtimeThinkingPromptPlayingRef,
  })
  const realtimeThinkingPromptedRef = useRef(false)
  const closeRealtimeThinkingAudio = useCallback(() => {
    cancelRealtimeThinkingPrompt()
    const context = realtimeThinkingAudioContextRef.current
    realtimeThinkingAudioContextRef.current = null
    realtimeThinkingPromptBufferRef.current = null
    realtimeThinkingPromptLoadRef.current = null
    realtimeThinkingAudioUnlockedRef.current = false
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }, [cancelRealtimeThinkingPrompt])
  const playRealtimeThinkingFallback = useCallback((requestId: number) => {
    if (requestId !== realtimeThinkingPromptRequestRef.current || typeof Audio === 'undefined') {
      realtimeThinkingPromptPlayingRef.current = false
      return
    }
    const audio = new Audio('/robin-thinking.mp3')
    audio.preload = 'auto'
    audio.volume = 0.82
    realtimeThinkingAudioRef.current = audio
    const clearAudioRef = () => {
      if (realtimeThinkingAudioRef.current !== audio) return
      realtimeThinkingAudioRef.current = null
      realtimeThinkingPromptPlayingRef.current = false
    }
    audio.onended = clearAudioRef
    audio.onerror = () => {
      console.warn('Robin local thinking prompt fallback failed')
      clearAudioRef()
    }
    try {
      void audio.play().catch((error: unknown) => {
        console.warn('Robin local thinking prompt fallback play failed', error)
        clearAudioRef()
      })
    } catch (error) {
      console.warn('Robin local thinking prompt fallback play failed', error)
      clearAudioRef()
    }
  }, [])
  const playRealtimeThinkingPrompt = useCallback(() => {
    cancelRealtimeThinkingPrompt()
    const requestId = realtimeThinkingPromptRequestRef.current
    realtimeThinkingPromptPlayingRef.current = true
    const context = realtimeThinkingAudioContextRef.current
    if (!context) {
      playRealtimeThinkingFallback(requestId)
      return
    }
    void (async () => {
      try {
        if (context.state !== 'running') await context.resume()
        const buffer = realtimeThinkingPromptBufferRef.current ?? await preloadRealtimeThinkingPrompt(context)
        if (requestId !== realtimeThinkingPromptRequestRef.current) return
        if (!buffer || context.state === 'closed') {
          playRealtimeThinkingFallback(requestId)
          return
        }
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        realtimeThinkingPromptSourceRef.current = source
        source.onended = () => {
          if (realtimeThinkingPromptSourceRef.current !== source) return
          realtimeThinkingPromptSourceRef.current = null
          realtimeThinkingPromptPlayingRef.current = false
          source.disconnect()
        }
        source.start(0)
      } catch (error) {
        if (requestId !== realtimeThinkingPromptRequestRef.current) return
        console.warn('Robin local thinking prompt AudioContext playback failed', error)
        playRealtimeThinkingFallback(requestId)
      }
    })()
  }, [cancelRealtimeThinkingPrompt, playRealtimeThinkingFallback, preloadRealtimeThinkingPrompt])
  const previousRealtimePhaseRef = useRef(realtimePhase)
  const {
    beginLivePreview: beginStreamingLivePreview,
    cleanupSession: cleanupStreamingAsr,
    enqueueChunk: enqueueStreamingAsrChunk,
    enqueueWebmSnapshot: enqueueStreamingWebmSnapshot,
    finishSession: finishStreamingAsr,
    prepareSession: prepareStreamingAsr,
    primeSession: primeStreamingAsr,
    releaseIdleSession: releaseIdleStreamingAsr,
  } = useStreamingAsr({
    onInterimText: applyAsrLiveText,
    onDebugStats: vadQaDebug ? setStreamingDebug : undefined,
  })

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

  type SendTurnContext = {
    pendingMessages: StoredMessage[]
    requestController: AbortController
    shouldStreamTts: boolean
    userMessage: StoredMessage
  }

  const prepareSendTurn = useCallback((
    userInstruction: string,
    images: string[],
    documents: PendingDocument[],
  ): SendTurnContext | null => {
    if (documents.length > 0 && !userInstruction) {
      void messageApi.info('请输入你想让我对这份文档做什么')
      return null
    }
    if (!userInstruction && images.length === 0 && documents.length === 0) {
      transitionTo('idle')
      return null
    }
    if (!historyInitializedRef.current) {
      transitionTo('idle')
      void messageApi.info('历史记录同步中，请稍候')
      return null
    }

    cancelSpeech()
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
    const shouldStreamTts = synthesisSupported && (modeRef.current === 'voice' || ttsAutoPlayRef.current)
    if (shouldStreamTts) {
      beginStreamingSpeech(() => {
        transitionTo('speaking')
        suppressVadRef.current(200)
      })
    }

    return { pendingMessages, requestController, shouldStreamTts, userMessage }
  }, [beginStreamingSpeech, cancelSpeech, messageApi, transitionTo, synthesisSupported])

  const executeSendTurn = useCallback(async (ctx: SendTurnContext): Promise<boolean> => {
    const { pendingMessages, requestController, shouldStreamTts, userMessage } = ctx
    let responseText = ''

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
      return true
    } catch (error) {
      if (requestController.signal.aborted) {
        if (shouldStreamTts) cancelSpeech()
        return false
      }
      if (error instanceof HermesError && error.kind === 'unauthorized') {
        transitionTo('idle')
        return false
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
      return false
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = null
    }
  }, [appendStreamingSpeechText, cancelSpeech, endStreamingSpeech, messageApi, persistTurn, transitionTo, waitForSpeechDrain])

  const sendMessage = useCallback(async (overrideText?: string, overrideImages?: string[], overrideDocuments?: PendingDocument[]): Promise<boolean> => {
    const images = overrideImages ?? pendingImages
    const documents = overrideDocuments ?? pendingDocuments
    const userInstruction = (overrideText ?? '').trim()
    const ctx = prepareSendTurn(userInstruction, images, documents)
    if (!ctx) return false
    return executeSendTurn(ctx)
  }, [executeSendTurn, pendingDocuments, pendingImages, prepareSendTurn])

  const handleComposerSend = useCallback((text: string): boolean => {
    const userInstruction = text.trim()
    const ctx = prepareSendTurn(userInstruction, pendingImages, pendingDocuments)
    if (!ctx) return false
    void executeSendTurn(ctx)
    return true
  }, [executeSendTurn, pendingDocuments, pendingImages, prepareSendTurn])

  const handleVadListeningReady = useCallback(() => {
    prepareStreamingAsr()
  }, [prepareStreamingAsr])

  const handleVadSpeechPrime = useCallback(() => {
    if (statusRef.current === 'speaking') cancelSpeech()
    if (statusRef.current === 'thinking') {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
    setStreamingTranscript('')
    primeStreamingAsr()
    beginStreamingLivePreview()
  }, [beginStreamingLivePreview, cancelSpeech, primeStreamingAsr])

  const handleVadSpeechStart = useCallback(() => {
    clearApkAsrReveal()
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    beginStreamingLivePreview()
    transitionTo('recording')
  }, [beginStreamingLivePreview, clearApkAsrReveal, transitionTo])

  const handleVadSpeechEnd = useCallback(() => {
    if (statusRef.current === 'recording') transitionTo('transcribing')
  }, [transitionTo])

  const processRecording = useCallback(async (blob: Blob) => {
    try {
      const { text } = await finishStreamingAsr(blob)
      const recognized = text.trim()
      if (!recognized) {
        applyAsrLiveText('')
        transitionTo('idle')
        void messageApi.info(blob.size ? '没有识别到语音，请再试一次' : '没有录到有效音频，请再试一次')
        return
      }
      if (isCapacitorNative()) {
        // 专用打字机：等逐字完成后再发送（肉眼可见 45ms/字）
        await revealApkAsrText(recognized)
      } else {
        applyAsrLiveText(recognized)
      }
      const sent = await sendMessage(recognized, [])
      if (sent && statusRef.current === 'idle') {
        applyAsrLiveText('')
      }
    } catch (error) {
      const fallback = error instanceof HermesError ? error.message : '录音处理失败，请重试'
      transitionTo('idle')
      void messageApi.error(fallback)
    }
  }, [applyAsrLiveText, finishStreamingAsr, messageApi, revealApkAsrText, sendMessage, transitionTo])

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
    setMockVolume,
    start: startVad,
    stop: stopVad,
    suppressFor,
    volume: vadVolume,
  } = useVoiceActivityDetector({
    enabled: mode === 'voice' && autoMode,
    mockMode: vadMockMode,
    playbackActive: isSpeaking,
    silenceThreshold: vadThreshold,
    canStartSpeech: canVadStartSpeech,
    onSpeechPrime: handleVadSpeechPrime,
    onSpeechPrimeCancel: releaseIdleStreamingAsr,
    onListeningReady: handleVadListeningReady,
    onSpeechStart: handleVadSpeechStart,
    onSpeechEnd: handleVadSpeechEnd,
    onRecordingChunk: enqueueStreamingAsrChunk,
    onRecordingWebmSnapshot: enqueueStreamingWebmSnapshot,
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

  const exitVoiceMode = useCallback(() => {
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    cancelSpeech()
    cancelRealtimeThinkingPrompt()
    stopRealtime()
    modeRef.current = 'text'
    setMode('text')
    localStorage.setItem(modeStorageKey, 'text')
    stopVad()
    cleanupStreamingAsr()
    clearApkAsrReveal()
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    transitionTo('idle')
  }, [cancelRealtimeThinkingPrompt, cancelSpeech, cleanupStreamingAsr, clearApkAsrReveal, stopRealtime, stopVad, transitionTo])

  const enterRealtimeMode = useCallback(() => {
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    cancelSpeech()
    cancelRealtimeThinkingPrompt()
    stopVad()
    cleanupStreamingAsr()
    clearApkAsrReveal()
    setTranscript('')
    setStreamingTranscript('')
    setStreamingText('')
    modeRef.current = 'realtime'
    setMode('realtime')
    transitionTo('idle')
    unlockRealtimeThinkingAudio()
    startRealtime().catch((error: unknown) => {
      void messageApi.error(error instanceof Error ? error.message : '实时语音启动失败')
    })
  }, [cancelRealtimeThinkingPrompt, cancelSpeech, cleanupStreamingAsr, clearApkAsrReveal, messageApi, startRealtime, stopVad, transitionTo, unlockRealtimeThinkingAudio])

  const exitRealtimeMode = useCallback(() => {
    cancelRealtimeThinkingPrompt()
    stopRealtime()
    stopVad()
    cleanupStreamingAsr()
    clearApkAsrReveal()
    modeRef.current = 'text'
    setMode('text')
    localStorage.setItem(modeStorageKey, 'text')
    transitionTo('idle')
    window.setTimeout(() => void refreshHistory(), 350)
  }, [cancelRealtimeThinkingPrompt, cleanupStreamingAsr, clearApkAsrReveal, refreshHistory, stopRealtime, stopVad, transitionTo])

  // 每轮识别文本到达后只播一次本地提示音；正式 PCM 回复一到立即取消，避免与豆包声音叠加。
  useEffect(() => {
    if (mode !== 'realtime' || realtimePhase !== 'thinking') {
      realtimeThinkingPromptedRef.current = false
      cancelRealtimeThinkingPrompt()
      return
    }
    if (!realtimeTranscript || realtimeThinkingPromptedRef.current) return
    realtimeThinkingPromptedRef.current = true
    playRealtimeThinkingPrompt()
  }, [cancelRealtimeThinkingPrompt, mode, playRealtimeThinkingPrompt, realtimePhase, realtimeTranscript])

  useEffect(() => {
    const previousPhase = previousRealtimePhaseRef.current
    previousRealtimePhaseRef.current = realtimePhase
    if (mode !== 'realtime' || previousPhase !== 'speaking' || realtimePhase !== 'connected') return
    const timer = window.setTimeout(() => void refreshHistory(), 350)
    return () => window.clearTimeout(timer)
  }, [mode, realtimePhase, refreshHistory])

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

  const removePendingDocument = useCallback((id: string) => {
    setPendingDocuments((current) => current.filter((item) => item.id !== id))
  }, [])

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }, [])

  // Mount: hydrate history from cloud, fall back to Dexie local cache on failure.
  useEffect(() => {
    void refreshHistory()
    return () => {
      historyRefreshIdRef.current += 1
    }
  }, [refreshHistory])

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
    closeRealtimeThinkingAudio()
    stopVad()
    cleanupStreamingAsr()
    stopRealtime()
    window.clearTimeout(copyResetTimerRef.current)
    window.clearInterval(apkAsrRevealTimerRef.current)
  }, [cancelSpeech, cleanupStreamingAsr, closeRealtimeThinkingAudio, stopRealtime, stopVad])

  const clearConversation = useCallback(async () => {
    cancelSpeech()
    cancelRealtimeThinkingPrompt()
    if (statusRef.current === 'speaking') transitionTo('idle')
    shouldAutoScrollRef.current = true
    messagesRef.current = []
    setMessages([])
    setHistory([])
    clearApkAsrReveal()
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
  }, [cancelRealtimeThinkingPrompt, cancelSpeech, clearApkAsrReveal, transitionTo])

  const confirmClearConversation = useCallback(() => {
    modal.confirm({
      title: '确定清空全部聊天记录吗？此操作不可恢复',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: clearConversation,
    })
  }, [clearConversation, modal])

  const confirmLogout = useCallback(() => {
    modal.confirm({
      title: '确定退出登录吗？',
      okText: '退出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk: onLogout,
    })
  }, [modal, onLogout])

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

  // 有可朗读回复时后台预热首段 TTS，点击后力争 1s 内出声
  useEffect(() => {
    if (!synthesisSupported || !replayableSpeechText) return
    if (status === 'speaking' || status === 'thinking' || isSpeaking) return
    void warmUpSpeech(replayableSpeechText)
  }, [isSpeaking, replayableSpeechText, status, synthesisSupported, warmUpSpeech])

  const replayAssistantSpeech = useCallback(async () => {
    if (!replayableSpeechText || !synthesisSupported) {
      void messageApi.info('暂无可朗读内容')
      return
    }
    cancelSpeech()
    try {
      // 首包音频就绪再标 speaking；若已预热则几乎立即出声
      await speak(replayableSpeechText, () => {
        transitionTo('speaking')
        suppressVadRef.current(200)
      })
    } finally {
      if (statusRef.current === 'speaking') transitionTo('idle')
    }
  }, [cancelSpeech, messageApi, replayableSpeechText, speak, synthesisSupported, transitionTo])

  // 顶部喇叭仅负责 TTS：播报中→停止朗读；空闲→重播。思考中打断用底部停止钮，勿混用。
  const handleHeaderSpeechClick = useCallback(() => {
    if (status === 'speaking' || isSpeaking) {
      stopSpeaking()
      return
    }
    void replayAssistantSpeech()
  }, [isSpeaking, replayAssistantSpeech, status, stopSpeaking])

  const isVoiceMode = mode === 'voice'
  const isRealtimeMode = mode === 'realtime'
  const isThinking = status === 'thinking'
  // 底部停止仅用于打断「思考/生成」；播报中用顶部喇叭停止，回复完成后底部恢复语音钮
  const canStopCurrentTurn = status === 'thinking'
  const headerSpeechStopping = status === 'speaking' || isSpeaking

  const realtimeStatusText = {
    idle: '实时模式待机',
    connecting: '实时连接中…',
    connected: '实时对话中',
    thinking: '正在思考…',
    speaking: '罗宾实时回应中',
    error: '连接断开',
  }[realtimePhase]
  const visibleStatusText = isRealtimeMode
    ? realtimeStatusText
    : status === 'idle'
      ? vadListening
        ? autoMode ? '监听中' : '手动待机'
        : isVoiceMode ? '等待麦克风' : '待命中'
      : statusLabel(status)
  const visibleStatus = isRealtimeMode && realtimePhase === 'speaking' ? 'speaking' : status
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

  const voiceAsrPlaceholder = status === 'transcribing'
    ? '收尾识别中…'
    : status === 'recording'
      ? '正在识别…'
      : vadListening ? '正在监听你的声音…' : '等待麦克风…'
  const voiceAsrFollowAlong = status === 'recording' || status === 'transcribing'
  // APK：录音中显示周期 /asr 全文；收尾打字机期间只显示 reveal，避免闪回全文
  const voiceAsrDisplayText = isCapacitorNative()
    ? (apkRevealActive ? apkAsrRevealText : (apkAsrRevealText || apkAsrFullText || transcript))
    : voiceAsrFollowAlong
      ? (displayedAsrText || liveAsrText)
      : liveAsrText
  const nativeAsrPanelActive = isCapacitorNative() && (apkAsrFullText.length > 0 || apkAsrRevealText.length > 0)
  const showVoiceAsrPanel = status === 'recording'
    || status === 'transcribing'
    || (liveAsrText && (status === 'thinking' || status === 'speaking'))
    || (nativeAsrPanelActive && (status === 'thinking' || status === 'speaking'))

  return (
    <main className="jarvis-shell">
      <Card className="conversation-panel" variant="borderless">
        <header className="conversation-header">
          <div className="conversation-brand">
            <span className="brand-avatar" aria-hidden>R</span>
            <div className="conversation-heading">
              <Typography.Title level={4}>罗宾</Typography.Title>
              <div className={`status-readout status-${visibleStatus}`}>
                <span className="status-dot" />
                <span className="status-label" data-testid="voice-status">{visibleStatusText}</span>
                {!isRealtimeMode && (status === 'thinking' || status === 'transcribing') && <span className="thinking-dots"><i /><i /><i /></span>}
              </div>
            </div>
          </div>
          <div className="conversation-actions">
            <div className="conversation-status-tags">
              <Tag icon={connectionTag.icon} color={connectionTag.color}>{connectionTag.text}</Tag>
              <Tag data-testid="history-sync-status" icon={<CloudSyncOutlined />} color={historySyncTag.color}>
                {historySyncTag.text}
              </Tag>
            </div>
            <div className="conversation-action-buttons">
              <Tooltip title={headerSpeechStopping ? '停止播报' : '朗读上一条回复'}>
                <Button
                  data-testid="header-speech-button"
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
                  disabled={isRealtimeMode || !synthesisSupported || (!headerSpeechStopping && !canReplaySpeech)}
                  aria-label={headerSpeechStopping ? '停止播报' : '朗读回复'}
                  aria-pressed={ttsAutoPlay}
                />
              </Tooltip>
              <Tooltip title="清除对话">
                <Button
                  type="text"
                  shape="circle"
                  icon={<DeleteOutlined />}
                  onClick={confirmClearConversation}
                  disabled={messages.length === 0 && !streamingText}
                  aria-label="清除对话"
                />
              </Tooltip>
              {!isDev && (
                <Tooltip title={`退出登录（${username}）`}>
                  <Button type="text" shape="circle" icon={<LogoutOutlined />} onClick={confirmLogout} aria-label="退出登录" />
                </Tooltip>
              )}
            </div>
          </div>
        </header>

        {isVoiceMode && (
          <section className="voice-settings" aria-label="语音检测设置">
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
              <span className="setting-description">越高越不易误触（敲键/风扇）；轻声听不清可调低</span>
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
            {vadMockMode && (
              <div className="qa-controls" aria-label="VAD 测试控制">
                <Tag color="magenta">MOCK VAD</Tag>
                <Button size="small" data-testid="mock-speech" onClick={() => setMockVolume(vadThreshold * 2.5)}>模拟说话</Button>
                <Button size="small" data-testid="mock-silence" onClick={() => setMockVolume(0)}>模拟静音</Button>
              </div>
            )}
            {vadQaDebug && !vadMockMode && (
              <div className="qa-controls" aria-label="ASR 调试">
                <Tag color="blue">真实麦克风</Tag>
                <span className="qa-hint">跟嘴指标见识别区下方</span>
              </div>
            )}
          </section>
        )}

        {isVoiceMode && (
          <section className="voice-live-panel" aria-live="polite">
            <div className="live-block live-block-asr">
              <span className="live-label">识别文本</span>
              {showVoiceAsrPanel ? (
                <div className={`streaming-asr-panel ${voiceAsrDisplayText ? 'has-text' : ''}`} data-testid="streaming-asr-text">
                  <span className="streaming-asr-status"><i />{status === 'transcribing' ? '收尾识别' : status === 'thinking' ? '已识别' : '识别中'}</span>
                  <p>{voiceAsrDisplayText || voiceAsrPlaceholder}</p>
                </div>
              ) : (
                <p>{voiceAsrPlaceholder}</p>
              )}
              <div className="volume-waveform" data-testid="volume-waveform" aria-label={`当前音量 ${vadVolume.toFixed(3)}`}>
                {Array.from({ length: 12 }, (_, index) => (
                  <i
                    key={index}
                    style={{ transform: `scaleY(${Math.max(0.12, normalizedVolume * (0.55 + ((index * 7) % 6) / 10))})` }}
                  />
                ))}
              </div>
              {vadError && (
                <p className="asr-debug-stats asr-mic-error">{vadError}</p>
              )}
              {vadQaDebug && (
                <p className="asr-debug-stats" data-testid="asr-debug-stats">
                  跟嘴 {streamingDebug?.firstInterimMs ? `${streamingDebug.firstInterimMs}ms` : '—'}
                  · 预览×{streamingDebug?.webmPreviewCount ?? 0}
                  · chunk×{streamingDebug?.streamChunkCount ?? 0}
                  · 流式命中×{streamingDebug?.streamTextHits ?? 0}
                  · 源 {streamingDebug?.liveSource || '—'}
                  · 字×{streamingDebug?.liveCharCount || liveAsrText.length}
                </p>
              )}
            </div>
          </section>
        )}

        <MessageListView
          assistantLabel={assistantName}
          copiedKey={copiedKey}
          expandedMessageIds={expandedMessageIds}
          isVoiceMode={isVoiceMode || isRealtimeMode}
          messageListRef={messageListRef}
          messages={messages}
          streamingText={streamingText}
          onCopy={copyText}
          onScroll={handleMessageScroll}
          onToggleExpand={toggleMessageExpanded}
        />

        <ComposerStack
          canStopCurrentTurn={canStopCurrentTurn}
          docUploads={docUploads}
          historySyncState={historySyncState}
          isThinking={isThinking}
          isTranscribing={status === 'transcribing'}
          isRealtimeMode={isRealtimeMode}
          realtimeError={realtimeError}
          realtimePhase={realtimePhase}
          realtimeStatusText={realtimeStatusText}
          realtimeTranscript={realtimeTranscript}
          isVoiceMode={isVoiceMode}
          pendingDocuments={pendingDocuments}
          pendingImages={pendingImages}
          onAppendImages={appendImages}
          onEnterRealtimeMode={enterRealtimeMode}
          onExitRealtimeMode={exitRealtimeMode}
          onExitVoiceMode={exitVoiceMode}
          onProcessDocumentPaste={processDocumentPaste}
          onRemovePendingDocument={removePendingDocument}
          onRemovePendingImage={removePendingImage}
          onSend={handleComposerSend}
          onStopCurrentTurn={stopCurrentTurn}
          onStopRealtimePlayback={stopRealtimePlayback}
          suppressFor={suppressFor}
        />
      </Card>
    </main>
  )
}

function AppShell() {
  const { message: messageApi } = AntApp.useApp()
  const isDev = isBrowserDevMode()
  const [authToken, setAuthToken] = useState(() => isDev ? 'local-development' : getJarvisToken())
  const [username, setUsername] = useState(() => (
    isDev ? '本地调试' : localStorage.getItem(JARVIS_USERNAME_KEY) ?? ''
  ))
  // 非开发环境且本地已有 token 时，启动阶段需向服务端校验（改密后旧 token 会失效）。
  const [authChecking, setAuthChecking] = useState(() => !isDev && Boolean(getJarvisToken()))

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

  // 启动校验：token 有效则进主界面；401（如改密）则清除并回登录页；网络错误宽容放行。
  useEffect(() => {
    if (isDev || !getJarvisToken()) {
      setAuthChecking(false)
      return
    }
    let active = true
    setAuthChecking(true)
    ;(async () => {
      const result = await verifyJarvisToken()
      if (!active) return
      if (result === 'invalid') {
        clearJarvisAuth()
        setAuthToken(null)
        setUsername('')
      }
      // 'valid' 或 'network-error' 均放行进入主界面
      setAuthChecking(false)
    })()
    return () => {
      active = false
    }
  }, [isDev])

  const handleLoginSuccess = useCallback((token: string, loggedInUsername: string) => {
    setAuthToken(token)
    setUsername(loggedInUsername)
  }, [])

  if (!isDev && authChecking) {
    return (
      <div className="auth-checking">
        <LoadingOutlined spin />
        <span>正在验证登录状态…</span>
      </div>
    )
  }
  if (!isDev && !authToken) return <LoginPage onSuccess={handleLoginSuccess} />
  return <VoiceConsole username={username} onLogout={() => performLogout()} isDev={isDev} />
}

function AppRoot() {
  const isWeChat = useMemo(() => isWeChatBrowser(), [])
  const [weChatNoticeDismissed, setWeChatNoticeDismissed] = useState(false)
  const showWeChatNotice = isWeChat && !weChatNoticeDismissed

  return (
    <div className={showWeChatNotice ? 'app-root with-wechat-notice' : 'app-root'}>
      {showWeChatNotice && <WeChatBrowserNotice onDismiss={() => setWeChatNoticeDismissed(true)} />}
      <AppShell />
      <VersionBadge />
    </div>
  )
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#10a37f',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorText: '#202123',
          colorBorder: '#e5e7eb',
          borderRadius: 12,
          fontSize: 14,
        },
      }}
    >
      <AntApp>
        <AppRoot />
      </AntApp>
    </ConfigProvider>
  )
}
