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

test('merging a pull request is for a person, on any branch and in the usual spellings', () => {
  const merges = [
    'gh pr merge 261',
    'gh pr merge 261 --squash',
    'gh pr merge --auto --merge',
    'git status && gh pr merge',
    'GH_TOKEN=x gh pr merge 1',
    'gh -R o/r pr merge 1',
    'gh pr -R o/r merge 1',
    '/opt/homebrew/bin/gh pr merge 1',
    'gh.exe pr merge 1',
    'command gh pr merge 1',
    'if gh pr checks 261; then gh pr merge 261; fi',
    'for n in 261 262; do gh pr merge $n; done',
    'gh api -X PUT repos/o/r/pulls/261/merge',
    'gh api --method PUT repos/o/r/pulls/$PR/merge',
    'gh api -X PUT "repos/o/r/pulls/261/merge"',
    `gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'`,
    `gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'`,
    `# it's green\ngh pr merge 261`,
    'gh pr merge 1 --body "see --help for this"',
    'gh pr merge 1 --subject "read -h first"',
  ]
  for (const command of merges) {
    assert.match(blockedBy(command, 'fix') ?? '', /for a person/, command)
  }
})

test('reading, opening or mentioning a merge is not merging', () => {
  const others = [
    'gh pr view 261',
    'gh pr view 261 --json mergeable',
    'gh pr create --base release',
    'gh pr checks 261',
    'gh pr merge --help',
    'gh pr merge -h',
    'gh pr merge 1 --disable-auto',
    `gh api repos/o/r/issues/1/comments -f body='Use the mergePullRequest mutation'`,
    'gh api -X PUT repos/o/r/contents/docs/pulls/1/merge.md',
    'gh api repos/o/r/pulls/261',
    'gh api repos/o/r/pulls/261/merge',
    'gh api -X GET repos/o/r/pulls/261/merge',
    'echo gh pr merge 261',
    'hub pr merge 261',
    'git commit -m "docs: note it; gh pr merge is now for a person"',
    'git commit -m "first line\n\ngh pr merge is for a person"',
    'gh pr comment 261 --body "green; gh pr merge 261 is yours"',
    'grep -E "foo|gh pr merge|bar" CONTRIBUTING.md',
    `gh pr create --body "$(cat <<'EOF'\ngh pr merge is refused\nEOF\n)"`,
  ]
  for (const command of others) {
    assert.equal(blockedBy(command, 'fix'), null, command)
  }
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

test('the git rules read the whole command, so a comment or a heredoc for a shell hides nothing', () => {
  for (const command of [`# don't stop\ngit commit -m x`, 'bash <<EOF\ngit commit -m x\nEOF', `$m = @'\nhi\n'@\ngit commit -m $m`, 'cd "C:\\repo\\"; git commit -m x']) {
    assert.match(blockedBy(command, 'main') ?? '', /on main/, command)
  }
})

test('outside a checkout only the merge rule applies', () => {
  assert.equal(blockedBy('git push origin main', null), null)
})

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

test('the hook blocks a pull request merge with exit 2 and says why on stderr', () => {
  const run = hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 261' }, cwd: repo })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /for a person/)
})

test('the merge rule needs no checkout, since gh can merge from any folder with -R', () => {
  const run = hook({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 1 -R o/r' }, cwd: tmpdir() })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /for a person/)
})

test('input it cannot read, or a folder that is not a git checkout, lets the command through', () => {
  assert.equal(spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' }).status, 0)
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: tmpdir() }).status, 0)
})
