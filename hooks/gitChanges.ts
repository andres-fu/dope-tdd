import { commandSegments, splitCommands } from './shell.ts'
import type { Shell } from './shell.ts'

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

/** Git quotes a path with a non-ASCII byte, and the quoted text is no file: a write to one went unseen (#299). */
export const PLAIN_PATHS = ['-c', 'core.quotePath=false']

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
 * left the snapshot (null when the file is gone): one that is still there with the time the snapshot recorded left it
 * through git (a commit in a repository with none before it, a pull), not a write, so it is not a change (#23).
 */
export function changedPaths(before: SourceSnapshot, after: SourceSnapshot, mtimesNow: Readonly<Record<string, number | null>> = {}): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter(path => before[path] !== after[path] && !onlyLeftTheDiff(before[path], after[path], mtimesNow[path]) && !onlyStaged(before[path], after[path]))
}

/** An entry is `<counts or untracked>:<modified time>`; the time is what follows the last colon. */
function timeOf(entry: string): string {
  return entry.slice(entry.lastIndexOf(':') + 1)
}

function onlyLeftTheDiff(was: string | undefined, now: string | undefined, mtimeNow: number | null | undefined): boolean {
  if (was === undefined || now !== undefined || mtimeNow === undefined || mtimeNow === null) {
    return false
  }
  return timeOf(was) === String(mtimeNow)
}

/** Against a commit, staging a new file turns `untracked` into counts and unstaging turns it back: nothing was written (#292). */
function onlyStaged(was: string | undefined, now: string | undefined): boolean {
  if (was === undefined || now === undefined || was.startsWith('untracked') === now.startsWith('untracked')) {
    return false
  }
  // A time that couldn't be read says nothing, so two of them don't match.
  return timeOf(was) === timeOf(now) && timeOf(now) !== 'missing'
}

/**
 * What a command changed. `after` is against the base `baseAfter` gave; `afterOldBase`, the same tree against the old
 * base, is there only when that base moved. Git moved the base, and a reset moves it without touching a file, so only
 * what differs against both was written (#292).
 */
export function changedAround(before: SourceSnapshot, after: SourceSnapshot, afterOldBase: SourceSnapshot | null, mtimesNow: Readonly<Record<string, number | null>> = {}): string[] {
  const changed = changedPaths(before, after, mtimesNow)
  if (afterOldBase === null) {
    return changed
  }
  const againstOld = new Set(changedPaths(before, afterOldBase))
  return changed.filter(path => againstOld.has(path))
}

/**
 * What to compare the tree with after a command, given HEAD before and after it. With no commit before it there is no
 * base, and the snapshots stay on the index. `unread` says the guard can't tell what moved HEAD, so a write committed in
 * that command may not show: a reflog that can't say, or a HEAD that can't be read any more (`git checkout --orphan`).
 */
export function baseFor(oldHead: string | null, newHead: string | null, reflog: string): { base: string | null; unread: boolean } {
  if (oldHead === null) {
    return { base: null, unread: false }
  }
  if (newHead === null) {
    return { base: null, unread: true }
  }
  const read = baseAfter(oldHead, newHead, reflog)
  return { base: read ?? newHead, unread: read === null }
}

const REFLOG_ENTRY = /^([0-9a-f]{40}|[0-9a-f]{64}) (.*)$/
const PLAIN_COMMIT = /^commit(?: \(amend\))?: /

/**
 * The commit to compare the tree with after a command, from `git log -g --format='%H %gs'`, newest first. A plain commit
 * is the command's own work, so it keeps the base; anything else git did to HEAD brought in code that isn't, so the base
 * moves to the newest such entry (#292). Null when HEAD moved and the reflog doesn't reach the old HEAD (turned off, or
 * expired): nothing here can tell a commit from a pull.
 */
