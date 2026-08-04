import { Capacitor } from '@capacitor/core'

const PRODUCTION_API_ORIGIN = 'https://pmlophy.com'

function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (Capacitor.isNativePlatform()) return true
    // 双保险：部分 WebView 里 isNativePlatform 偶发不可靠
    const platform = Capacitor.getPlatform()
    return platform === 'android' || platform === 'ios'
  } catch {
    return false
  }
}

/** 浏览器：''（相对路径，走当前站点或 Vite 代理）；Capacitor APK：完整 VPS 域名 */
export function getApiBase(): string {
  return isNativeShell() ? PRODUCTION_API_ORIGIN : ''
}
