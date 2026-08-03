export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MessageContent = string | ContentPart[]

export function isMessageContent(value: unknown): value is MessageContent {
  if (typeof value === 'string') return true
  if (!Array.isArray(value)) return false

  return value.every((part) => {
    if (!part || typeof part !== 'object') return false
    const record = part as Record<string, unknown>
    if (record.type === 'text') return typeof record.text === 'string'
    if (record.type !== 'image_url' || !record.image_url || typeof record.image_url !== 'object') {
      return false
    }
    return typeof (record.image_url as Record<string, unknown>).url === 'string'
  })
}

export function getMessageText(content: MessageContent): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function getMessageImageUrls(content: MessageContent): string[] {
  if (typeof content === 'string') return []
  return content
    .filter((part): part is Extract<ContentPart, { type: 'image_url' }> => part.type === 'image_url')
    .map((part) => part.image_url.url)
}

export function buildMessageContent(text: string, images: string[]): MessageContent {
  const trimmed = text.trim()
  if (images.length === 0) return trimmed

  return [
    { type: 'text', text: trimmed || '请查看图片' },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
}

export interface PendingDocumentPayload {
  filename: string
  path: string
}

export const USER_INSTRUCTION_TAG = '【用户指令】'
export const DOCUMENT_CONTENT_TAG = '【文档内容】'

export function buildDocumentWireText(filename: string, path: string): string {
  return `${DOCUMENT_CONTENT_TAG}${filename}：\n请读取文件 ${path} 并处理以上指令`
}

export interface UserDocumentMessageDisplay {
  isDocumentMessage: boolean
  filenames: string[]
  instruction: string
}

/** 从已发送的 wire content 提取用户可见文案（不含文档正文） */
export function getUserDocumentMessageDisplay(content: MessageContent): UserDocumentMessageDisplay {
  if (typeof content === 'string') {
    return { isDocumentMessage: false, filenames: [], instruction: content }
  }

  const textParts = content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)

  if (textParts.length === 0) {
    return { isDocumentMessage: false, filenames: [], instruction: '' }
  }

  const filenames: string[] = []
  const instructions: string[] = []
  let sawDocumentPart = false

  for (const text of textParts) {
    if (text.startsWith(USER_INSTRUCTION_TAG)) {
      instructions.push(text.slice(USER_INSTRUCTION_TAG.length))
      continue
    }
    if (text.startsWith(DOCUMENT_CONTENT_TAG)) {
      sawDocumentPart = true
      const rest = text.slice(DOCUMENT_CONTENT_TAG.length)
      const splitMatch = rest.match(/^(.+?)[：:]\n/s)
      if (splitMatch?.[1]) filenames.push(splitMatch[1].trim())
      else {
        const firstLine = rest.split('\n')[0]?.replace(/[：:]\s*$/, '').trim()
        if (firstLine) filenames.push(firstLine)
      }
    }
  }

  if (!sawDocumentPart) {
    return { isDocumentMessage: false, filenames: [], instruction: textParts.join('\n') }
  }

  return {
    isDocumentMessage: true,
    filenames,
    instruction: instructions.join('\n').trim(),
  }
}

export function formatUserDocumentMessageDisplay(display: UserDocumentMessageDisplay): string {
  if (!display.isDocumentMessage) return display.instruction
  const lines = display.filenames.map((name) => `📄 ${name}`)
  if (display.instruction) lines.push(display.instruction)
  return lines.join('\n\n')
}

/** 用户指令 + 文档上下文 + 可选图片，供 Hermes 多段 content */
export function buildComposerMessageContent(
  userInstruction: string,
  images: string[],
  documents: PendingDocumentPayload[],
): MessageContent {
  const instruction = userInstruction.trim()
  if (documents.length === 0) {
    return buildMessageContent(instruction, images)
  }

  const parts: ContentPart[] = [
    { type: 'text', text: `${USER_INSTRUCTION_TAG}${instruction}` },
    ...documents.map((doc) => ({
      type: 'text' as const,
      text: buildDocumentWireText(doc.filename, doc.path),
    })),
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
  return parts
}
