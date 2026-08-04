import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      '/p/jarvis': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
      '/asr': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
      '/tts': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      '/p/jarvis': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
      '/asr': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
      '/tts': { target: 'https://pmlophy.com', changeOrigin: true, secure: true },
    },
  },
})
