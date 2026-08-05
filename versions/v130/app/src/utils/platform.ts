import { Capacitor } from '@capacitor/core'

/**
 * Capacitor 原生壳（APK/IPA）。
 * 热更新后 WebView origin 可能是 pmlophy.com，判定只看 Capacitor 注入，与 URL 无关。
 * → APK 语音（webm 整段 /asr）必须继续走此分支，禁止改成按 hostname 判断。
 */
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
 * 原生壳使用 MediaRecorder webm，收尾时整段 POST /asr（不走 asr-stream/chunk）。
 */
export function preferWebmStreamingCapture(): boolean {
  return isCapacitorNative()
}
