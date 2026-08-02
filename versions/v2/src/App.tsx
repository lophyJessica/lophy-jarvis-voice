import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
  LogoutOutlined,
  SendOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { App as AntApp, Button, Card, ConfigProvider, Empty, Input, Slider, Switch, Tag, Tooltip, Typography, theme } from 'antd'
import Markdown from 'markdown-to-jsx'
import {
  clearJarvisAuth,
  getJarvisToken,
  JARVIS_USERNAME_KEY,
  setUnauthorizedHandler,
} from './auth'
import { checkHermesConnection, HermesError, streamChatCompletion, transcribeAudio, type ChatMessage } from './api/hermes'
import JarvisCore, { type JarvisStatus } from './components/JarvisCore'
import LoginPage from './components/LoginPage'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { useVoiceActivityDetector } from './hooks/useVoiceActivityDetector'
import './App.css'

interface DisplayMessage extends ChatMessage {
  id: string
  time: string
}

type ConnectionState = 'checking' | 'online' | 'offline'

const systemPrompt = '你是贾维斯，用户的个人 AI 助手。用户叫刘龙飞，也称路飞。'
const storageKey = 'jarvis-voice-messages'
const maxSavedMessages = 200

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function createMessage(role: 'user' | 'assistant', content: string): DisplayMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    time: timeFormatter.format(new Date()),
  }
}

function readSavedMessages(): DisplayMessage[] {
  const saved = localStorage.getItem(storageKey)
  if (!saved) return []
  try {
    const messages = JSON.parse(saved) as DisplayMessage[]
    return Array.isArray(messages) ? messages.slice(-maxSavedMessages) : []
  } catch {
    return []
  }
}

