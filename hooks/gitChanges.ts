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

/**
 * What the record keeps of a git command: `git <subcommand>`, and the action for `git stash`. Never its arguments,
 * where a token in a remote URL can sit (verified review B1, 2026-10-20: 80 characters of the command were kept).
 */
export function gitVerb(command: string): string {
  for (const segment of commandSegments(command)) {
    const words = segment.trim().split(/\s+/)
    if (words[0] !== 'git') {
      continue
    }
    // Skip git's own options before the subcommand (`-c key=value`, `-C dir`, `--no-pager`).
    let i = 1
    while (i < words.length && (words[i] ?? '').startsWith('-')) {
      i += words[i] === '-c' || words[i] === '-C' ? 2 : 1
    }
    const verb = words[i]
    if (verb === undefined) {
      return 'git'
    }
    const action = verb === 'stash' && words[i + 1] !== undefined && /^[a-z]+$/.test(words[i + 1] ?? '') ? ` ${words[i + 1]}` : ''
    return `git ${verb}${action}`
  }
  return 'git'
}

const CD_ONLY = /^\s*cd(?:\s|$)/

/**
 * Every segment runs git (cds aside): only such a command may change a file git manages, such as the override record a
 * pull brings in. A git segment beside anything else proves nothing about what the rest wrote (verified review A6).
 */
export function isGitOnly(command: string): boolean {
  const segments = commandSegments(command).filter(segment => segment.trim() !== '' && !CD_ONLY.test(segment))
  return segments.length > 0 && segments.every(segment => /^\s*git\s/.test(segment))
}

/**
 * A command that rewrites the tree with git and does nothing else that could write: every segment is a git rewrite,
 * a cd, or one `quiet` says cannot write (a test run). Only then are the changes it leaves not the agent's; a git
 * segment beside a script once hid the script's writes (verified review A7, 2026-10-20).
 */
export function isRevertOnly(command: string, quiet: (segment: string) => boolean): boolean {
  const segments = commandSegments(command).filter(segment => segment.trim() !== '' && !CD_ONLY.test(segment))
  return segments.some(segment => REWRITES_TREE.test(segment)) && segments.every(segment => REWRITES_TREE.test(segment) || quiet(segment))
}

export function isRevertCommand(command: string): boolean {
  return commandSegments(command).some(segment => REWRITES_TREE.test(segment))
}

// Rewrites that only put files back as they are at HEAD: what they write was already there, so nothing comes in.
// `git checkout api.py` with one argument that names a file is a restore; one that names a branch is a switch.
const BACK_TO_HEAD = [
  /^\s*git\s+restore\b(?![^\n]*\s(?:--source\b|-s\b|-s\S))/,
  /^\s*git\s+checkout\s+(?:HEAD\s+)?--\s/,
  /^\s*git\s+checkout\s+[^\s-][^\s]*\.\w+\s*$/,
  /^\s*git\s+reset\s+--hard(?:\s+HEAD)?\s*$/,
  /^\s*git\s+stash(?:\s+push\b[^\n]*)?\s*$/,
  /^\s*git\s+clean\b/,
]

/**
 * A git command that writes code from somewhere other than this checkout's HEAD: another branch, a commit, a stash or
 * a remote. The guard does not charge it to the agent (isRevertCommand), but says it, so it never goes by unseen
 * (Karl's trial, 2026-10-19: a git restore logged nothing, which is right only for code put back to HEAD).
 */
export function bringsInCode(command: string): boolean {
  return commandSegments(command).some(segment => REWRITES_TREE.test(segment) && !BACK_TO_HEAD.some(shape => shape.test(segment)))
}
