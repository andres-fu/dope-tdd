/**
 * How long what dope-tdd leaves under `~/.dope-tdd/` (session logs, changes kept aside) stays: 30 days from the file's
 * last write. Long enough to read last month's receipts, short enough that source text kept aside does not pile up.
 */
export const RETENTION_MS = 30 * 24 * 60 * 60_000

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
