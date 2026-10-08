export const UNLOCK_TTL_MS = 7 * 24 * 60 * 60_000

export type StoredUnlock = { testPath: string; atMs: number }

const ASSERTION = /\bexpect\s*\(|\bassert\b|\.should\b|\bshould\s*\(/

function isStoredUnlock(value: unknown): value is StoredUnlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredUnlock).testPath === 'string' &&
    typeof (value as StoredUnlock).atMs === 'number'
  )
}

export function unlockKey(root: string): string {
  return `unlocks:${root}`
}

export function freshUnlocks(stored: unknown, nowMs: number): Record<string, StoredUnlock> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {}
  }
  const fresh = Object.entries(stored).filter(
    (entry): entry is [string, StoredUnlock] => isStoredUnlock(entry[1]) && nowMs - entry[1].atMs <= UNLOCK_TTL_MS,
  )
  return Object.fromEntries(fresh)
}

export function hasAssertion(source: string): boolean {
  return ASSERTION.test(source)
}
