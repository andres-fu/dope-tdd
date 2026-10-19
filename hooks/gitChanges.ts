import { commandSegments } from './shell.ts'

export type SourceSnapshot = Readonly<Record<string, string>>

// `git apply` is the agent's own edit arriving as a patch, so it is not here; `git stash list|show` only reads.
const REWRITES_TREE = /^\s*git\s+(?:checkout|restore|stash(?!\s+(?:list|show)\b)|reset|switch|revert|merge|rebase|pull|cherry-pick|clean)\b/

export type SavedState = 'uncommitted' | 'committed' | 'pushed'

/**
 * Where a module's work is, from `git status --porcelain=v2 --branch -- <source> <test>`: any entry line means its files
 * differ from HEAD; clean and not ahead of an upstream means pushed. Behind the upstream is still pushed: the work left.
 * Output without `# branch.oid`, which --branch always prints, is not a status: null, so nothing claims committed.
 */
export function savedStateOf(status: string): SavedState | null {
  const lines = status.split(/\r?\n/).filter(line => line !== '')
  if (!lines.some(line => line.startsWith('# branch.oid '))) {
    return null
  }
  if (lines.some(line => !line.startsWith('# '))) {
    return 'uncommitted'
  }
  const ahead = lines.map(line => /^# branch\.ab \+(\d+) /.exec(line)?.[1]).find(n => n !== undefined)
  return ahead === '0' ? 'pushed' : 'committed'
}

export function parseNumstat(output: string): Record<string, string> {
  const entries = output
    .split(/\r?\n/)
    .map(line => line.split('\t'))
    .filter((parts): parts is [string, string, string] => parts.length === 3 && parts[2] !== '')
    .map(([added, deleted, path]) => [path, `${added}/${deleted}`] as const)
  return Object.fromEntries(entries)
}

/**
 * The paths whose entry differs, appeared, or disappeared. `mtimesNow` gives the current modified time of paths that
 * left the snapshot (null when the file is gone): one that is still there with the time the snapshot recorded was
 * committed or staged (`git add`, `git commit`), not written, so it is not a change (#23).
 */
export function changedPaths(before: SourceSnapshot, after: SourceSnapshot, mtimesNow: Readonly<Record<string, number | null>> = {}): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter(path => before[path] !== after[path] && !onlyLeftTheDiff(before[path], after[path], mtimesNow[path]))
}

/** An entry is `<counts or untracked>:<modified time>`; the time is what follows the last colon. */
function onlyLeftTheDiff(was: string | undefined, now: string | undefined, mtimeNow: number | null | undefined): boolean {
  if (was === undefined || now !== undefined || mtimeNow === undefined || mtimeNow === null) {
    return false
  }
  return was.slice(was.lastIndexOf(':') + 1) === String(mtimeNow)
}

export function isRevertCommand(command: string): boolean {
  return commandSegments(command).some(segment => REWRITES_TREE.test(segment))
}
