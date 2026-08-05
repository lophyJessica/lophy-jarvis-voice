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

/**
 * 浏览器：''（相对路径 / Vite 代理）。
 * Capacitor APK：返回 VPS 绝对域（热更新同源时也可为 ''，绝对域同域无冲突）。
 */
export function getApiBase(): string {
  return isNativeShell() ? PRODUCTION_API_ORIGIN : ''
}
