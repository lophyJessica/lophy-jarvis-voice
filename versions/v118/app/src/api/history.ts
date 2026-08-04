import { buildJarvisAuthHeaders, handleJarvisAuthResponse } from '../auth'
import { normalizeStoredRecord, type SyncMessage } from '../db'
import { getApiBase } from './base'
import { createTimedRequest } from './request'

const historyUrl = () => `${getApiBase()}/p/jarvis/history`

function readMessages(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const record = payload as { messages?: unknown; data?: { messages?: unknown } }
  const messages = record.messages ?? record.data?.messages
  return Array.isArray(messages) ? messages : []
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

export async function loadCloudHistory(limit = 200): Promise<SyncMessage[]> {
  const response = await historyFetch(`${historyUrl()}?limit=${limit}`)
  const raw = readMessages(await response.json())
  const total = raw.length
  const normalized: SyncMessage[] = []
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const message = normalizeStoredRecord(item as Record<string, unknown>, index, total)
    if (message) normalized.push(message)
  })
  return normalized.slice(-limit)
}

export async function saveCloudHistory(messages: SyncMessage[]) {
  await historyFetch(historyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.slice(-200) }),
  })
}

export async function clearCloudHistory() {
  await historyFetch(historyUrl(), { method: 'DELETE' })
}
