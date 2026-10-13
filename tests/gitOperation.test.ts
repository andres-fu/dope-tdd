import { describe, expect, test } from 'claude-code/testing'

import { findGitOperation, gitDirFromFile } from '../hooks/gitOperation'

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
