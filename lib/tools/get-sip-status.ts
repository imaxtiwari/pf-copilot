import { eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'

export async function getSipStatus(userId: string) {
  const [reportRecord] = await db
    .select()
    .from(schema.sipAdherenceReports)
    .where(eq(schema.sipAdherenceReports.userId, userId))
    .orderBy(desc(schema.sipAdherenceReports.generatedAt))
    .limit(1)

  if (!reportRecord) {
    return {
      status: 'no_sip_tracker_report_yet',
      message: 'No SIP adherence report has been generated yet. Please upload your CAS PDF to track your monthly SIP investments.'
    }
  }

  return reportRecord.report
}
