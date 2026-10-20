/**
 * How long a session log under `~/.dope-tdd/sessions` stays: 30 days from its last write. Long enough to read last
 * month's receipts, short enough that they do not pile up.
 */
export const RETENTION_MS = 30 * 24 * 60 * 60_000

/**
 * The folders under `~/.dope-tdd` that are pruned. Never `kept`: a change kept aside is one dope-tdd could not put
 * back, and may be the only copy of someone's work. It is named at every session start instead (`keptNotice`), and
 * only its owner deletes it (decided 2026-10-18, PR #89).
 */
export const PRUNED_FOLDERS: readonly string[] = ['sessions']

const NAMED = 3

/** A short, stable hash of a repository's full path, so two repositories with the same folder name keep apart. */
function rootTag(root: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    hash = Math.imul(hash ^ normalized.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Where a change that could not be put back is kept: `~/.dope-tdd/kept/<repo>-<hash>/<path>`, or the temp folder when
 * there is no home folder, and null when there is neither. Never inside the repository, where `git add -A` would
 * take it, and never shared by two repositories that only share a folder name (verified review A11, 2026-10-20).
 */
export function keptPathFor(where: { home: string | undefined; temp: string | undefined; root: string; relative: string }): string | null {
  const clean = (dir: string) => dir.replace(/\\/g, '/').replace(/\/$/, '')
  const repo = clean(where.root).split('/').pop() || 'repo'
  const folder = `${repo}-${rootTag(where.root)}/${where.relative}`
  if (where.home !== undefined && where.home !== '') {
    return `${clean(where.home)}/.dope-tdd/kept/${folder}`
  }
  if (where.temp !== undefined && where.temp !== '') {
    return `${clean(where.temp)}/dope-tdd-kept/${folder}`
  }
  return null
}

/** What to tell the user about changes kept aside, named relative to `~/.dope-tdd/kept`; null when there are none. */
export function keptNotice(paths: readonly string[]): string | null {
  if (paths.length === 0) {
    return null
  }
  const one = paths.length === 1
  const named = paths.slice(0, NAMED).join(', ') + (paths.length > NAMED ? ` and ${paths.length - NAMED} more` : '')
  return (
    `dope-tdd: ${paths.length} change${one ? ' it could not put back is' : 's it could not put back are'} kept in ~/.dope-tdd/kept: ${named}. ` +
    `Look at ${one ? 'it' : 'them'}, then delete ${one ? 'it' : 'them'} yourself; dope-tdd never deletes these.`
  )
}

/** A file dated in the future (clock skew) is not expired: the safe answer for a delete is no. */
export function isExpired(mtimeMs: number, nowMs: number, maxAgeMs: number = RETENTION_MS): boolean {
  return nowMs - mtimeMs > maxAgeMs
}

/**
 * `$.fs` cannot delete, so a stale file is removed by node, the one runtime the plugin already needs for most stacks.
 * The path is an argument, never part of the script: a file name with a quote in it cannot change what runs.
 */
export function pruneArgv(path: string): string[] {
  return ['node', '-e', "require('node:fs').rmSync(process.argv[1], { force: true })", path]
}
