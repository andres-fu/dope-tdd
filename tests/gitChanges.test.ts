import { describe, expect, test } from 'claude-code/testing'

import { bringsInCode, changedPaths, gitVerb, isGitOnly, isRevertCommand, isRevertOnly, parseNumstat, savedStateOf } from '../hooks/gitChanges'

// `git status --porcelain=v2 --branch -- <source> <test>`: whether the module's work is committed, and pushed (2026-10-19).
describe('savedStateOf', () => {
  const head = '# branch.oid 0fcba10\n# branch.head karl-feedback\n'
  test('a changed or untracked file of the module is uncommitted', () => {
    expect(savedStateOf(`${head}1 .M N... 100644 100644 100644 a b hooks/build.ts\n`)).toBe('uncommitted')
    expect(savedStateOf(`${head}? tests/build.test.ts\n`)).toBe('uncommitted')
  })

  test('clean with no upstream, or ahead of it, is committed', () => {
    expect(savedStateOf(head)).toBe('committed')
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +2 -0\n`)).toBe('committed')
  })

  test('clean and level with its upstream is pushed', () => {
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +0 -0\n`)).toBe('pushed')
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +0 -3\n`)).toBe('pushed')
  })

  test('output without the branch header is not git status: unknown, never a guess of committed', () => {
    expect(savedStateOf('')).toBeNull()
    expect(savedStateOf('fatal: not a git repository\n')).toBeNull()
  })
})

describe('parseNumstat', () => {
  test('keys each changed path by its add/delete counts', () => {
    expect(parseNumstat('3\t1\tsrc/App.tsx\n10\t0\tsrc/utils/a.ts\n')).toEqual({
      'src/App.tsx': '3/1',
      'src/utils/a.ts': '10/0',
    })
  })

  test('is empty for empty output and tolerates CRLF', () => {
    expect(parseNumstat('')).toEqual({})
    expect(parseNumstat('1\t1\tsrc/App.tsx\r\n')).toEqual({ 'src/App.tsx': '1/1' })
  })
})

describe('changedPaths', () => {
  test('lists paths whose signature differs, appeared, or disappeared', () => {
    const before = { 'src/a.ts': '1/0', 'src/b.ts': '2/2', 'src/gone.ts': '5/0' }
    const after = { 'src/a.ts': '1/0', 'src/b.ts': '3/2', 'src/new.ts': 'untracked:9' }
    expect(changedPaths(before, after).sort()).toEqual(['src/b.ts', 'src/gone.ts', 'src/new.ts'])
  })

  test('a path that left the diff with its modified time unchanged was committed or staged, not written (#23)', () => {
    const before = { 'tests/a.test.ts': 'untracked:1000', 'src/a.ts': '3/1:1000', 'src/b.ts': '1/0:1000', 'src/gone.ts': '5/0:1000' }
    // Committed, committed, rewritten and committed in one command, deleted.
    const now = { 'tests/a.test.ts': 1000, 'src/a.ts': 1000, 'src/b.ts': 2000, 'src/gone.ts': null }
    expect(changedPaths(before, {}, now).sort()).toEqual(['src/b.ts', 'src/gone.ts'])
    // Without the current times every vanished path still counts, as before.
    expect(changedPaths(before, {}).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/gone.ts', 'tests/a.test.ts'])
  })

  test('is empty when nothing changed', () => {
    expect(changedPaths({ 'src/a.ts': '1/0' }, { 'src/a.ts': '1/0' })).toEqual([])
  })
})

describe('isRevertCommand', () => {
  test('git commands that rewrite the working tree are reverts, not edits', () => {
    for (const command of [
      'git checkout -- src/App.tsx',
      'git restore src/utils/a.ts',
      'git stash',
      'git stash pop',
      'git reset --hard HEAD~1',
      'cd packages/app && git switch main',
    ]) {
      expect(isRevertCommand(command)).toBe(true)
    }
  })

  test('other git commands and ordinary shell commands are not', () => {
    for (const command of ['git status', 'git diff src/App.tsx', 'git commit -m x', "sed -i 's/a/b/' src/App.tsx", 'npx vitest run']) {
      expect(isRevertCommand(command)).toBe(false)
    }
  })

  test('a patch the agent applies is its own edit, and listing the stash only reads', () => {
    expect(isRevertCommand("git apply <<'EOF'\n--- a/src/App.tsx\n+++ b/src/App.tsx\nEOF")).toBe(false)
    expect(isRevertCommand('git apply fix.patch')).toBe(false)
    expect(isRevertCommand('git stash list')).toBe(false)
    expect(isRevertCommand('git stash show -p')).toBe(false)
  })
})

// Karl's trial (2026-10-19): git restore logged nothing, which is right for code put back to HEAD. But git can also
// write code from another branch, a stash or a commit, and that went by just as silently: it is now said.
describe('bringsInCode', () => {
  test('putting a file back as it is at HEAD brings nothing in', () => {
    for (const command of ['git restore src/a.ts', 'git restore --staged --worktree api.py', 'git checkout -- api.py', 'git checkout HEAD -- api.py', 'git checkout api.py', 'git reset --hard', 'git reset --hard HEAD', 'git stash', 'git stash push -m wip', 'git clean -fd']) {
      expect(bringsInCode(command)).toBe(false)
    }
  })

  // Verified review D3 (2026-10-20): a branch or tag with a dot read as a file restore, so the switch went unsaid.
  test('a dotted branch or tag is a switch, not a file: only a letter extension makes a file', () => {
    expect(bringsInCode('git checkout v2.0')).toBe(true)
    expect(bringsInCode('git checkout release.1')).toBe(true)
    expect(bringsInCode('git checkout main.py')).toBe(false)
  })

  test('code from another branch, a commit, a stash or a remote is brought in', () => {
    for (const command of ['git checkout main -- api.py', 'git checkout feature/x', 'git restore --source=main api.py', 'git restore -s HEAD~2 api.py', 'git switch main', 'git stash pop', 'git stash apply stash@{1}', 'git reset --hard HEAD~1', 'git pull', 'git merge main', 'git cherry-pick abc123', 'git revert abc123', 'cd app && git checkout main -- src/a.ts']) {
      expect(bringsInCode(command)).toBe(true)
    }
  })

  test('commands that are not tree rewrites bring nothing in', () => {
    for (const command of ['git status', 'git diff main -- api.py', 'git log', "sed -i 's/a/b/' api.py"]) {
      expect(bringsInCode(command)).toBe(false)
    }
  })
})

// Verified review B1 (2026-10-20): what the record keeps of a git command is its verb, never its arguments, where a
// token in a remote URL can sit.
describe('gitVerb', () => {
  test('the git subcommand, and the stash action, from the first git segment; nothing else', () => {
    expect(gitVerb('git pull https://me:not-a-token@github.com/acme/app main')).toBe('git pull')
    expect(gitVerb('cd app && git checkout main -- src/a.ts')).toBe('git checkout')
    expect(gitVerb('git stash pop')).toBe('git stash pop')
    expect(gitVerb('git -c http.extraheader=AUTH fetch origin')).toBe('git fetch')
    expect(gitVerb('npm test')).toBe('git')
  })
})

// Verified review A6 (2026-10-20): the override record's backstop stood down for any command with a git segment.
describe('isGitOnly', () => {
  test('a command made of git alone, after cds, is git only', () => {
    for (const command of ['git pull', 'git checkout main && git pull --rebase', 'cd app && git merge main']) {
      expect(isGitOnly(command)).toBe(true)
    }
  })

  test('git beside anything else is not', () => {
    for (const command of ['node forge.js; git status', 'git status && node forge.js', "echo '{}' > x.json | git add x.json", 'npm test']) {
      expect(isGitOnly(command)).toBe(false)
    }
  })
})

// Verified review A7 (2026-10-20): one git rewrite segment emptied the change list for the whole command, so
// `python fix.py; git restore x` counted nothing. Only a command of git rewrites, cds and quiet segments is skipped.
describe('isRevertOnly', () => {
  const quiet = (segment: string) => /^\s*(?:pytest|npm test)\b/.test(segment)
  test('git rewrites, with cds and quiet segments beside them, are a revert only', () => {
    for (const command of ['git restore src/a.py', 'git stash && pytest', 'cd app && git checkout -- src/a.ts && npm test']) {
      expect(isRevertOnly(command, quiet)).toBe(true)
    }
  })

  test('a revert beside anything that could write is not, and neither is no revert at all', () => {
    for (const command of ['python /tmp/fix.py; git restore README.md', 'git restore a && node gen.js', 'pytest', 'git status']) {
      expect(isRevertOnly(command, quiet)).toBe(false)
    }
  })
})
