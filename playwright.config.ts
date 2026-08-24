import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import * as path from 'node:path'

// Make .env.local available to the test runner, global setup, and webServer.
config({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: 0,
  workers: 1,  // single worker — tests share a cookie/session state
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/report', open: 'never' }]],
  globalSetup: require.resolve('./tests/e2e/global-setup'),

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // Persist cookies across tests within the same worker so session cookie carries over
    storageState: './tests/e2e/storageState.json',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Expect the dev server to already be running.
  // Run: npm run dev   (in a separate terminal)
  // Then: npm run test:e2e
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 90_000,
    env: {
      // Allow the legacy dev-user cookie used by global-setup to authenticate.
      ALLOW_LEGACY_DEV_USER: 'true',
      // Use the local LLM mock for deterministic, fast E2E runs.
      MOCK_LLM: 'true',
    },
  },
})
