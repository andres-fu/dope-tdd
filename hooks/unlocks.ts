import { assertionCalls } from './workarounds'

export const UNLOCK_TTL_MS = 7 * 24 * 60 * 60_000

export type StoredUnlock = { testPath: string; atMs: number }

function isStoredUnlock(value: unknown): value is StoredUnlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredUnlock).testPath === 'string' &&
    typeof (value as StoredUnlock).atMs === 'number'
  )
}

/**
 * One spelling of a root wherever it is a store key. Windows hands a session
 * `C:\\x` or `c:\\x` depending on how it was launched, and the store is shared
 * by every session on the machine, so a key with the raw root is a memory
 * only half the sessions can find.
 */
export function storeRoot(root: string): string {
  const slashed = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return slashed.replace(/^([A-Za-z]):/, (_whole, drive: string) => `${drive.toLowerCase()}:`)
}

export function unlockKey(root: string): string {
  return `unlocks:${storeRoot(root)}`
}

/** The key an earlier build wrote, with the root as it was handed over; read once more so a week of memory is not lost on upgrade. */
export function legacyUnlockKey(root: string): string {
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
  return assertionCalls(source) > 0
}
