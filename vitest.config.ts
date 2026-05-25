import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['lib/inflation/**'],
      thresholds: { lines: 100, branches: 100 },
    },
  },
})
