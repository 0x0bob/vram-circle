import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['agent/**/*.test.ts', 'api/**/*.test.ts'], environment: 'node' },
})
