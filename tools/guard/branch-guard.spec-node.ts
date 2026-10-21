// node --test tools/guard/branch-guard.spec-node.ts (not *.test.ts: the plugin test kit would load it)
// The branch guard: Claude never commits, merges or pushes on main in this repository (process review, 2026-10-21:
// #157's work was started on main). A PreToolUse hook; exit 2 blocks the command and shows the reason.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { blockedBy } from './branch-guard.ts'

test('on main, git commands that make or publish commits are blocked; reads and pulls are not', () => {
  for (const command of ['git commit -m x', 'git merge feature', 'git cherry-pick abc', 'git revert abc', 'git rebase origin/main', 'git am x.patch', 'git push', 'git push -u origin main']) {
    assert.match(blockedBy(command, 'main') ?? '', /on main/, command)
  }
  for (const command of ['git status', 'git pull', 'git pull --ff-only', 'git checkout -b fix', 'git log --oneline', 'git diff', 'git fetch', 'npm test']) {
    assert.equal(blockedBy(command, 'main'), null, command)
  }
})

test('the git command is found inside a chain, after cd, with global options and env assignments', () => {
  for (const command of ['cd repo && git commit -m x', 'git status; git commit -m x', 'git -C ../repo commit -m x', 'git -c user.name=x commit -m y', 'GIT_EDITOR=true git merge feature', 'git --no-pager commit -m x']) {
    assert.match(blockedBy(command, 'main') ?? '', /on main/, command)
  }
})

test('on another branch, committing and pushing it are fine; pushing to main is not', () => {
  for (const command of ['git commit -m x', 'git push', 'git push -u origin fix', 'git merge main']) {
    assert.equal(blockedBy(command, 'fix'), null, command)
  }
  for (const command of ['git push origin main', 'git push origin HEAD:main', 'git push origin fix:main', 'git push --force origin +main']) {
    assert.match(blockedBy(command, 'fix') ?? '', /to main/, command)
  }
})

test('a word that only mentions git or main is not a git command', () => {
  assert.equal(blockedBy('echo "git commit on main"', 'main'), null)
  assert.equal(blockedBy('gh pr create --base main', 'fix'), null)
})

// End to end: the script as the hook runs it, against a throwaway repository.
const repo = mkdtempSync(join(tmpdir(), 'branch-guard-')).replace(/\\/g, '/')
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
git('init', '-q', '-b', 'main')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')
git('config', 'commit.gpgsign', 'false')
writeFileSync(join(repo, 'a.txt'), 'a\n')
git('add', '-A')
git('commit', '-q', '-m', 'base')
after(() => rmSync(repo, { recursive: true, force: true }))

const script = new URL('./branch-guard.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const hook = (input: unknown) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8' })

test('the hook blocks a commit in a checkout on main with exit 2 and says why on stderr', () => {
  const run = hook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: repo })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /on main/)
})

test('the hook lets the same commit through on a branch', () => {
  git('checkout', '-q', '-b', 'fix')
  const run = hook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: repo })
  git('checkout', '-q', 'main')
  assert.equal(run.status, 0)
})

test('input it cannot read, or a folder that is not a git checkout, lets the command through', () => {
  assert.equal(spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' }).status, 0)
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: tmpdir() }).status, 0)
})
