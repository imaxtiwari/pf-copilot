import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../db/schema'
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    const latestRun = await db.query.pipelineRuns.findFirst({
      orderBy: [desc(schema.pipelineRuns.startedAt)],
    });

    if (!latestRun) {
      console.log("No runs found");
      process.exit(0);
    }

    console.log(`Analyzing messages for Run ID: ${latestRun.runId}`);

    const messages = await db
      .select()
      .from(schema.deliberationMessages)
      .where(eq(schema.deliberationMessages.pipelineRunId, latestRun.runId))
      .orderBy(schema.deliberationMessages.createdAt);

    for (const msg of messages) {
      console.log(`\n--- [${msg.sender}] ${msg.messageType} ---`);
      console.log(JSON.stringify(msg.payload, null, 2));
    }
  } catch (err) {
    console.error('Failed to query DB:', err)
  } finally {
    await pool.end()
  }
}

main()
