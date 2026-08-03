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
  text: string
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
    { type: 'text', text: `【用户指令】${instruction}` },
    ...documents.map((doc) => ({
      type: 'text' as const,
      text: `【文档内容】${doc.filename}：\n${doc.text}`,
    })),
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
  return parts
}
