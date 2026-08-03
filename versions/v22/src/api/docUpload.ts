import { buildJarvisAuthHeaders, handleJarvisAuthResponse } from '../auth'
import { createTimedRequest } from './request'

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
export const MAX_OUTGOING_DOCUMENT_CHARS = 5000

const DOC_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx'])

export interface DocUploadResult {
  type?: string
  filename: string
  pages?: number
  sheets?: number
  text: string
  truncated?: boolean
}

export interface PendingDocument {
  id: string
  filename: string
  text: string
  truncated?: boolean
}

export function isDocumentFile(file: File): boolean {
  const lowerName = file.name.toLowerCase()
  const extension = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : ''
  if (DOC_EXTENSIONS.has(extension)) return true
  if (file.type === 'application/pdf') return true
  if (file.type.includes('wordprocessingml')) return true
  if (file.type.includes('spreadsheetml')) return true
  return false
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export function collectClipboardFiles(items: DataTransferItemList): File[] {
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

export function truncateDocumentText(text: string, maxChars = MAX_OUTGOING_DOCUMENT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: `${text.slice(0, maxChars)}\n…（内容已截断）`, truncated: true }
}

export function formatDocumentContextBlock(doc: PendingDocument): string {
  return `【文档内容】${doc.filename}：\n${doc.text}`
}

export async function uploadDocument(file: File): Promise<DocUploadResult> {
  const formData = new FormData()
  formData.append('file', file)

  const timedRequest = createTimedRequest()
  try {
    const response = handleJarvisAuthResponse(await fetch('/p/jarvis/doc/upload', {
      method: 'POST',
      headers: buildJarvisAuthHeaders(),
      body: formData,
      signal: timedRequest.signal,
    }))

    const payload = await response.json() as DocUploadResult & { error?: string; message?: string }
    if (!response.ok) {
      const message = payload.error ?? payload.message ?? `文档上传失败（${response.status}）`
      throw new Error(message)
    }

    const filename = typeof payload.filename === 'string' && payload.filename.length > 0
      ? payload.filename
      : file.name
    const rawText = typeof payload.text === 'string' ? payload.text : ''
    const { text, truncated } = truncateDocumentText(rawText)

    return {
      type: payload.type,
      filename,
      pages: payload.pages,
      sheets: payload.sheets,
      text,
      truncated: truncated || Boolean(payload.truncated),
    }
  } finally {
    timedRequest.dispose()
  }
}
