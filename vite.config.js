import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
    // Required for SharedArrayBuffer (used by @ffmpeg/core-mt for ~2-3x faster
    // H.264 encode on desktop). The same headers MUST be sent by the production
    // host (nginx / Vercel / Cloudflare) or `crossOriginIsolated` will be false
    // and the export pipeline will automatically fall back to single-threaded
    // @ffmpeg/core (identical output, just slower).
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  worker: {
    format: 'es',
  },
})

