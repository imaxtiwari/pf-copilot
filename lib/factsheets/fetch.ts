const DEFAULT_AMFI_URL = 'https://www.amfiindia.com/spages/NAVAll.txt'
const FETCH_TIMEOUT_MS = 45_000

export function getAmfiUrl(): string {
  return process.env.AMFI_NAV_URL ?? DEFAULT_AMFI_URL
}

export function buildFactsheetUrl(pattern: string, year: number, month: number): string {
  return pattern
    .replace('{YYYY}', String(year))
    .replace('{MM}', String(month).padStart(2, '0'))
}

export async function fetchBuffer(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Try current month, then previous two months — factsheets are published with a delay
export async function fetchLatestFactsheet(pattern: string): Promise<{ buffer: Buffer; year: number; month: number } | null> {
  const now = new Date()
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const url = buildFactsheetUrl(pattern, year, month)
    const buffer = await fetchBuffer(url)
    if (buffer && buffer.length > 1024) return { buffer, year, month }
  }
  return null
}