export function baseAfter(oldHead: string, newHead: string, reflog: string): string | null {
  if (newHead === oldHead) {
    return oldHead
  }
  for (const line of reflog.split(/\r?\n/)) {
    const [, commit, subject] = REFLOG_ENTRY.exec(line) ?? []
    if (commit === undefined || subject === undefined) {
      continue
    }
    if (!PLAIN_COMMIT.test(subject)) {
      return commit
    }
    if (commit === oldHead) {
      return oldHead
    }
  }
  return null
}

/**
 * What the record keeps of a git command: `git <subcommand>`, and the action for `git stash`. Never its arguments,
 * where a token in a remote URL can sit (verified review B1, 2026-10-20: 80 characters of the command were kept).
 */
export function gitVerb(command: string, shell: Shell = 'bash'): string {
  const segments = splitCommands(command, shell)
  // The rewrite that brought the code first, whatever git step came before it (#292).
  for (const segment of [...segments.filter(segmentBringsCode), ...segments]) {
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
 * pull brings in. A git segment beside anything else proves nothing about what the rest wrote (verified review A6). The
 * commands are the shell's own (#348): the hook passes the tool's shell, and tests default to Bash.
 */
export function isGitOnly(command: string, shell: Shell = 'bash'): boolean {
  const segments = splitCommands(command, shell).filter(segment => segment.trim() !== '' && !CD_ONLY.test(segment))
  return segments.length > 0 && segments.every(segment => /^\s*git\s/.test(segment))
}

const LEAVES_THE_TREE = /^\s*git\s+(?:add|commit|push|fetch|tag)(?=\s|$)/

/**
 * A command that rewrites the tree with git and does nothing else that could write: every segment is a git rewrite,
 * a cd, one that leaves the tree alone (what a rewrite brought is staged, committed or pushed, #292), or one `quiet` says
 * cannot write (a test run). Only then are the changes it leaves not the agent's; a git segment beside a script once hid
 * the script's writes (verified review A7, 2026-10-20).
 */
export function isRevertOnly(command: string, quiet: (segment: string) => boolean, shell: Shell = 'bash'): boolean {
  const segments = splitCommands(command, shell).filter(segment => segment.trim() !== '' && !CD_ONLY.test(segment))
  return segments.some(segment => REWRITES_TREE.test(segment)) && segments.every(segment => REWRITES_TREE.test(segment) || LEAVES_THE_TREE.test(segment) || quiet(segment))
}

export function isRevertCommand(command: string): boolean {
  return commandSegments(command).some(segment => REWRITES_TREE.test(segment))
}

// Rewrites that only put files back as they are at HEAD: what they write was already there, so nothing comes in.
// `git checkout api.py` with one argument that names a file is a restore; one that names a branch is a switch.
const BACK_TO_HEAD = [
  /^\s*git\s+restore\b(?![^\n]*\s(?:--source\b|-s\b|-s\S))/,
  /^\s*git\s+checkout\s+(?:HEAD\s+)?--\s/,
  // A letter extension (`main.py`), never a digit one: `v2.0` and `release.1` are tags and branches (verified review D3).
  /^\s*git\s+checkout\s+[^\s-][^\s]*\.[A-Za-z]\w*\s*$/,
  /^\s*git\s+reset\s+--hard(?:\s+HEAD)?\s*$/,
  /^\s*git\s+stash(?:\s+push\b[^\n]*)?\s*$/,
  /^\s*git\s+clean\b/,
]

/**
 * A git command that writes code from somewhere other than this checkout's HEAD: another branch, a commit, a stash or
 * a remote. The guard does not charge it to the agent (isRevertCommand), but says it, so it never goes by unseen
 * (Karl's trial, 2026-10-19: a git restore logged nothing, which is right only for code put back to HEAD).
 */
export function bringsInCode(command: string, shell: Shell = 'bash'): boolean {
  return splitCommands(command, shell).some(segmentBringsCode)
}

function segmentBringsCode(segment: string): boolean {
  return REWRITES_TREE.test(segment) && !BACK_TO_HEAD.some(shape => shape.test(segment))
}
