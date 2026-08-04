import { Capacitor } from '@capacitor/core'

const PRODUCTION_API_ORIGIN = 'https://pmlophy.com'

/** 浏览器：''（相对路径，走当前站点或 Vite 代理）；Capacitor APK：完整 VPS 域名 */
export function getApiBase(): string {
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    return PRODUCTION_API_ORIGIN
  }
  return ''
}
