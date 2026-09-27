import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api to FastAPI so the SPA and the API share an
// origin — which is what lets the httpOnly session cookie be sent on XHR
// without any CORS credential juggling.
// DAYSHIFT_API_PORT / DAYSHIFT_WEB_PORT let the end-to-end tests run a
// second, throwaway copy of the app beside the real one.
const apiPort = process.env.DAYSHIFT_API_PORT ?? '8000'
const webPort = Number(process.env.DAYSHIFT_WEB_PORT ?? 5173)

// DAYSHIFT_SHARE=1 (set by `dayshift share`) makes this server reachable from
// other devices: your phone on the same Wi-Fi, or anywhere over Tailscale.
// Only this server is exposed — the API stays on 127.0.0.1 and is reached
// through the proxy below, exactly as the browser on the Mac reaches it.
// `.ts.net` admits Tailscale's device names; plain IP addresses need no entry.
const shared = process.env.DAYSHIFT_SHARE === '1'

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    host: shared ? '0.0.0.0' : undefined,
    allowedHosts: shared ? ['.ts.net'] : undefined,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
})
