import Dexie, { type Table } from 'dexie'
import type { ChatMessage } from './api/hermes'
import { isMessageContent, type MessageContent } from './types/messages'

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: MessageContent
  createdAt: string
}

export type SyncMessage = StoredMessage

const dbName = 'robin-console'
const maxStoreMessages = 200

class RobinHistoryDatabase extends Dexie {
  messages!: Table<StoredMessage, string>

  constructor() {
    super(dbName)
    this.version(1).stores({
      messages: 'id, createdAt',
    })
  }
}

const database = new RobinHistoryDatabase()

function isIsoTimestamp(value: string) {
  return !Number.isNaN(Date.parse(value))
}

function migrateCreatedAt(record: Record<string, unknown>, index: number, total: number): string {
  if (typeof record.createdAt === 'string' && record.createdAt.length > 0 && isIsoTimestamp(record.createdAt)) {
    return record.createdAt
  }
  if (typeof record.created_at === 'string' && record.created_at.length > 0 && isIsoTimestamp(record.created_at)) {
    return record.created_at
  }
  if (typeof record.updatedAt === 'number' && !Number.isNaN(record.updatedAt)) {
    return new Date(record.updatedAt).toISOString()
  }
  const timeRaw = record.time
  if (typeof timeRaw === 'string' && timeRaw.length > 0 && isIsoTimestamp(timeRaw)) {
    return new Date(Date.parse(timeRaw)).toISOString()
  }
  return new Date(Date.now() - (total - index) * 1000).toISOString()
}

export function normalizeStoredRecord(record: Record<string, unknown>, index: number, total: number): StoredMessage | null {
  const role = record.role
  const content = record.content
  if (role !== 'user' && role !== 'assistant') return null
  if (!isMessageContent(content)) return null

  const idRaw = record.id
  const id = typeof idRaw === 'string' && idRaw.length > 0 ? idRaw : `local-${index}`

  return { id, role, content, createdAt: migrateCreatedAt(record, index, total) }
}

export async function getLocalMessages(): Promise<StoredMessage[]> {
  const records = await database.messages.toArray()
  const total = records.length
  return records
    .map((record, index) => normalizeStoredRecord(record as unknown as Record<string, unknown>, index, total))
    .filter((message): message is StoredMessage => message !== null)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

export async function replaceLocalMessages(messages: StoredMessage[]): Promise<void> {
  const saved = messages.slice(-maxStoreMessages)
  await database.transaction('rw', database.messages, async () => {
    await database.messages.clear()
    if (saved.length > 0) await database.messages.bulkPut(saved)
  })
}

export async function clearLocalMessages(): Promise<void> {
  await database.messages.clear()
}

function messageContentKey(message: { role: string; content: MessageContent; createdAt: string }) {
  const contentKey = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `${message.role}\u0000${contentKey}\u0000${message.createdAt}`
}

export function mergeMessages(local: StoredMessage[], server: SyncMessage[]): StoredMessage[] {
  const merged = new Map<string, StoredMessage>()
  const contentKeys = new Set<string>()

  for (const message of server) {
    contentKeys.add(messageContentKey(message))
    merged.set(message.id, { ...message })
  }
  for (const message of local) {
    if (merged.has(message.id)) continue
    const key = messageContentKey(message)
    if (contentKeys.has(key)) continue
    contentKeys.add(key)
    merged.set(message.id, message)
  }

  return Array.from(merged.values()).sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  )
}

export function createStoredMessage(role: 'user' | 'assistant', content: MessageContent): StoredMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }
}

export function toChatHistory(messages: StoredMessage[]): ChatMessage[] {
  return messages.map(({ role, content, createdAt, id }) => ({ role, content, createdAt, id }))
}
