import { describe, expect, test } from 'claude-code/testing'

import { changedPaths, isRevertCommand, parseNumstat } from '../hooks/gitChanges'

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
