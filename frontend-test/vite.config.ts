import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3001,
    proxy: {
      '/api/ops': 'http://localhost:8001',
      '/api/health': 'http://localhost:8001',
    },
  },
})
