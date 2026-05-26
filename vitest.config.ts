import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    // Only pick up unit tests — eval cases and e2e specs are excluded
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/inflation/**'],
      thresholds: { lines: 100, branches: 100 },
    },
  },
})
