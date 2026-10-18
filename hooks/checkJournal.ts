import { storeRoot } from './unlocks.ts'

export const JOURNAL_PREFIX = 'catch-journal:'

export type JournalFile = { path: string; before: string; after: string }

export function isJournalFile(value: unknown): value is JournalFile {
  const file = value as Partial<JournalFile> | null
  return typeof file === 'object' && file !== null && typeof file.path === 'string' && typeof file.before === 'string' && typeof file.after === 'string'
}

export const JOURNAL_TTL_MS = 7 * 24 * 60 * 60_000

/** The journal as stored: the files, and when it was written, so a journal nobody came back for can be told from a live one. */
export function journalEntry(files: JournalFile[], atMs: number): { files: JournalFile[]; atMs: number } {
  return { files, atMs }
}

/** Older than a week. An entry from an earlier build has no time and is never judged stale: it may still hold the only copy. */
export function staleJournal(value: unknown, nowMs: number): boolean {
  const atMs = (value as { atMs?: unknown } | null | undefined)?.atMs
  return typeof atMs === 'number' && nowMs - atMs > JOURNAL_TTL_MS
}

export function journalFiles(value: unknown): JournalFile[] | null {
  const journal = value as { files?: unknown } | null
  return typeof journal === 'object' && journal !== null && Array.isArray(journal.files) ? journal.files.filter(isJournalFile) : null
}

export function journalKeyFor(root: string, module: string): string {
  return `${JOURNAL_PREFIX}${storeRoot(root)}:${module}`
}

/**
 * One catch-check lock per checkout, across every session on the machine.
 * The store is shared but its get-then-set is not atomic (the mods docs say
 * so), so the lock itself is a git ref updated by compare-and-swap: creating
 * it succeeds for exactly one session, an expired one is taken over only by
 * naming its exact old value, and a session can release only its own.
 * refs/worktree/ refs are per checkout, which is the right scope: two
 * worktrees of one repository revert different files. The store keeps a copy
 * so every guard can see the lock without starting git on each tool call.
 */
export const SHARED_LOCK_REF = 'refs/worktree/dope-tdd-check'

export type SharedLock = { kind: 'acquired'; sha: string } | { kind: 'busy'; module: string } | { kind: 'unavailable' }

export function sharedLockKey(root: string): string {
  return `check-lock:${storeRoot(root)}`
}

export function parseLock(text: string | undefined): { module: string; sinceMs: number } | null {
  try {
    const value = JSON.parse(text ?? '') as { module?: unknown; sinceMs?: unknown }
    return typeof value.module === 'string' && typeof value.sinceMs === 'number' ? { module: value.module, sinceMs: value.sinceMs } : null
  } catch {
    return null
  }
}
