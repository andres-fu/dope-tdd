import { storeRoot } from './unlocks.ts'

export const JOURNAL_PREFIX = 'catch-journal:'

export type JournalFile = { path: string; before: string; after: string }

export function isJournalFile(value: unknown): value is JournalFile {
  const file = value as Partial<JournalFile> | null
  return typeof file === 'object' && file !== null && typeof file.path === 'string' && typeof file.before === 'string' && typeof file.after === 'string'
}

/**
 * What a file the catch check reverted needs once the check's run is over, from what is on disk now (null: unreadable
 * or gone). Still the old code: the change goes back. Anything but the change: it moved while reverted (an editor's
 * save, another hand), so it is left as it is and the change is kept aside.
 */
export function afterRevert(onDisk: string | null, before: string, after: string): 'restore' | 'as-is' | 'moved' {
  if (onDisk === before) {
    return 'restore'
  }
  return onDisk === after ? 'as-is' : 'moved'
}

/**
 * A journal left behind means a check died between revert and restore. A file already holding the change needs
 * nothing; one still at the old code gets the change back; one that moved since is left alone and the change is kept
 * aside, because the hand that moved it knew more than the journal does.
 */
export function repairStep(onDisk: string | null, file: { before: string; after: string }): 'as-is' | 'restore' | 'keep-aside' {
  if (onDisk === file.after) {
    return 'as-is'
  }
  return onDisk === file.before ? 'restore' : 'keep-aside'
}

/** The journal as stored: the files, and when it was written, so its age is on record. */
export function journalEntry(files: JournalFile[], atMs: number): { files: JournalFile[]; atMs: number } {
  return { files, atMs }
}

/** A journal younger than this may belong to a check still running in another session, so it is not reported. */
export const RUNNING_GRACE_MS = 15 * 60_000

const NAMED = 3

/**
 * Another project's interrupted catch check, as it is told to the user. A session never repairs another project (#89:
 * an agent changes only what it owns); it reports, so the owner repairs it by opening a session there. A journal with
 * no time is from an earlier build, so its check is long over. Null when there is nothing to report.
 */
export function elsewhereNotice(found: readonly { paths: readonly string[]; atMs?: number }[], nowMs: number): string | null {
  const paths = found.filter(journal => journal.atMs === undefined || nowMs - journal.atMs > RUNNING_GRACE_MS).flatMap(journal => journal.paths)
  if (paths.length === 0) {
    return null
  }
  const named = paths.slice(0, NAMED).join(', ') + (paths.length > NAMED ? ` and ${paths.length - NAMED} more` : '')
  return (
    `dope-tdd: a catch check in another project was interrupted and may have left ${named} reverted. ` +
    `Open a session in that project and dope-tdd puts ${paths.length === 1 ? 'it' : 'them'} back; nothing there was changed from here.`
  )
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
