import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Relative base lets the static build run from a sub-path such as /vram-circle/ (set by build-arc-testnet.mjs).
  base: process.env.VITE_BASE ?? '/',
  plugins: [vue()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
