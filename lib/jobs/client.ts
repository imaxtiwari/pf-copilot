import { Inngest } from 'inngest'

/**
 * Inngest client singleton.
 *
 * INNGEST_EVENT_KEY is required to send events.
 * INNGEST_SIGNING_KEY is required when serving functions in production.
 * Local development: run `npx inngest-cli@latest dev` and point the dev server
 * to the app at http://localhost:3000/api/inngest.
 */
export const inngest = new Inngest({
  id: 'pf-copilot',
  eventKey: process.env.INNGEST_EVENT_KEY,
})
