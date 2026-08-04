import { getApiBase } from './api/base'

export const JARVIS_TOKEN_KEY = 'jarvis-token'
export const JARVIS_USERNAME_KEY = 'jarvis-username'

export function getJarvisAuthLoginUrl() {
  return `${getApiBase()}/p/jarvis/auth/login`
}

export function getJarvisAuthVerifyUrl() {
  return `${getApiBase()}/p/jarvis/auth/verify`
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function notifyUnauthorized() {
  unauthorizedHandler?.()
}

export function getJarvisToken() {
  return localStorage.getItem(JARVIS_TOKEN_KEY)
}

export function clearJarvisAuth() {
  localStorage.removeItem(JARVIS_TOKEN_KEY)
  localStorage.removeItem(JARVIS_USERNAME_KEY)
}

export function buildJarvisAuthHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = { ...extra }
  const token = getJarvisToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export function handleJarvisAuthResponse(response: Response) {
  if (response.status === 401) notifyUnauthorized()
  return response
}

export type TokenVerifyResult = 'valid' | 'invalid' | 'network-error'

/**
 * 启动时校验 token：200 → valid；401 → invalid（如改密后旧 token 失效）；
 * 其他/网络错误 → network-error（宽容处理，先进主界面）。
 */
export async function verifyJarvisToken(): Promise<TokenVerifyResult> {
  const token = getJarvisToken()
  if (!token) return 'invalid'

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(getJarvisAuthVerifyUrl(), {
      method: 'POST',
      headers: buildJarvisAuthHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
      signal: controller.signal,
    })
    if (response.status === 401) return 'invalid'
    if (response.ok) return 'valid'
    // 5xx / 其他状态：不确定，宽容放行
    return 'network-error'
  } catch {
    return 'network-error'
  } finally {
    window.clearTimeout(timeoutId)
  }
}
