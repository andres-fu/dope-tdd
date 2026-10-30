import { parentDir } from './findRunner.ts'
import { pathKey } from './mirror.ts'

/**
 * A git operation that stops part-way and hands the tree back: to resolve a conflict, to amend a commit, or to test
 * an old one. The code it leaves on disk was written before this session, not by the agent now, so the guard steps
 * aside until it ends.
 */
export type GitOperation = 'rebase' | 'am' | 'merge' | 'cherry-pick' | 'revert' | 'bisect'

/**
 * The marker each operation leaves in the git directory while it is in progress, in the order they are checked: a
 * rebase can leave CHERRY_PICK_HEAD behind on a stop, and `git am` shares rebase-apply with the old rebase backend.
 */
const MARKERS: readonly (readonly [string, GitOperation])[] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply/applying', 'am'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
]

/** The operation in progress in a git directory, or null. A marker that cannot be checked counts as absent. */
export async function findGitOperation(gitDir: string, exists: (path: string) => Promise<boolean>): Promise<GitOperation | null> {
  for (const [marker, operation] of MARKERS) {
    let present = false
    try {
      present = await exists(`${gitDir}/${marker}`)
    } catch {
      present = false
    }
    if (present) {
      return operation
    }
  }
  return null
}

const ABSOLUTE = /^(?:[A-Za-z]:)?\//

/** `a/b/../c` as `a/c`, keeping a leading `/` or drive. */
function normalized(path: string): string {
  const root = ABSOLUTE.exec(path)?.[0] ?? ''
  const parts: string[] = []
  for (const part of path.slice(root.length).split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '' && part !== '.') {
      parts.push(part)
    }
  }
  return `${root}${parts.join('/')}`
}

/**
 * The git directory a `.git` file points at, as a linked worktree or a submodule has one, resolved against the
 * folder that holds the file. Null when the text is not a `gitdir:` line.
 */
export function gitDirFromFile(text: string, folder: string): string | null {
  const target = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/\\/g, '/')
  if (target === undefined || target === '') {
    return null
  }
  return normalized(ABSOLUTE.test(target) ? target : `${folder.replace(/\\/g, '/')}/${target}`)
}

/**
 * The main checkout when the session root is itself a linked git worktree (#233, tester round 7), from what
 * `git rev-parse --path-format=absolute --git-dir --git-common-dir` printed there (null when git could not run).
 * Claude Code puts the subagents' worktrees under the main checkout's .claude/worktrees then, outside the session root
 * (mirror.ts, worktreeRootFor). Undefined in a main checkout, outside git, or when git cannot say.
 */
export function mainCheckoutFrom(said: string | null): string | undefined {
  const [gitDir, commonDir] = (said ?? '').split(/\r?\n/).map(line => line.trim())
  // A linked worktree's git dir is <main>/.git/worktrees/<name>; the common one is <main>/.git, beside the checkout.
  return gitDir === undefined || commonDir === undefined || commonDir === '' || pathKey(gitDir) === pathKey(commonDir) || !/[\\/]\.git$/.test(commonDir)
    ? undefined
    : (parentDir(commonDir) ?? undefined)
}
