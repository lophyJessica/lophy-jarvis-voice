import { memo, useEffect, useMemo, useRef } from 'react'
import { Button, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { copyTextToClipboard } from '../utils/clipboard'
import { renderMarkdown } from '../utils/markdown'

const textareaTagPattern = /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi
const fencedCodePattern = /```[^\n]*\n?[\s\S]*?```/g

type RenderContentPart = { type: 'markdown' | 'textarea'; text: string }

function getFencedCodeRanges(content: string) {
  const ranges: Array<{ start: number; end: number }> = []
  const pattern = new RegExp(fencedCodePattern.source, 'g')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }

  return ranges
}

function isInsideFencedCode(index: number, ranges: Array<{ start: number; end: number }>) {
  return ranges.some((range) => index >= range.start && index < range.end)
}

function splitTextareaParts(content: string): RenderContentPart[] {
  const fencedRanges = getFencedCodeRanges(content)
  const parts: RenderContentPart[] = []
  let lastIndex = 0
  const pattern = new RegExp(textareaTagPattern.source, 'gi')
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    if (isInsideFencedCode(match.index, fencedRanges)) continue

    if (match.index > lastIndex) {
      parts.push({ type: 'markdown', text: content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'textarea', text: match[1] ?? '' })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'markdown', text: content.slice(lastIndex) })
  }

  if (parts.length === 0) {
    parts.push({ type: 'markdown', text: content })
  }

  return parts
}

function CopyableTextareaBlock({
  text,
  onCopy,
}: {
  text: string
  onCopy?: (text: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  return (
    <span className="markdown-textarea-shell">
      <textarea
        ref={textareaRef}
        readOnly
        className="markdown-textarea"
        value={text}
      />
      <span className="markdown-textarea-copy-anchor">
        <Tooltip title="复制">
          <Button
            type="text"
            size="small"
            shape="circle"
            icon={<CopyOutlined />}
            className="markdown-textarea-copy-button"
            onClick={() => {
              const value = textareaRef.current?.value ?? text
              if (onCopy) {
                void onCopy(value)
                return
              }
              void copyTextToClipboard(value)
            }}
            aria-label="复制文本框内容"
          />
        </Tooltip>
      </span>
    </span>
  )
}

const MemoCopyableTextareaBlock = memo(CopyableTextareaBlock)

const MarkdownHtml = memo(function MarkdownHtml({
  content,
  className,
  onCopy,
}: {
  content: string
  className?: string
  onCopy?: (text: string) => void
}) {
  const html = useMemo(() => renderMarkdown(content), [content])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.code-copy-btn')
      if (!button || !root.contains(button)) return
      const payload = button.getAttribute('data-copy')
      if (!payload) return
      event.preventDefault()

      void (async () => {
        try {
          const decoded = decodeURIComponent(payload)
          if (onCopy) {
            await onCopy(decoded)
            return
          }
          await copyTextToClipboard(decoded)
        } catch {
          return
        }
        const previousLabel = button.textContent
        button.textContent = '已复制'
        window.setTimeout(() => {
          button.textContent = previousLabel ?? '复制'
        }, 1500)
      })()
    }

    root.addEventListener('click', handleClick)
    return () => root.removeEventListener('click', handleClick)
  }, [html, onCopy])

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

export const MessageRichContent = memo(function MessageRichContent({
  content,
  className,
  onCopy,
}: {
  content: string
  className?: string
  onCopy?: (text: string) => void
}) {
  const parts = useMemo(() => splitTextareaParts(content), [content])

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'textarea') {
          return (
            <MemoCopyableTextareaBlock
              key={`textarea-${index}`}
              text={part.text}
              onCopy={onCopy}
            />
          )
        }
        if (!part.text.trim()) return null
        return (
          <MarkdownHtml
            key={`markdown-${index}`}
            content={part.text}
            className={className}
            onCopy={onCopy}
          />
        )
      })}
    </>
  )
})
