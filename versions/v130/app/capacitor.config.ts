import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.robin.app',
  appName: 'Robin',
  webDir: 'dist',
  server: {
    // 热更新：WebView 直接加载 VPS，部署即生效，无需重装 APK
    url: 'https://pmlophy.com/jarvis-voice/',
    cleartext: false,
    allowNavigation: ['pmlophy.com', '*.pmlophy.com'],
  },
};

export default config;
