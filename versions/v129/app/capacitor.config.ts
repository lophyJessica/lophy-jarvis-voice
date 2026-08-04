import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.robin.app',
  appName: 'Robin',
  webDir: 'dist',
  server: {
    // 允许 WebView fetch/导航到 VPS（/tts、/asr、/p/jarvis/*）
    allowNavigation: ['pmlophy.com', '*.pmlophy.com'],
  },
};

export default config;
