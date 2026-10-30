// The live suite's probe repos (tools/live/probe.mjs): built under the OS temp folder, guarded by dope-tdd, and gone
// after the run, worktrees and branches included. Uses git, so it takes about a second; no model turns.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { cleanup, dropSessionRecords, dropTranscripts, makeRoot, readCalc } from '../../tools/live/probe.mjs'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('a probe is a committed git repo, guarded with the mirror layout, whose test passes', () => {
  const dirs = makeRoot('probe')
  try {
    // Resolved, as makeRoot resolves it: macOS's temp folder is a link into /private.
    assert.ok(dirs.root.startsWith(realpathSync.native(tmpdir())), 'under the OS temp folder')
    assert.deepEqual(JSON.parse(readFileSync(join(dirs.probe, 'dope-tdd.json'), 'utf8')), { layout: 'mirror' })
    assert.equal(readCalc(dirs.probe), 'export function add(a, b) {\n  return a + b\n}\n')
    assert.equal(git(dirs.probe, 'status', '--porcelain'), '', 'everything is committed')
    // Without NODE_TEST_CONTEXT, or node:test skips a run started from inside a test.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'))
    // The reporter named: without a terminal, CI's node prints TAP where a local one prints spec.
    const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dirs.probe, encoding: 'utf8', env })
    assert.match(out, /^# pass 1$/m)
  } finally {
    cleanup(dirs.root)
  }
})

test('home is a second guarded repo, and linked is a git worktree of the probe', () => {
  const home = makeRoot('home')
  const linked = makeRoot('linked')
  try {
    assert.ok(existsSync(join(home.root, 'home', 'dope-tdd.json')))
    assert.ok(existsSync(join(home.probe, 'src', 'calc.js')))
    assert.equal(readFileSync(join(linked.root, 'linked', '.git'), 'utf8').startsWith('gitdir: '), true, 'linked is a worktree, not a clone')
    assert.match(git(linked.probe, 'worktree', 'list'), /linked/)
  } finally {
    cleanup(home.root)
    cleanup(linked.root)
  }
})

test('nested is a git worktree under the probe, ignored there as a real project ignores it', () => {
  const dirs = makeRoot('nested')
  const nested = join(dirs.probe, '.claude', 'worktrees', 'nested')
  try {
    assert.equal(readFileSync(join(nested, '.git'), 'utf8').startsWith('gitdir: '), true, 'nested is a worktree, not a clone')
    assert.ok(existsSync(join(nested, 'tests', 'calc.test.js')))
    assert.equal(git(dirs.probe, 'status', '--porcelain'), '', 'the main checkout does not see it')
    assert.equal(cleanup(dirs.root).length, 1)
  } finally {
    cleanup(dirs.root)
  }
})

test('cleanup removes every worktree a run left, even one outside the root, then the whole folder', () => {
  const dirs = makeRoot('linked')
  const agent = join(dirs.probe, '.claude', 'worktrees', 'agent-a1b2')
  const outside = join(mkdtempSync(join(tmpdir(), 'dope-tdd-outside-')), 'agent-c3d4')
  git(dirs.probe, 'worktree', 'add', '-q', agent, '-b', 'worktree-agent-a1b2')
  git(dirs.probe, 'worktree', 'add', '-q', outside, '-b', 'worktree-agent-c3d4')
  try {
    assert.equal(cleanup(dirs.root).length, 3)
    assert.equal(existsSync(dirs.root), false)
    assert.equal(existsSync(outside), false, 'the worktree outside the root is gone too')
  } finally {
    cleanup(join(outside, '..'))
  }
})

test('dropSessionRecords removes only the records of the sessions it is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dope-tdd-records-'))
  try {
    for (const name of ['2026-10-29-s1.json', '2026-10-30-s1.json', '2026-10-29-s2.json', '2026-10-29-keep.json']) writeFileSync(join(dir, name), '{}')
    assert.deepEqual(dropSessionRecords(dir, ['s1', 's2']).sort(), ['2026-10-29-s1.json', '2026-10-29-s2.json', '2026-10-30-s1.json'])
    assert.deepEqual(readdirSync(dir), ['2026-10-29-keep.json'])
    assert.deepEqual(dropSessionRecords(join(dir, 'missing'), ['s1']), [], 'no folder, nothing to drop')
  } finally {
    cleanup(dir)
  }
})

test("dropTranscripts removes Claude Code's transcript folders of the sessions run under one root, and no others", () => {
  const projects = mkdtempSync(join(tmpdir(), 'dope-tdd-projects-'))
  const root = 'C:\\Temp\\dope-tdd-live-iDznnk'
  try {
    const names = [
      'C--Temp-dope-tdd-live-iDznnk-probe',
      'C--Temp-dope-tdd-live-iDznnk-linked',
      'C--Temp-dope-tdd-live-iDznnk-probe--claude-worktrees-agent-a1b2',
      'C--Temp-dope-tdd-live-iDznnkX-probe',
      'C--Users-someone-project',
    ]
    for (const name of names) mkdirSync(join(projects, name))
    assert.deepEqual(dropTranscripts(projects, root).sort(), names.slice(0, 3).sort())
    assert.deepEqual(readdirSync(projects).sort(), names.slice(3).sort())
    assert.deepEqual(dropTranscripts(join(projects, 'missing'), root), [])
  } finally {
    cleanup(projects)
  }
})

test('cleanup of a folder that is not a git repo just removes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dope-tdd-plain-'))
  mkdirSync(join(dir, 'probe'))
  assert.deepEqual(cleanup(dir), [])
  assert.equal(existsSync(dir), false)
})
