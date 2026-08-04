import { Capacitor } from '@capacitor/core'

/** Capacitor 原生壳（APK/IPA），WebView 可能加载 https://localhost 但非浏览器开发环境 */
export function isCapacitorNative(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform()
}

export function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/** 仅 Vite 本地开发：排除 Capacitor 原生壳对 localhost 的误判 */
export function isBrowserDevMode(): boolean {
  return !isCapacitorNative() && isLocalDevHost()
}

/**
 * Capacitor WebView 上 AudioWorklet 不可靠（可能加载成功但不产出 PCM）。
 * 原生壳强制 MediaRecorder + webm 走 asr-stream/chunk。
 */
export function preferWebmStreamingCapture(): boolean {
  return isCapacitorNative()
}
