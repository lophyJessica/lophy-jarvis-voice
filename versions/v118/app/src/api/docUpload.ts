import { buildJarvisAuthHeaders, handleJarvisAuthResponse } from '../auth'
import { getApiBase } from './base'
import { createTimedRequest } from './request'

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set([
  'apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp',
])

export interface FileUploadResult {
  ok: boolean
  filename: string
  path: string
  size?: number
  ext?: string
}

export interface PendingDocument {
  id: string
  filename: string
  path: string
}

export function isDocumentFile(file: File): boolean {
  return !isImageFile(file)
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const lowerName = file.name.toLowerCase()
  const extension = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : ''
  return IMAGE_EXTENSIONS.has(extension)
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

export async function uploadJarvisFile(file: File, jarvisUser: string): Promise<FileUploadResult> {
  const trimmedUser = jarvisUser.trim()
  if (!trimmedUser) {
    throw new Error('请先登录后再上传文件')
  }

  const formData = new FormData()
  formData.append('file', file)

  const timedRequest = createTimedRequest()
  try {
    const response = handleJarvisAuthResponse(await fetch(`${getApiBase()}/p/jarvis/file/upload`, {
      method: 'POST',
      headers: buildJarvisAuthHeaders({
        'X-Jarvis-User': trimmedUser,
      }),
      body: formData,
      signal: timedRequest.signal,
    }))

    const payload = await response.json() as FileUploadResult & { error?: string; message?: string; ok?: boolean }
    if (!response.ok) {
      const message = payload.error ?? payload.message ?? `文件上传失败（${response.status}）`
      throw new Error(message)
    }

    if (payload.ok === false) {
      throw new Error(payload.error ?? payload.message ?? '文件上传失败')
    }

    const filename = typeof payload.filename === 'string' && payload.filename.length > 0
      ? payload.filename
      : file.name
    const path = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!path) {
      throw new Error('上传成功但未返回文件路径')
    }

    return {
      ok: true,
      filename,
      path,
      size: payload.size,
      ext: payload.ext,
    }
  } finally {
    timedRequest.dispose()
  }
}

/** @deprecated 使用 uploadJarvisFile */
export const uploadDocument = uploadJarvisFile
