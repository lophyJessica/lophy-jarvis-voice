const asrStreamBase = '/p/jarvis/asr-stream'
const streamRequestTimeoutMs = 30_000

interface StartPayload {
  ok?: boolean
  session_id?: unknown
}

interface ChunkPayload {
  ok?: boolean
  text?: unknown
}

interface EndPayload {
  ok?: boolean
  text?: unknown
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
  if (payload.ok !== true) throw new Error('流式语音识别音频块处理失败')
  return Array.isArray(payload.text)
    ? payload.text.filter((item): item is string => typeof item === 'string')
    : []
}

export async function endAsrStream(sessionId: string, externalSignal?: AbortSignal) {
  const response = await streamRequest('end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }, externalSignal)
  const payload = await response.json() as EndPayload
  if (payload.ok !== true) throw new Error('流式语音识别会话结束失败')
  return typeof payload.text === 'string' ? payload.text.trim() : ''
}
