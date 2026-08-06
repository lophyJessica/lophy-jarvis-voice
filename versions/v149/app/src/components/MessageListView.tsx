import { memo, useMemo, useState, type UIEvent } from 'react'
import { Button, Empty, Tooltip } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import type { StoredMessage } from '../db'
import ChatMessageRow from './ChatMessageRow'
import { MessageRichContent } from './MessageRichContent'
import { getMessageText } from '../types/messages'

const MESSAGE_RENDER_CAP = 100

interface MessageListViewProps {
  assistantLabel: string
  copiedKey: string
  expandedMessageIds: Set<string>
  isVoiceMode: boolean
  messageListRef: React.RefObject<HTMLElement | null>
  messages: StoredMessage[]
  realtimeText: string
  streamingText: string
  onCopy: (text: string, key: string, sourceElement?: HTMLTextAreaElement | null) => void
  onScroll: (event: UIEvent<HTMLElement>) => void
  onToggleExpand: (id: string) => void
}

function formatMessageDisplayTime(createdAt: string) {
  const parsed = Date.parse(createdAt)
  if (Number.isNaN(parsed)) return '--:--'
  // API/history timestamps are ISO-8601 UTC (usually ending in `Z`).
  // Intl deliberately omits `timeZone`, so the browser/WebView's local zone
  // (CST +08:00 on the user's APK) is used for every message source.
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(parsed)).replace(/\//g, '-')
}

const MessageListView = memo(function MessageListView({
  assistantLabel,
  copiedKey,
  expandedMessageIds,
  isVoiceMode,
  messageListRef,
  messages,
  realtimeText,
  streamingText,
  onCopy,
  onScroll,
  onToggleExpand,
}: MessageListViewProps) {
  const [showAllMessages, setShowAllMessages] = useState(false)
  const hiddenCount = messages.length > MESSAGE_RENDER_CAP && !showAllMessages
    ? messages.length - MESSAGE_RENDER_CAP
    : 0

  const renderedMessages = useMemo(() => {
    if (hiddenCount === 0) return messages
    return messages.slice(-MESSAGE_RENDER_CAP)
  }, [hiddenCount, messages])
  const realtimePreviewVisible = useMemo(() => {
    if (!realtimeText.trim()) return false
    const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!latestAssistant) return true
    const normalize = (value: string) => value.replace(/\r\n/g, '\n').trim()
    return normalize(getMessageText(latestAssistant.content)) !== normalize(realtimeText)
  }, [messages, realtimeText])

  return (
    <div className="message-list-shell">
      <section
        ref={messageListRef}
        className="message-list"
        data-testid="message-list"
        tabIndex={0}
        aria-label="聊天历史"
        aria-live="polite"
        onScroll={onScroll}
      >
        {hiddenCount > 0 && (
          <div className="message-list-cap-banner">
            <span>较早 {hiddenCount} 条未显示（减轻输入卡顿）</span>
            <Button type="link" size="small" onClick={() => setShowAllMessages(true)}>
              显示全部
            </Button>
          </div>
        )}
        {messages.length === 0 && !streamingText && !realtimePreviewVisible ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={isVoiceMode ? '直接对罗宾说话即可开始' : '输入文字或粘贴图片，开始与罗宾对话'}
          />
        ) : (
          renderedMessages.map((chatMessage) => (
            <ChatMessageRow
              key={chatMessage.id}
              chatMessage={chatMessage}
              assistantLabel={assistantLabel}
              displayTime={formatMessageDisplayTime(chatMessage.createdAt)}
              expanded={expandedMessageIds.has(chatMessage.id)}
              copied={copiedKey === chatMessage.id}
              onToggleExpand={onToggleExpand}
              onCopy={onCopy}
            />
          ))
        )}
        {streamingText && (
          <article className="message-row assistant streaming">
            <div className="message-meta">
              <span>{assistantLabel}</span>
              <time>实时回复</time>
              <Tooltip title={copiedKey === 'streaming' ? '已复制' : '复制消息'}>
                <Button
                  className="message-copy-button"
                  type="text"
                  size="small"
                  shape="circle"
                  icon={copiedKey === 'streaming' ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={() => void onCopy(streamingText, 'streaming')}
                  aria-label="复制实时回复"
                />
              </Tooltip>
            </div>
            <div className="message-bubble message-content streaming-bubble">
              <MessageRichContent
                content={streamingText}
                className="expand-content message-markdown"
                onCopy={(text) => void onCopy(text, 'streaming')}
              />
              <span className="stream-caret" />
            </div>
          </article>
        )}
        {realtimePreviewVisible && (
          <article className="message-row assistant realtime-preview">
            <div className="message-meta">
              <span>{assistantLabel}</span>
              <time>实时回复</time>
              <Tooltip title={copiedKey === 'realtime' ? '已复制' : '复制消息'}>
                <Button
                  className="message-copy-button"
                  type="text"
                  size="small"
                  shape="circle"
                  icon={copiedKey === 'realtime' ? <CheckOutlined /> : <CopyOutlined />}
                  onClick={() => void onCopy(realtimeText, 'realtime')}
                  aria-label="复制实时回复"
                />
              </Tooltip>
            </div>
            <div className="message-bubble message-content">
              <MessageRichContent
                content={realtimeText}
                className="message-markdown"
                onCopy={(text) => void onCopy(text, 'realtime')}
              />
            </div>
          </article>
        )}
      </section>
    </div>
  )
})

export default MessageListView
