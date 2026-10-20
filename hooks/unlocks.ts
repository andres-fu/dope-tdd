import { assertionCalls } from './workarounds.ts'

export const UNLOCK_TTL_MS = 7 * 24 * 60 * 60_000

/**
 * `testHash` is the test file's content when the unlock was stored (#54). A later session compares it: a test that
 * changed since (a checkout, a merge, an edit this guard did not see) is not the test that earned the unlock, so the
 * carry-over is dropped. Entries from earlier builds have none and are kept, still pending a run.
 */
export type StoredUnlock = { testPath: string; atMs: number; testHash?: string }

function isStoredUnlock(value: unknown): value is StoredUnlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredUnlock).testPath === 'string' &&
    typeof (value as StoredUnlock).atMs === 'number' &&
    ((value as StoredUnlock).testHash === undefined || typeof (value as StoredUnlock).testHash === 'string')
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

/**
 * The unlock keys in the store that hold no fresh unlock, to delete: a folder that no longer exists, or an old spelling
 * of a root, would otherwise stay forever (verified review B4, 2026-10-20: 36 keys on one machine, 17 for gone folders).
 */
export function staleUnlockKeys(store: Readonly<Record<string, unknown>>, nowMs: number): string[] {
  return Object.entries(store)
    .filter(([key, value]) => key.startsWith('unlocks:') && Object.keys(freshUnlocks(value, nowMs)).length === 0)
    .map(([key]) => key)
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

/**
 * A short fingerprint of a test file's text: FNV-1a, 32 bits, as 8 hex digits. Not cryptographic; it only has to
 * notice that a test changed between sessions. CRLF counts as LF, because a Windows checkout can rewrite line endings
 * with no change to the test, and that must not drop an unlock.
 */
export function contentHash(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The same text once CRLF is read as LF: a Windows checkout and a shell edit can disagree on line endings alone (#57). */
export function sameIgnoringLineEndings(a: string, b: string): boolean {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
}

/** What is stored for an unlock: the test, when, and the hash of the test as read now; none when it could not be read. */
export function unlockEntry(testPath: string, atMs: number, text: string | null): StoredUnlock {
  return text === null ? { testPath, atMs } : { testPath, atMs, testHash: contentHash(text) }
}

export function hasAssertion(source: string): boolean {
  return assertionCalls(source) > 0
}
