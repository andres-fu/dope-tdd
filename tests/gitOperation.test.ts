import { describe, expect, test } from 'claude-code/testing'

import { findGitOperation, gitDirFromFile, mainCheckoutFrom } from '../hooks/gitOperation'

const GIT_DIR = '/work/app/.git'

function existsAmong(...markers: string[]) {
  const present = new Set(markers.map(marker => `${GIT_DIR}/${marker}`))
  return async (path: string) => present.has(path)
}

describe('findGitOperation', () => {
  test('names the operation each marker stands for', async () => {
    expect(await findGitOperation(GIT_DIR, existsAmong('rebase-merge'))).toBe('rebase')
    expect(await findGitOperation(GIT_DIR, existsAmong('rebase-apply'))).toBe('rebase')
    expect(await findGitOperation(GIT_DIR, existsAmong('MERGE_HEAD'))).toBe('merge')
    expect(await findGitOperation(GIT_DIR, existsAmong('CHERRY_PICK_HEAD'))).toBe('cherry-pick')
    expect(await findGitOperation(GIT_DIR, existsAmong('REVERT_HEAD'))).toBe('revert')
    expect(await findGitOperation(GIT_DIR, existsAmong('BISECT_LOG'))).toBe('bisect')
  })

  test('tells git am from a rebase by the applying marker inside rebase-apply', async () => {
    expect(await findGitOperation(GIT_DIR, existsAmong('rebase-apply', 'rebase-apply/applying'))).toBe('am')
  })

  test('a rebase that stopped on a cherry-picked commit is still the rebase', async () => {
    expect(await findGitOperation(GIT_DIR, existsAmong('rebase-merge', 'CHERRY_PICK_HEAD'))).toBe('rebase')
  })

  test('is null when nothing is in progress', async () => {
    expect(await findGitOperation(GIT_DIR, existsAmong())).toBeNull()
  })

  test('a marker that cannot be checked counts as absent', async () => {
    const failing = async () => {
      throw new Error('EACCES')
    }
    expect(await findGitOperation(GIT_DIR, failing)).toBeNull()
  })
})

describe('gitDirFromFile', () => {
  test('a linked worktree points at its folder under the main repository', () => {
    expect(gitDirFromFile('gitdir: /work/app/.git/worktrees/feature\n', '/work/feature')).toBe('/work/app/.git/worktrees/feature')
  })

  test('a relative gitdir resolves against the folder that holds the .git file', () => {
    expect(gitDirFromFile('gitdir: ../../.git/modules/lib\n', '/work/app/vendor/lib')).toBe('/work/app/.git/modules/lib')
  })

  test('a Windows gitdir keeps its drive and uses forward slashes', () => {
    expect(gitDirFromFile('gitdir: C:\\work\\app\\.git\\worktrees\\feature\r\n', 'C:/work/feature')).toBe('C:/work/app/.git/worktrees/feature')
  })

  test('anything else is not a gitdir file', () => {
    expect(gitDirFromFile('', '/work/app')).toBeNull()
    expect(gitDirFromFile('ref: refs/heads/main\n', '/work/app')).toBeNull()
  })
})

// #233 (tester round 7): a session root that is itself a linked worktree has its agents' worktrees under the main
// checkout. Out of register.tsx (mainCheckoutOf), which runs `git rev-parse --path-format=absolute --git-dir
// --git-common-dir` and hands the answer here.
describe('mainCheckoutFrom', () => {
  test('a linked worktree: the main checkout is the folder that holds the common .git', () => {
    expect(mainCheckoutFrom('/work/main/.git/worktrees/feature\n/work/main/.git\n')).toBe('/work/main')
    expect(mainCheckoutFrom('C:/work/main/.git/worktrees/feature\r\nC:/work/main/.git\r\n')).toBe('C:/work/main')
  })

  test('a Windows common dir keeps its own slashes', () => {
    expect(mainCheckoutFrom('C:\\work\\main\\.git\\worktrees\\feature\nC:\\work\\main\\.git\n')).toBe('C:\\work\\main')
  })

  test('a main checkout has one git dir, however it is spelled, so there is no other checkout', () => {
    expect(mainCheckoutFrom('/work/app/.git\n/work/app/.git\n')).toBeUndefined()
    expect(mainCheckoutFrom('C:/Work/App/.git\nc:\\work\\app\\.git\n')).toBeUndefined()
  })

  test('a common dir that is not a .git folder beside a checkout (a bare repository) names none', () => {
    expect(mainCheckoutFrom('/srv/repo.git/worktrees/feature\n/srv/repo.git\n')).toBeUndefined()
  })

  test('git could not say: outside git, a failed call, or half an answer', () => {
    expect(mainCheckoutFrom(null)).toBeUndefined()
    expect(mainCheckoutFrom('')).toBeUndefined()
    expect(mainCheckoutFrom('/work/main/.git/worktrees/feature\n')).toBeUndefined()
  })
})
