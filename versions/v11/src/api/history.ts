import { buildJarvisAuthHeaders, handleJarvisAuthResponse } from '../auth'
import { createTimedRequest } from './request'

const historyUrl = '/p/jarvis/history'

export interface CloudHistoryMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  time?: string
}

function readMessages(payload: unknown): CloudHistoryMessage[] {
  if (Array.isArray(payload)) return payload as CloudHistoryMessage[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as { messages?: unknown; data?: { messages?: unknown } }
  const messages = record.messages ?? record.data?.messages
  return Array.isArray(messages) ? messages as CloudHistoryMessage[] : []
}

async function historyFetch(input: string, init?: RequestInit) {
  const timedRequest = createTimedRequest(init?.signal ?? undefined)
  try {
    const response = handleJarvisAuthResponse(await fetch(input, {
      ...init,
      headers: buildJarvisAuthHeaders(init?.headers
        ? Object.fromEntries(new Headers(init.headers).entries())
        : undefined),
      signal: timedRequest.signal,
    }))
    if (!response.ok) throw new Error(`History request failed (${response.status})`)
    return response
  } finally {
    timedRequest.dispose()
  }
}

export async function loadCloudHistory(limit = 200) {
  const response = await historyFetch(`${historyUrl}?limit=${limit}`)
  return readMessages(await response.json())
}

export async function saveCloudHistory(messages: CloudHistoryMessage[]) {
  await historyFetch(historyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
}

export async function clearCloudHistory() {
  await historyFetch(historyUrl, { method: 'DELETE' })
}
