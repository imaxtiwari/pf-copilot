import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  retries: 0,
  workers: 1,  // single worker — tests share a cookie/session state
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // Persist cookies across tests within the same worker so session cookie carries over
    storageState: undefined,
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
    timeout: 30_000,
  },
})
