import * as fs from 'node:fs'
import * as path from 'node:path'
import { db } from '@/lib/db'
import { users } from '@/db/schema'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const STORAGE_STATE_PATH = path.join(__dirname, 'storageState.json')

/**
 * Playwright global setup.
 *
 * Creates a deterministic test user and persists a legacy dev-user cookie so
 * that E2E tests can run against the local dev server without a full Supabase
 * Auth flow. This is gated by ALLOW_LEGACY_DEV_USER=true on the webServer.
 */
export default async function globalSetup() {
  await db.insert(users).values({ id: TEST_USER_ID }).onConflictDoNothing()

  const storageState = {
    cookies: [
      {
        name: 'pf_user_id',
        value: TEST_USER_ID,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
    ],
    origins: [],
  }

  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2))
}
