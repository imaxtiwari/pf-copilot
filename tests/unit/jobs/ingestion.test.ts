import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runIngestionJob } from '@/lib/jobs/handlers/ingestion'
import { IngestionJobType } from '@/lib/jobs/definitions'

process.env.DATABASE_URL = 'postgres://localhost:5432/test'

const insertMock = vi.fn()
const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
const findFirstMock = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      ingestionRuns: {
        findFirst: (...args: unknown[]) => findFirstMock(...args),
      },
    },
    insert: () => ({ values: () => ({ returning: insertMock }) }),
    update: () => ({ set: setMock }),
  },
}))

vi.mock('@/lib/ingestion/amfi', () => ({
  syncAmfiMaster: vi.fn(),
}))

vi.mock('@/lib/ingestion/factsheets', () => ({
  ingestFactsheets: vi.fn(),
}))

vi.mock('@/lib/ingestion/annual-reports', () => ({
  ingestAnnualReports: vi.fn(),
}))

beforeEach(() => {
  insertMock.mockReset()
  setMock.mockReset()
  setMock.mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
  findFirstMock.mockReset()
})

describe('runIngestionJob', () => {
  it('records a new run and returns the runner result', async () => {
    findFirstMock.mockResolvedValue(null)
    insertMock.mockResolvedValue([{ id: 'run-1' }])
    const runner = vi.fn().mockResolvedValue({ processed: 42 })

    const result = await runIngestionJob(IngestionJobType.AMFI, {}, runner)

    expect(result).toEqual({ processed: 42 })
    expect(findFirstMock).toHaveBeenCalled()
    expect(insertMock).toHaveBeenCalled()
    expect(runner).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('is idempotent and skips a completed job unless forced', async () => {
    findFirstMock.mockResolvedValue({
      id: 'run-2',
      status: 'completed',
      result: { processed: 10 },
      attemptCount: 1,
    })
    const runner = vi.fn().mockResolvedValue({ processed: 99 })

    const result = await runIngestionJob(IngestionJobType.FACTSHEETS, {}, runner)

    expect(result).toEqual({ processed: 10 })
    expect(runner).not.toHaveBeenCalled()
  })

  it('re-runs a completed job when force=true', async () => {
    findFirstMock.mockResolvedValue({
      id: 'run-3',
      status: 'completed',
      result: { processed: 10 },
      attemptCount: 1,
    })
    setMock.mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    const runner = vi.fn().mockResolvedValue({ processed: 99 })

    const result = await runIngestionJob(IngestionJobType.AMFI, { force: true }, runner)

    expect(result).toEqual({ processed: 99 })
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('records FAILED status and re-throws on runner error', async () => {
    findFirstMock.mockResolvedValue(null)
    insertMock.mockResolvedValue([{ id: 'run-4' }])
    setMock.mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    const error = new Error('fetch failed')
    const runner = vi.fn().mockRejectedValue(error)

    await expect(runIngestionJob(IngestionJobType.ANNUAL_REPORTS, {}, runner)).rejects.toThrow(error)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('increments attemptCount when re-running a previously failed run', async () => {
    findFirstMock.mockResolvedValue({
      id: 'run-5',
      status: 'failed',
      result: null,
      attemptCount: 2,
    })
    setMock.mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    const runner = vi.fn().mockResolvedValue({ ok: true })

    await runIngestionJob(IngestionJobType.FACTSHEETS, {}, runner)

    expect(insertMock).not.toHaveBeenCalled()
    expect(runner).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: expect.any(Object) }))
  })
})
