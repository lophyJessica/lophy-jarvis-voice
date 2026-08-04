import { buildJarvisAuthHeaders, handleJarvisAuthResponse } from '../auth'
import type { MessageContent } from '../types/messages'
import { getApiBase } from './base'
import { createTimedRequest, REQUEST_TIMEOUT_MS } from './request'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: ChatRole
  content: MessageContent
  // Optional app metadata carried alongside history; stripped before the model request.
  id?: string
  createdAt?: string
}

const jarvisApiRoot = () => `${getApiBase()}/p/jarvis`

export const defaultSystemPrompt =
  '你是罗宾（Robin），刘龙飞（路飞）的个人 AI 助手。用中文自然、简洁、可靠地回答，需要时可读取图片内容。'

export const isHermesConfigured = true

export class HermesError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'unavailable' | 'configuration' | 'unauthorized',
  ) {
    super(message)
    this.name = 'HermesError'
  }
}

function chatHeaders() {
  return buildJarvisAuthHeaders({ 'Content-Type': 'application/json' })
}

export async function checkHermesConnection() {
  if (!isHermesConfigured) return false
  const timedRequest = createTimedRequest()
  try {
    // /v1/models is intentionally public: it is the online health check.
    const response = await fetch(`${jarvisApiRoot()}/v1/models`, { signal: timedRequest.signal })
    return response.status === 200
  } catch {
    return false
  } finally {
    timedRequest.dispose()
  }
}

export async function transcribeAudio(blob: Blob, externalSignal?: AbortSignal) {
  const timedRequest = createTimedRequest(externalSignal)
  try {
    const response = await fetch(`${getApiBase()}/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob,
      signal: timedRequest.signal,
    })
    if (!response.ok) {
      throw new HermesError(`语音识别失败（${response.status}）`, response.status >= 500 ? 'unavailable' : 'network')
    }

    const payload = await response.json() as { text?: unknown }
    return typeof payload.text === 'string' ? payload.text.trim() : ''
  } catch (error) {
    if (timedRequest.didTimeout()) throw new HermesError('语音识别超时，请重试', 'timeout')
    throw error
  } finally {
    timedRequest.dispose()
  }
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  externalSignal?: AbortSignal,
  systemPrompt = defaultSystemPrompt,
  history: ChatMessage[] = [],
) {
  if (!isHermesConfigured) {
    throw new HermesError('对话服务尚未配置', 'configuration')
  }

  const controller = new AbortController()
  let timedOut = false
  let timeoutId = 0
  const resetTimeout = () => {
    window.clearTimeout(timeoutId)
    timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
  }
  const abortFromExternal = () => controller.abort()
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  resetTimeout()

  try {
    // Only role/content go to the model; drop any app metadata (id/createdAt).
    const toWire = ({ role, content }: ChatMessage): ChatMessage => ({ role, content })
    const requestMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map(toWire),
      ...messages.map(toWire),
    ]
    const response = handleJarvisAuthResponse(await fetch(`${jarvisApiRoot()}/v1/chat/completions`, {
      method: 'POST',
      headers: chatHeaders(),
      body: JSON.stringify({ model: 'jarvis', messages: requestMessages, stream: true }),
      signal: controller.signal,
    }))

    if (!response.ok) {
      if (response.status === 401) throw new HermesError('登录已过期，请重新登录', 'unauthorized')
      if (response.status >= 500) throw new HermesError('罗宾暂时不可用，请稍后再试', 'unavailable')
      throw new HermesError(`Hermes 请求失败（${response.status}）`, 'network')
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.body || contentType.includes('application/json')) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content ?? ''
      if (content) onDelta(content)
      return content
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completeText = ''
    let finished = false

    while (!finished) {
      const { value, done } = await reader.read()
      if (done) break
      resetTimeout()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const normalized = line.trim()
        if (!normalized.startsWith('data:')) continue
        const data = normalized.slice(5).trim()
        if (data === '[DONE]') {
          finished = true
          break
        }
        try {
          const payload = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
          }
          const delta = payload.choices?.[0]?.delta?.content
            ?? payload.choices?.[0]?.message?.content
            ?? ''
          if (delta) {
            completeText += delta
            onDelta(delta)
          }
        } catch {
          // Ignore comments and malformed keep-alive frames.
        }
      }
    }
    return completeText
  } catch (error) {
    if (error instanceof HermesError) throw error
    if (timedOut) throw new HermesError('请求超时，请重试', 'timeout')
    if (externalSignal?.aborted) throw error
    throw new HermesError('网络连接失败，请检查罗宾服务配置', 'network')
  } finally {
    window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}
