import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
  SendOutlined,
  SoundOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { App as AntApp, Button, Card, ConfigProvider, Empty, Input, Tag, Tooltip, Typography, theme } from 'antd'
import Markdown from 'markdown-to-jsx'
import { checkHermesConnection, HermesError, isHermesConfigured, streamChatCompletion, type ChatMessage } from './api/hermes'
import JarvisCore, { type JarvisStatus } from './components/JarvisCore'
import { useSpeechRecognition } from './hooks/useSpeechRecognition'
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis'
import { useVoiceActivityDetector } from './hooks/useVoiceActivityDetector'
import './App.css'

interface DisplayMessage extends ChatMessage {
  id: string
  time: string
}

type ConnectionState = 'checking' | 'online' | 'offline' | 'unconfigured'
const systemPrompt = '你是贾维斯，用户的个人 AI 助手。用户叫刘龙飞，也称路飞。'
const storageKey = 'jarvis-messages'
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

function cleanSpeechText(text: string) {
  return text
    .replace(/[#*_`>]/g, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/g, ' ')
    .trim()
}

function takeCompletedSentences(text: string) {
  const sentences: string[] = []
  let rest = text
  let boundary = rest.search(/[。！？!?；;\n]/)

  while (boundary >= 0) {
    const sentence = rest.slice(0, boundary + 1).trim()
    if (sentence) sentences.push(sentence)
    rest = rest.slice(boundary + 1)
    boundary = rest.search(/[。！？!?；;\n]/)
  }

  return { sentences, rest }
}

function ConsoleApp() {
  const { message: messageApi } = AntApp.useApp()
  const [messages, setMessages] = useState<DisplayMessage[]>(() => readSavedMessages())
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<ChatMessage[]>(() => toHistory(readSavedMessages()))
  const [status, setStatus] = useState<JarvisStatus>('idle')
  const [streamingText, setStreamingText] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    isHermesConfigured ? 'checking' : 'unconfigured',
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeRequestRef = useRef<AbortController | null>(null)
  const historyRef = useRef(history)
  const latestTranscriptRef = useRef('')
  const responseCompleteRef = useRef(true)
  const spokenSentenceBufferRef = useRef('')
  const statusRef = useRef<JarvisStatus>('idle')
  const submitVoiceTimerRef = useRef(0)
  const {
    interimText,
    finalText,
    isListening: recognitionListening,
    error: recognitionError,
    isSupported: recognitionSupported,
    start: startRecognition,
    stop: stopListening,
    abort: abortRecognition,
    reset: resetRecognition,
  } = useSpeechRecognition()
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

  const interruptActiveResponse = useCallback(() => {
    window.clearTimeout(submitVoiceTimerRef.current)
    activeRequestRef.current?.abort()
    activeRequestRef.current = null
    cancelSpeech()
    abortRecognition()
    spokenSentenceBufferRef.current = ''
    responseCompleteRef.current = true
    setStreamingText('')
    setInput('')
    latestTranscriptRef.current = ''
    resetRecognition()
  }, [abortRecognition, cancelSpeech, resetRecognition])

  const speakCompletedSentence = useCallback((sentence: string) => {
    const speechText = cleanSpeechText(sentence)
    if (!speechText || !synthesisSupported) return false
    speak(speechText)
    transitionTo('speaking')
    return true
  }, [speak, synthesisSupported, transitionTo])

  const sendMessage = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? input).trim()
    if (!content) {
      transitionTo('idle')
      return
    }
    if (!isHermesConfigured) {
      void messageApi.info('请先在 .env.local 中配置 Hermes API 地址和认证信息')
      transitionTo('idle')
      return
    }

    if (statusRef.current === 'thinking' || statusRef.current === 'speaking') {
      interruptActiveResponse()
    } else {
      stopListening()
      cancelSpeech()
    }

    setInput('')
    latestTranscriptRef.current = ''
    spokenSentenceBufferRef.current = ''
    responseCompleteRef.current = false
    resetRecognition()
    const userMessage = createMessage('user', content)
    setMessages((current) => [...current, userMessage])
    transitionTo('thinking')
    setStreamingText('')
    const requestController = new AbortController()
    activeRequestRef.current = requestController
    let responseText = ''
    let spokenAnySentence = false

    try {
      responseText = await streamChatCompletion(
        [{ role: userMessage.role, content: userMessage.content }],
        (delta) => {
          responseText += delta
          setStreamingText(responseText)

          const { sentences, rest } = takeCompletedSentences(`${spokenSentenceBufferRef.current}${delta}`)
          spokenSentenceBufferRef.current = rest
          for (const sentence of sentences) {
            spokenAnySentence = speakCompletedSentence(sentence) || spokenAnySentence
          }
        },
        requestController.signal,
        systemPrompt,
        historyRef.current,
      )
      if (!responseText.trim()) throw new HermesError('Hermes 返回了空回复', 'network')

      const remainingSpeech = spokenSentenceBufferRef.current.trim()
      if (remainingSpeech) {
        spokenAnySentence = speakCompletedSentence(remainingSpeech) || spokenAnySentence
      }
      spokenSentenceBufferRef.current = ''

      const assistantMessage = createMessage('assistant', responseText)
      setMessages((current) => [...current, assistantMessage])
      setHistory((current) => [
        ...current.slice(-(maxSavedMessages - 2)),
        { role: userMessage.role, content: userMessage.content },
        { role: assistantMessage.role, content: assistantMessage.content },
      ])
      setStreamingText('')
      setConnectionState('online')
      responseCompleteRef.current = true
      if (!spokenAnySentence) transitionTo('idle')
    } catch (error) {
      responseCompleteRef.current = true
      if (requestController.signal.aborted) return
      const fallback = error instanceof HermesError ? error.message : '贾维斯暂时不可用，请稍后再试'
      setStreamingText('')
      setConnectionState('offline')
      setMessages((current) => [...current, createMessage('assistant', fallback)])
      transitionTo('idle')
      void messageApi.error(fallback)
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null
      }
    }
  }, [
    cancelSpeech,
    input,
    interruptActiveResponse,
    messageApi,
    resetRecognition,
    speakCompletedSentence,
    stopListening,
    transitionTo,
  ])

  const submitVoiceTranscript = useCallback(() => {
    const transcript = latestTranscriptRef.current.trim()
    if (!transcript) {
      resetRecognition()
      setInput('')
      transitionTo('idle')
      return
    }
    void sendMessage(transcript)
  }, [resetRecognition, sendMessage, transitionTo])

  const handleSpeechStart = useCallback(() => {
    if (!recognitionSupported) {
      void messageApi.warning('当前浏览器不支持语音识别')
      return
    }

    if (statusRef.current === 'thinking' || statusRef.current === 'speaking') {
      interruptActiveResponse()
    } else {
      window.clearTimeout(submitVoiceTimerRef.current)
      resetRecognition()
      setInput('')
      latestTranscriptRef.current = ''
    }

    transitionTo('listening')
    startRecognition()
  }, [
    interruptActiveResponse,
    messageApi,
    recognitionSupported,
    resetRecognition,
    startRecognition,
    transitionTo,
  ])

  const handleSpeechEnd = useCallback(() => {
    if (statusRef.current !== 'listening') return
    stopListening()
    window.clearTimeout(submitVoiceTimerRef.current)
    submitVoiceTimerRef.current = window.setTimeout(submitVoiceTranscript, 350)
  }, [stopListening, submitVoiceTranscript])

  const {
    isListening: vadListening,
    start: startVad,
    stop: stopVad,
  } = useVoiceActivityDetector({
    onSpeechStart: handleSpeechStart,
    onSpeechEnd: handleSpeechEnd,
  })

  const isThinking = status === 'thinking'

  useEffect(() => {
    if (!isHermesConfigured) return
    let active = true
    checkHermesConnection().then((online) => {
      if (active) setConnectionState(online ? 'online' : 'offline')
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const combinedTranscript = `${finalText}${interimText}`
    if (!combinedTranscript || combinedTranscript === latestTranscriptRef.current) return
    latestTranscriptRef.current = combinedTranscript
    setInput(combinedTranscript)
  }, [finalText, interimText])

  useEffect(() => {
    if (recognitionError) void messageApi.warning(recognitionError)
  }, [messageApi, recognitionError])

  useEffect(() => {
    const savedMessages = messages.slice(-maxSavedMessages)
    if (savedMessages.length !== messages.length) {
      setMessages(savedMessages)
      return
    }
    if (savedMessages.length === 0) {
      localStorage.removeItem(storageKey)
      return
    }
    localStorage.setItem(storageKey, JSON.stringify(savedMessages))
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    let active = true
    startVad().catch((error: unknown) => {
      if (!active) return
      const fallback = error instanceof Error ? error.message : '语音活动检测启动失败'
      void messageApi.warning(fallback)
    })
    return () => {
      active = false
      stopVad()
    }
  }, [messageApi, startVad, stopVad])

  useEffect(() => {
    if (status === 'speaking' && responseCompleteRef.current && !isSpeaking) {
      transitionTo('idle')
    }
  }, [isSpeaking, status, transitionTo])

  useEffect(() => () => {
    window.clearTimeout(submitVoiceTimerRef.current)
    activeRequestRef.current?.abort()
    stopVad()
    cancelSpeech()
  }, [cancelSpeech, stopVad])

  const clearConversation = useCallback(() => {
    setMessages([])
    setHistory([])
    localStorage.removeItem(storageKey)
  }, [])

  const visibleStatusText = useMemo(() => {
    if (status === 'listening') return interimText || finalText || '正在聆听…'
    if (status === 'thinking') return streamingText || '正在思考'
    if (status === 'speaking') return streamingText || messages.at(-1)?.content || '正在回复'
    return '贾维斯待命中'
  }, [finalText, interimText, messages, status, streamingText])

  const connectionTag = {
    checking: { color: 'processing', icon: <LoadingOutlined />, text: '连接检测中' },
    online: { color: 'success', icon: <CheckCircleOutlined />, text: 'Hermes 在线' },
    offline: { color: 'error', icon: <CloseCircleOutlined />, text: 'Hermes 离线' },
    unconfigured: { color: 'default', icon: <CloseCircleOutlined />, text: '等待配置' },
  }[connectionState]

  const voiceTag = vadListening && recognitionSupported
    ? { color: 'processing', icon: <AudioOutlined />, text: '自动语音在线' }
    : { color: 'default', icon: <AudioOutlined />, text: '等待语音权限' }

  return (
    <main className="jarvis-shell">
      <section className="core-panel">
        <div className="brand-lockup">
          <span className="brand-mark" />
          <div>
            <Typography.Title level={4}>JARVIS</Typography.Title>
            <Typography.Text>全景 AI 助手控制台</Typography.Text>
          </div>
        </div>
        <div className={`status-readout status-${status}`}>
          <span className="status-dot" />
          <span className="status-label">{visibleStatusText}</span>
          {status === 'thinking' && <span className="thinking-dots"><i /><i /><i /></span>}
        </div>
        <JarvisCore status={status} />
        <div className="core-footer">
          <div className="core-tags">
            <Tag icon={connectionTag.icon} color={connectionTag.color}>{connectionTag.text}</Tag>
            <Tag icon={voiceTag.icon} color={voiceTag.color}>{voiceTag.text}</Tag>
          </div>
          <span>CORE / {status.toUpperCase()}</span>
        </div>
      </section>

      <Card className="conversation-panel" variant="borderless">
        <header className="conversation-header">
          <div>
            <Typography.Title level={4}>对话终端</Typography.Title>
            <Typography.Text type="secondary">消息由 Hermes Agent 处理</Typography.Text>
          </div>
          <div className="conversation-actions">
            <Tooltip title="清除对话">
              <Button
                type="text"
                shape="circle"
                icon={<DeleteOutlined />}
                onClick={clearConversation}
                disabled={messages.length === 0 && !streamingText}
              />
            </Tooltip>
            <Tooltip title={isSpeaking ? '停止播报' : synthesisSupported ? '语音播报已启用' : '浏览器不支持语音合成'}>
              <Button
                type="text"
                shape="circle"
                icon={isSpeaking ? <StopOutlined /> : <SoundOutlined />}
                onClick={isSpeaking ? cancelSpeech : undefined}
                disabled={!synthesisSupported}
              />
            </Tooltip>
          </div>
        </header>

        <section className="message-list" aria-live="polite">
          {messages.length === 0 && !streamingText ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={isHermesConfigured ? '向贾维斯发送第一条指令' : '配置 Hermes 后开始对话'}
            />
          ) : (
            messages.map((chatMessage) => (
              <article key={chatMessage.id} className={`message-row ${chatMessage.role}`}>
                <div className="message-meta">
                  <span>{chatMessage.role === 'user' ? '你' : 'JARVIS'}</span>
                  <time>{chatMessage.time}</time>
                </div>
                <div className="message-bubble">
                  <Markdown>{chatMessage.content}</Markdown>
                </div>
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
          {(recognitionListening || interimText) && (
            <div className="live-transcript"><span />{interimText || finalText || '正在聆听…'}</div>
          )}
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            autoSize={{ minRows: 1, maxRows: 5 }}
            placeholder={status === 'listening' ? '正在听你说…' : '也可以输入指令，Shift + Enter 换行'}
            disabled={isThinking}
          />
          <div className="composer-actions">
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              onClick={() => void sendMessage()}
              loading={isThinking}
              disabled={!input.trim()}
              aria-label="发送消息"
            />
          </div>
        </footer>
      </Card>
    </main>
  )
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
        <ConsoleApp />
      </AntApp>
    </ConfigProvider>
  )
}
