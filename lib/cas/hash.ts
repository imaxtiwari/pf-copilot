import { createHash } from 'crypto'

export function hashFileContent(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
