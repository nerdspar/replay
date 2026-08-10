import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Ingress serves us under a rotating `/api/hassio_ingress/<token>/` path, so
  // every emitted URL must be relative (§3.3). The server injects a <base> tag
  // from X-Ingress-Path to anchor them.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8099',
      '/manifest.webmanifest': 'http://localhost:8099',
    },
  },
})
