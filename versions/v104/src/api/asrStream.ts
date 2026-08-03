const asrStreamBase = '/p/jarvis/asr-stream'
const streamRequestTimeoutMs = 30_000

interface StartPayload {
  ok?: boolean
  session_id?: unknown
}

interface ChunkPayload {
  ok?: boolean
  text?: unknown
  mid?: unknown
  mid_text?: unknown
  result?: unknown
  partial?: unknown
}

interface EndPayload {
  ok?: boolean
  text?: unknown
  result?: unknown
}

async function streamRequest(path: string, init: RequestInit, externalSignal?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('ASR stream request timed out', 'TimeoutError'))
  }, streamRequestTimeoutMs)

  try {
    const response = await fetch(`${asrStreamBase}/${path}`, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error(`流式语音识别请求失败（${response.status}）`)
    return response
  } catch (error) {
    if (timedOut) throw new Error('流式语音识别请求超时')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

export async function startAsrStream(externalSignal?: AbortSignal) {
  const response = await streamRequest('start', { method: 'POST' }, externalSignal)
  const payload = await response.json() as StartPayload
  if (payload.ok !== true || typeof payload.session_id !== 'string' || !payload.session_id) {
    throw new Error('流式语音识别会话创建失败')
  }
  return payload.session_id
}

function flattenTextPieces(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenTextPieces(item))
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nested = [
      record.text,
      record.mid,
      record.MidText,
      record.mid_text,
      record.partial,
      record.result,
      record.content,
    ]
    for (const item of nested) {
      const pieces = flattenTextPieces(item)
      if (pieces.length > 0) return pieces
    }
  }
  return []
}

/** 百度 chunk：text 可为 MID 字符串或**多句数组**（须全部合并，不能只取最长一项） */
function extractChunkPieces(text: unknown): string[] {
  return flattenTextPieces(text)
}

function extractChunkPayloadPieces(payload: ChunkPayload): string[] {
  const candidates = [payload.text, payload.mid, payload.mid_text, payload.partial, payload.result]
  for (const candidate of candidates) {
    const pieces = extractChunkPieces(candidate)
    if (pieces.length > 0) return pieces
  }
  return []
}

function normalizeAsrText(text: unknown): string {
  const pieces = flattenTextPieces(text)
  if (pieces.length === 0) return ''
  if (pieces.length === 1) return pieces[0]
  return pieces.join('')
}

function pickTextCandidate(value: unknown): string {
  const pieces = flattenTextPieces(value)
  if (pieces.length === 0) return ''
  return pieces.reduce((a, b) => (a.length >= b.length ? a : b), pieces[0])
}

export async function uploadAsrStreamChunk(sessionId: string, blob: Blob, externalSignal?: AbortSignal) {
  const response = await streamRequest('chunk', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'audio/webm',
      'X-Session-Id': sessionId,
    },
    body: blob,
  }, externalSignal)
  const payload = await response.json() as ChunkPayload
  const pieces = extractChunkPayloadPieces(payload)
  if (payload.ok !== true && pieces.length === 0) throw new Error('流式语音识别音频块处理失败')
  return pieces
}

export async function endAsrStream(sessionId: string, externalSignal?: AbortSignal) {
  const response = await streamRequest('end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }, externalSignal)
  const payload = await response.json() as EndPayload
  const text = normalizeAsrText(payload.text) || pickTextCandidate(payload.result)
  if (payload.ok !== true && !text) throw new Error('流式语音识别会话结束失败')
  return text
}