function toHistory(messages: DisplayMessage[]): ChatMessage[] {
  return messages.map(({ role, content }) => ({ role, content }))
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

function cleanSpeechText(text: string) {
  return text.replace(/[#*_`>]/g, '').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim()
}

function VoiceConsole({ username, onLogout, isDev }: { username: string; onLogout: () => void; isDev: boolean }) {
  const { message: messageApi } = AntApp.useApp()
  const savedMessages = useMemo(() => readSavedMessages(), [])
  const [messages, setMessages] = useState<DisplayMessage[]>(savedMessages)
  const [history, setHistory] = useState<ChatMessage[]>(() => toHistory(savedMessages))
  const [input, setInput] = useState('')
  const [transcript, setTranscript] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [status, setStatus] = useState<JarvisStatus>('idle')
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [autoMode, setAutoMode] = useState(true)
  const [vadThreshold, setVadThreshold] = useState(0.03)
  const qaMode = useMemo(() => {
    const hostname = window.location.hostname
    return (hostname === 'localhost' || hostname === '127.0.0.1')
      && new URLSearchParams(window.location.search).has('vad-qa')
  }, [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRequestRef = useRef<AbortController | null>(null)
  const historyRef = useRef(history)
  const statusRef = useRef<JarvisStatus>('idle')
  const autoModeRef = useRef(autoMode)
  const suppressVadRef = useRef<(durationMs: number) => void>(() => undefined)
  const {
    speak,
    cancel: cancelSpeech,
    isSpeaking,
    isSupported: synthesisSupported,
  } = useSpeechSynthesis()

  const transitionTo = useCallback((nextStatus: JarvisStatus) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const stopSpeaking = useCallback(() => {
    cancelSpeech()
    if (statusRef.current === 'speaking') transitionTo('idle')
  }, [cancelSpeech, transitionTo])

  const sendMessage = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? input).trim()
    if (!content) {
      transitionTo('idle')
      return
    }

    cancelSpeech()
    setInput('')
    setStreamingText('')
    const userMessage = createMessage('user', content)
    setMessages((current) => [...current, userMessage])
    transitionTo('thinking')

    const requestController = new AbortController()
    activeRequestRef.current = requestController
    let responseText = ''

    try {
      responseText = await streamChatCompletion(
        [{ role: userMessage.role, content: userMessage.content }],
        (delta) => {
          responseText += delta
          setStreamingText(responseText)
        },
        requestController.signal,
        systemPrompt,
        historyRef.current,
      )
      if (!responseText.trim()) throw new HermesError('Hermes 返回了空回复', 'network')

      const assistantMessage = createMessage('assistant', responseText)
      setMessages((current) => [...current, assistantMessage])
      setHistory((current) => [
        ...current.slice(-(maxSavedMessages - 2)),
        { role: userMessage.role, content: userMessage.content },
        { role: assistantMessage.role, content: assistantMessage.content },
      ])
      setStreamingText('')
      setConnectionState('online')

      const speechText = cleanSpeechText(responseText)
      if (speechText && synthesisSupported) {
        transitionTo('speaking')
        await speak(speechText, () => suppressVadRef.current(200))
      }
      if (statusRef.current !== 'recording' && statusRef.current !== 'transcribing') {
        transitionTo('idle')
      }
    } catch (error) {
      if (requestController.signal.aborted) return
      if (error instanceof HermesError && error.kind === 'unauthorized') {
        transitionTo('idle')
        return
      }
      const fallback = error instanceof HermesError ? error.message : '贾维斯暂时不可用，请稍后再试'
      setStreamingText('')
      if (error instanceof HermesError) setConnectionState('offline')
      setMessages((current) => [...current, createMessage('assistant', fallback)])
      transitionTo('idle')
      void messageApi.error(fallback)
    } finally {
      if (activeRequestRef.current === requestController) activeRequestRef.current = null
    }
  }, [cancelSpeech, input, messageApi, speak, synthesisSupported, transitionTo])

  const handleVadSpeechStart = useCallback(() => {
    if (statusRef.current === 'speaking') cancelSpeech()
    if (statusRef.current === 'thinking') {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
    setTranscript('')
    setStreamingText('')
    transitionTo('recording')
  }, [cancelSpeech, transitionTo])

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
      const text = await transcribeAudio(blob)
      setTranscript(text)
      if (!text) {
        transitionTo('idle')
        void messageApi.info('没有识别到语音，请再试一次')
        return
      }
      await sendMessage(text)
    } catch (error) {
      const fallback = error instanceof HermesError ? error.message : '录音处理失败，请重试'
      transitionTo('idle')
      void messageApi.error(fallback)
    }
  }, [messageApi, sendMessage, transitionTo])

  const canVadStartSpeech = useCallback(() => (
    autoModeRef.current
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
    enabled: autoMode,
    mockMode: qaMode,
    playbackActive: isSpeaking,
    silenceThreshold: vadThreshold,
    canStartSpeech: canVadStartSpeech,
    onSpeechStart: handleVadSpeechStart,
    onSpeechEnd: handleVadSpeechEnd,
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
    suppressVadRef.current = suppressFor
  }, [suppressFor])

  useEffect(() => {
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
  }, [messageApi, startVad, stopVad])

  useEffect(() => {
    if (vadError) void messageApi.warning(vadError)
  }, [messageApi, vadError])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const saved = messages.slice(-maxSavedMessages)
    if (saved.length !== messages.length) {
      setMessages(saved)
      return
    }
    if (saved.length === 0) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(saved))
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    if (status === 'speaking' && !isSpeaking) transitionTo('idle')
  }, [isSpeaking, status, transitionTo])

  useEffect(() => () => {
    activeRequestRef.current?.abort()
    cancelSpeech()
    stopVad()
  }, [cancelSpeech, stopVad])

  const clearConversation = useCallback(() => {
    cancelSpeech()
    if (statusRef.current === 'speaking') transitionTo('idle')
    setMessages([])
    setHistory([])
    setTranscript('')
    setStreamingText('')
    localStorage.removeItem(storageKey)
  }, [cancelSpeech, transitionTo])

  const lastAssistantText = [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? ''
  const visibleStatusText = status === 'idle'
    ? vadListening
      ? autoMode ? '监听中' : '手动待机'
      : '等待麦克风'
    : statusLabel(status)
  const normalizedVolume = Math.min(1, vadVolume / Math.max(vadThreshold * 2, 0.001))
  const connectionTag = {
    checking: { color: 'processing', icon: <LoadingOutlined />, text: 'Hermes 检测中' },
    online: { color: 'success', icon: <CheckCircleOutlined />, text: 'Hermes 在线' },
    offline: { color: 'error', icon: <CloseCircleOutlined />, text: 'Hermes 离线' },
  }[connectionState]

  return (
    <main className="jarvis-shell">
      <section className="core-panel">
        <div className="brand-lockup">
          <span className="brand-mark" />
          <div>
            <Typography.Title level={4}>JARVIS</Typography.Title>
            <Typography.Text>实时语音 AI 控制台</Typography.Text>
          </div>
        </div>
        <div className={`status-readout status-${status}`}>
          <span className="status-dot" />
          <span className="status-label" data-testid="voice-status">{visibleStatusText}</span>
          {(status === 'thinking' || status === 'transcribing') && <span className="thinking-dots"><i /><i /><i /></span>}
        </div>
        <JarvisCore status={status} />
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
        <div className="core-footer">
          <div className="core-tags">
            <Tag icon={connectionTag.icon} color={connectionTag.color}>{connectionTag.text}</Tag>
            <Tag icon={<AudioOutlined />} color={vadListening ? 'processing' : 'default'}>
              {vadListening ? autoMode ? 'VAD 监听中' : '手动模式' : vadSupported ? '等待麦克风' : '麦克风不可用'}
            </Tag>
          </div>
          <span>CORE / {status.toUpperCase()}</span>
        </div>
      </section>

      <Card className="conversation-panel" variant="borderless">
        <header className="conversation-header">
          <div>
            <Typography.Title level={4}>语音对话</Typography.Title>
            <Typography.Text type="secondary">{username || 'Jarvis'} · 百度 ASR / Edge TTS</Typography.Text>
          </div>
          <div className="conversation-actions">
            <Tooltip title="清除对话">
              <Button
                type="text"
                shape="circle"
                icon={<DeleteOutlined />}
                onClick={clearConversation}
                disabled={messages.length === 0 && !streamingText}
                aria-label="清除对话"
              />
            </Tooltip>
            <Tooltip title={isSpeaking ? '停止播报' : synthesisSupported ? 'Edge TTS 已启用' : '浏览器不支持音频播放'}>
              <Button
                data-testid="stop-speech-button"
                type="text"
                shape="circle"
                icon={isSpeaking ? <StopOutlined /> : <SoundOutlined />}
                onClick={isSpeaking ? stopSpeaking : undefined}
                disabled={!synthesisSupported || !isSpeaking}
                aria-label="停止播报"
              />
            </Tooltip>
            {!isDev && (
              <Tooltip title={`退出登录（${username}）`}>
                <Button type="text" shape="circle" icon={<LogoutOutlined />} onClick={onLogout} aria-label="退出登录" />
              </Tooltip>
            )}
          </div>
        </header>

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

        <section className="voice-live-panel" aria-live="polite">
          <div className="live-block">
            <span className="live-label">识别文本</span>
            <p>{transcript || (vadListening ? '正在监听你的声音…' : '等待麦克风…')}</p>
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
            <p>{streamingText || lastAssistantText || '等待贾维斯回复…'}</p>
          </div>
        </section>

        <section className="message-list" aria-live="polite">
          {messages.length === 0 && !streamingText ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={autoMode ? '直接对贾维斯说话即可开始' : '点击中央按钮开始语音对话'} />
          ) : (
            messages.map((chatMessage) => (
              <article key={chatMessage.id} className={`message-row ${chatMessage.role}`}>
                <div className="message-meta"><span>{chatMessage.role === 'user' ? '你' : 'JARVIS'}</span><time>{chatMessage.time}</time></div>
                <div className="message-bubble"><Markdown>{chatMessage.content}</Markdown></div>
              </article>
            ))
          )}
          {streamingText && (
            <article className="message-row assistant streaming">
              <div className="message-meta"><span>JARVIS</span><time>实时回复</time></div>
              <div className="message-bubble"><Markdown>{streamingText}</Markdown><span className="stream-caret" /></div>
            </article>
          )}
          <div ref={messagesEndRef} />
        </section>

        <footer className="composer">
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="也可以输入文字，Enter 发送"
            disabled={status === 'thinking' || status === 'transcribing'}
            aria-label="文字消息"
          />
          <div className="composer-actions">
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={() => void sendMessage()}
              loading={status === 'thinking'}
              disabled={!input.trim() || status === 'transcribing'}
              aria-label="发送消息"
            />
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
