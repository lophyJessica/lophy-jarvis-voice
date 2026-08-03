import { memo } from 'react'
import { Button, Tooltip } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import type { StoredMessage } from '../db'
import { MessageRichContent } from './MessageRichContent'
import { getMessageImageUrls, getMessageText, type MessageContent } from '../types/messages'

const messagePreviewLength = 1_200

interface ChatMessageRowProps {
  chatMessage: StoredMessage
  assistantLabel: string
  displayTime: string
  expanded: boolean
  copied: boolean
  onToggleExpand: (id: string) => void
  onCopy: (text: string, key: string) => void
}

function MessageImages({ content }: { content: MessageContent }) {
  const imageUrls = getMessageImageUrls(content)
  if (imageUrls.length === 0) return null
  return (
    <div className="message-image-grid">
      {imageUrls.map((src, index) => (
        <img
          key={`${src.slice(0, 48)}-${index}`}
          src={src}
          alt={`消息图片 ${index + 1}`}
          className="message-image-thumbnail"
        />
      ))}
    </div>
  )
}

const ChatMessageRow = memo(function ChatMessageRow({
  chatMessage,
  assistantLabel,
  displayTime,
  expanded,
  copied,
  onToggleExpand,
  onCopy,
}: ChatMessageRowProps) {
  const textContent = getMessageText(chatMessage.content)
  const isLong = textContent.length > messagePreviewLength
  const handleCopyContent = (text: string) => onCopy(text, chatMessage.id)

  return (
    <article className={`message-row ${chatMessage.role}`}>
      <div className="message-meta">
        <span>{chatMessage.role === 'user' ? '你' : assistantLabel}</span>
        <time>{displayTime}</time>
        <Tooltip title={copied ? '已复制' : '复制消息'}>
          <Button
            className="message-copy-button"
            data-testid={`copy-message-${chatMessage.id}`}
            type="text"
            size="small"
            shape="circle"
            icon={copied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={() => onCopy(textContent, chatMessage.id)}
            aria-label={`复制${chatMessage.role === 'user' ? '用户' : assistantLabel}消息`}
          />
        </Tooltip>
      </div>
      <div className="message-bubble message-content">
        {isLong && !expanded ? (
          <>
            <p className="message-plain-preview">{`${textContent.slice(0, messagePreviewLength)}…`}</p>
            <MessageImages content={chatMessage.content} />
            <Button type="link" size="small" onClick={() => onToggleExpand(chatMessage.id)} style={{ padding: 0, height: 'auto' }}>
              展开全文
            </Button>
          </>
        ) : (
          <>
            {textContent && (
              <MessageRichContent
                content={textContent}
                className={isLong ? 'expand-content message-markdown' : 'message-markdown'}
                onCopy={handleCopyContent}
              />
            )}
            <MessageImages content={chatMessage.content} />
            {isLong && (
              <Button type="link" size="small" onClick={() => onToggleExpand(chatMessage.id)} style={{ padding: 0, height: 'auto' }}>
                收起
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  )
})

export default ChatMessageRow
