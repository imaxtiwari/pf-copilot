import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    // Unit tests run in happy-dom; integration tests run in node by default and
    // are excluded from the default test command via their own pattern.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: [
        'lib/**/*.d.ts',
        'lib/**/index.ts',
        // Exclude pure type/schema/prompt files that are exercised indirectly.
        'lib/contracts/*.ts',
        'lib/prompts/*.ts',
        'lib/types/*.ts',
        // Exclude files that require external services (Azure OpenAI, vision, vector DB,
        // web scraping) and are covered by integration/eval tests rather than unit tests.
        'lib/factsheets/*.ts',
        'lib/ingestion/*.ts',
        'lib/cas/parse-vision.ts',
        'lib/demat/parse-vision.ts',
        'lib/rag/compare-funds.ts',
        'lib/rag/explain-fund.ts',
        'lib/rag/explain-stock.ts',
        'lib/rag/retrieval*.ts',
        'lib/azure-openai.ts',
        'lib/azure-openai-mock-impl.ts',
        'lib/tools/explain-fund.ts',
        'lib/tools/explain-stock.ts',
        'lib/tools/compare-funds.ts',
        // Exclude scripts, scratch, and generated artifacts.
        'lib/**/*.generated.ts',
        '**/*.config.*',
        '**/node_modules/**',
        '**/.next/**',
      ],
      // Realistic initial thresholds. Raised iteratively as coverage improves.
      thresholds: { lines: 70, branches: 60, functions: 60, statements: 70 },
    },
  },
})
