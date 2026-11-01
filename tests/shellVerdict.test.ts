import { describe, expect, test } from 'claude-code/testing'

import { carriedOnAdvice, redUnlockAdvice, unreadableRunnerAdvice } from '../hooks/advice'
import { DEFAULT_CONFIG } from '../hooks/config'
import { ELSEWHERE } from '../hooks/shell'
import { leftOutShellEdits, gateShellWrites, judgeFailures, ownTestRun, readShellRun, shellGate, shellReminders } from '../hooks/shellVerdict'
import type { ShellReminderFacts } from '../hooks/shellVerdict'
import { MOCHA_PASS, PYTEST_FAIL, PYTEST_PASS } from './fixtures/runnerOutputs'

describe('gateShellWrites', () => {
  const unlocked = { 'utils/open': 'C:/r/tests/utils/open.test.ts', 'utils/carried': 'C:/r/tests/utils/carried.test.ts' }
  const inherited = { 'utils/carried': 1 }

  test('a write to an enforced module with no unlock is locked', () => {
    expect(gateShellWrites([{ module: 'utils/a', policy: 'enforce' }], unlocked, inherited)).toEqual({ locked: ['utils/a'], waiting: [] })
  })

  test('a write to a module unlocked only by a carry-over waits for its run (#54)', () => {
    expect(gateShellWrites([{ module: 'utils/carried', policy: 'enforce' }], unlocked, inherited)).toEqual({ locked: [], waiting: ['utils/carried'] })
  })

  test('an unlocked module, a non-source path, and warn, observe or exempt policies pass', () => {
    const writes = [
      { module: 'utils/open', policy: 'enforce' },
      { module: null, policy: 'enforce' },
      { module: 'utils/b', policy: 'warn' },
      { module: 'utils/c', policy: 'observe' },
      { module: 'utils/d', policy: 'exempt' },
    ] as const
    expect(gateShellWrites(writes, unlocked, inherited)).toEqual({ locked: [], waiting: [] })
  })

  test('keeps the order and repeats of the writes', () => {
    const writes = [
      { module: 'utils/b', policy: 'enforce' },
      { module: 'utils/carried', policy: 'enforce' },
      { module: 'utils/a', policy: 'enforce' },
      { module: 'utils/b', policy: 'enforce' },
    ] as const
    expect(gateShellWrites(writes, unlocked, inherited)).toEqual({ locked: ['utils/b', 'utils/a', 'utils/b'], waiting: ['utils/carried'] })
  })

  // #198: an unlock counts only in the checkout its test was touched in, so a write to the main checkout is not let
  // through by a test touched in an agent worktree, nor the other way round.
  test('a write is locked when its module was unlocked by a test in another checkout', () => {
    const fromWorktree = { 'utils/open': 'C:/r/.claude/worktrees/agent-x/tests/utils/open.test.ts' }
    const main = { module: 'utils/open', policy: 'enforce', path: 'C:/r/src/utils/open.ts' } as const
    const worktree = { module: 'utils/open', policy: 'enforce', path: 'C:/r/.claude/worktrees/agent-x/src/utils/open.ts' } as const
    expect(gateShellWrites([main], fromWorktree, {}, 'C:/r')).toEqual({ locked: ['utils/open'], waiting: [] })
    expect(gateShellWrites([worktree], fromWorktree, {}, 'C:/r')).toEqual({ locked: [], waiting: [] })
    expect(gateShellWrites([worktree], unlocked, {}, 'C:/r')).toEqual({ locked: ['utils/open'], waiting: [] })
  })

  // #233: the same holds for agent worktrees under the main checkout, when the session root is a linked worktree.
  test('a test in an agent worktree under the main checkout unlocks that worktree only', () => {
    const fromWorktree = { 'utils/open': 'C:/main/.claude/worktrees/agent-x/tests/utils/open.test.ts' }
    const session = { module: 'utils/open', policy: 'enforce', path: 'C:/r/src/utils/open.ts' } as const
    const worktree = { module: 'utils/open', policy: 'enforce', path: 'C:/main/.claude/worktrees/agent-x/src/utils/open.ts' } as const
    expect(gateShellWrites([session], fromWorktree, {}, 'C:/r', 'C:/main')).toEqual({ locked: ['utils/open'], waiting: [] })
    expect(gateShellWrites([worktree], fromWorktree, {}, 'C:/r', 'C:/main')).toEqual({ locked: [], waiting: [] })
  })
})

describe('judgeFailures', () => {
  test('only tests known to fail before the change: green, nothing new recorded', () => {
    expect(judgeFailures(['a', 'b'], { knownFailures: ['a', 'b', 'c'] })).toEqual({ outcome: 'pass', alreadyFailing: ['a', 'b'], record: null })
  })

  test('fewer than the red, none new: green, and those become the known failures', () => {
    expect(judgeFailures(['a'], { redFailures: ['a', 'b'] })).toEqual({ outcome: 'pass', alreadyFailing: ['a'], record: 'known' })
  })

  test('as many as the red is still red, and the names are recorded as the red', () => {
    expect(judgeFailures(['a', 'b'], { redFailures: ['a', 'b'] })).toEqual({ outcome: 'fail', alreadyFailing: [], record: 'red' })
  })

  test('a new failing name is red', () => {
    expect(judgeFailures(['a', 'z'], { knownFailures: ['a'], redFailures: ['a', 'b', 'c'] })).toEqual({ outcome: 'fail', alreadyFailing: [], record: 'red' })
  })

  test('no names read: red, nothing recorded', () => {
    expect(judgeFailures([], { knownFailures: ['a'], redFailures: ['a'] })).toEqual({ outcome: 'fail', alreadyFailing: [], record: null })
  })

  test('no earlier record: red, the names recorded', () => {
    expect(judgeFailures(['a'], {})).toEqual({ outcome: 'fail', alreadyFailing: [], record: 'red' })
  })
})

describe('shellReminders', () => {
  const none: ShellReminderFacts = {
    paused: false,
    unguardedPaths: [],
    alreadyFailing: [],
    alreadyFailingModule: null,
    notStarted: null,
    unreadableRunner: null,
    bystanders: [],
    commented: [],
    redUnlocked: [],
    carriedOn: [],
    passed: false,
    advice: null,
  }

  test('a run with nothing to report adds no reminder lines', () => {
    expect(shellReminders(none, DEFAULT_CONFIG, 'C:/r')).toEqual([])
  })

  // One fact at a time, so a failure names the line that broke. Wording is asserted only where the user reads it.
  test('a source file changed through the shell with no test touched is named', () => {
    expect(shellReminders({ ...none, unguardedPaths: ['src/utils/a.ts'] }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: src/utils/a.ts changed through a shell command without a test touched first.',
    ])
  })

  test('a runner that did not start says nothing was counted', () => {
    expect(shellReminders({ ...none, notStarted: 'command not found' }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: the test runner did not start (command not found); nothing was counted. Run it the way this project runs its tests.',
    ])
  })

  test('a file that changed while the command ran, which the command cannot have changed, is not counted', () => {
    expect(shellReminders({ ...none, bystanders: ['src/utils/b.ts'] }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: src/utils/b.ts changed while the command ran, but the command cannot have changed it (another editor or session?); not counted.',
    ])
  })

  test('all the lines together keep their fixed order', () => {
    const facts: ShellReminderFacts = {
      paused: false,
      unguardedPaths: ['src/utils/a.ts'],
      alreadyFailing: ['adds', 'subtracts'],
      alreadyFailingModule: 'utils/a',
      notStarted: 'command not found',
      unreadableRunner: 'mocha',
      bystanders: ['src/utils/b.ts'],
      commented: ['dope-tdd: commented out'],
      redUnlocked: ['utils/c'],
      carriedOn: [{ module: 'utils/d', testPath: 'C:/r/tests/utils/d.test.ts' }],
      passed: true,
      advice: 'dope-tdd: GREEN',
    }
    expect(shellReminders(facts, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: src/utils/a.ts changed through a shell command without a test touched first.',
      'dope-tdd: utils/a is green apart from 2 tests that were already failing before your change: adds; subtracts.',
      'dope-tdd: the test runner did not start (command not found); nothing was counted. Run it the way this project runs its tests.',
      unreadableRunnerAdvice('mocha'),
      'dope-tdd: src/utils/b.ts changed while the command ran, but the command cannot have changed it (another editor or session?); not counted.',
      'dope-tdd: commented out',
      redUnlockAdvice('utils/c', 'src/utils/c'),
      carriedOnAdvice('src/utils/d', 'tests/utils/d.test.ts', true),
      'dope-tdd: GREEN',
    ])
  })

  test('paused: nothing at all', () => {
    expect(shellReminders({ ...none, paused: true, unguardedPaths: ['src/utils/a.ts'], advice: 'dope-tdd: GREEN' }, DEFAULT_CONFIG, 'C:/r')).toEqual([])
  })

  test('one already-failing test, with no module named, and more than three cut short', () => {
    expect(shellReminders({ ...none, alreadyFailing: ['adds'] }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: this module is green apart from 1 test that was already failing before your change: adds.',
    ])
    expect(shellReminders({ ...none, alreadyFailing: ['a', 'b', 'c', 'd'], alreadyFailingModule: 'utils/a' }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      'dope-tdd: utils/a is green apart from 4 tests that were already failing before your change: a; b; c; ….',
    ])
  })

  test('a red carry-over run says the failures were already there', () => {
    expect(shellReminders({ ...none, carriedOn: [{ module: 'utils/d', testPath: 'C:/r/tests/utils/d.test.ts' }] }, DEFAULT_CONFIG, 'C:/r')).toEqual([
      carriedOnAdvice('src/utils/d', 'tests/utils/d.test.ts', false),
    ])
  })
})

// #59, the shell gate (2026-10-18): the verdict on a shell command's writes, before it runs, out of register.tsx.
describe('shellGate', () => {
  const none = { writesRecord: false, locked: [], waiting: [], paused: false }

  test('a write to the override record is refused first, whatever else the command does', () => {
    expect(shellGate({ ...none, writesRecord: true, locked: ['a'], paused: true })).toEqual({ kind: 'deny-record' })
  })

  test('locked or waiting modules refuse the command, each named once', () => {
    expect(shellGate({ ...none, locked: ['a'], waiting: ['b', 'b'] })).toEqual({ kind: 'refuse', locked: ['a'], waiting: ['b'] })
    expect(shellGate({ ...none, waiting: ['b'] })).toEqual({ kind: 'refuse', locked: [], waiting: ['b'] })
  })

  test('paused: the command goes through, on the record as debt', () => {
    expect(shellGate({ ...none, locked: ['a'], waiting: ['b'], paused: true })).toEqual({ kind: 'go' })
  })

  test('nothing locked: it goes', () => {
    expect(shellGate(none)).toEqual({ kind: 'go' })
  })
})

// Out of register.tsx (checkShell): whether a shell command was a run of this project's tests, and what its summary
// says. register.tsx finds where the run ran (a workspace run's package included) and acts on the reading.
describe('readShellRun', () => {
  const ROOT = 'C:/work/app'
  const quiet = { notStarted: null, unreadable: null }

  test('a run inside the project is read from its summary', () => {
    expect(readShellRun(PYTEST_PASS, ROOT, ROOT)).toEqual({ outcome: 'pass', ...quiet })
    expect(readShellRun(PYTEST_FAIL, `${ROOT}/server`, ROOT)).toEqual({ outcome: 'fail', ...quiet })
  })

  test('a command that ran no tests, or ran them in another repository, is no run of this project', () => {
    expect(readShellRun(PYTEST_PASS, null, ROOT)).toEqual({ outcome: 'none', ...quiet })
    expect(readShellRun(PYTEST_PASS, 'C:/work/other', ROOT)).toEqual({ outcome: 'none', ...quiet })
    expect(readShellRun(PYTEST_PASS, ELSEWHERE, ROOT)).toEqual({ outcome: 'none', ...quiet })
    // Nor is a runner there that dope-tdd cannot read yet named as one of this session's.
    expect(readShellRun(MOCHA_PASS, 'C:/work/other', ROOT)).toEqual({ outcome: 'none', ...quiet })
  })

  test('a command held for approval or refused never ran, whatever else its text says', () => {
    expect(readShellRun(`This command requires approval\n${PYTEST_PASS}`, ROOT, ROOT)).toEqual({ outcome: 'none', ...quiet })
  })

  test('output with no summary is an unread run', () => {
    expect(readShellRun('something printed, no summary\n', ROOT, ROOT)).toEqual({ outcome: 'unknown', ...quiet })
  })

  test('a runner that never started ran no test: no unread run, and it says why', () => {
    expect(readShellRun("/usr/bin/python: No module named pytest\n", ROOT, ROOT)).toEqual({ outcome: 'none', notStarted: 'No module named pytest', unreadable: null })
  })

  test('a runner recognised but not read yet is named, and its run is not counted', () => {
    expect(readShellRun(MOCHA_PASS, ROOT, ROOT)).toEqual({ outcome: 'none', notStarted: null, unreadable: 'mocha' })
  })

  test('a runner that did not start is said first, over one not read yet', () => {
    expect(readShellRun(`mocha: command not found\n${MOCHA_PASS}`, ROOT, ROOT)).toEqual({ outcome: 'none', notStarted: 'command not found', unreadable: null })
  })

  test('a summary that was read wins: an import error inside a real run is still red', () => {
    expect(readShellRun(PYTEST_FAIL.replace('FAILED', "No module named 'x'\nFAILED"), ROOT, ROOT)).toEqual({ outcome: 'fail', ...quiet })
  })
})

// Out of register.tsx (checkShell): the red run of one named test file, which is then judged by which tests fail.
describe('ownTestRun', () => {
  const ROOT = 'C:/r'
  const run = 'npx vitest run tests/utils/a.test.ts'

  test('a red run naming one test file in the layout counts for that file and its module', () => {
    expect(ownTestRun(run, 'fail', ROOT, ROOT, DEFAULT_CONFIG)).toEqual({ module: 'utils/a', testPath: 'C:/r/tests/utils/a.test.ts' })
  })

  test('the named file is found from where the shell is', () => {
    expect(ownTestRun('npx vitest run utils/a.test.ts', 'fail', 'C:/r/tests', ROOT, DEFAULT_CONFIG)).toEqual({ module: 'utils/a', testPath: 'C:/r/tests/utils/a.test.ts' })
  })

  test('only a red run is judged this way', () => {
    expect(ownTestRun(run, 'pass', ROOT, ROOT, DEFAULT_CONFIG)).toBeNull()
    expect(ownTestRun(run, 'unknown', ROOT, ROOT, DEFAULT_CONFIG)).toBeNull()
  })

  test('a run filtered to some tests by name says nothing about the rest', () => {
    expect(ownTestRun(`${run} -t adds`, 'fail', ROOT, ROOT, DEFAULT_CONFIG)).toBeNull()
  })

  test('a run that names no test file, or a file outside the layout, has no own test', () => {
    expect(ownTestRun('npx vitest run', 'fail', ROOT, ROOT, DEFAULT_CONFIG)).toBeNull()
    expect(ownTestRun('npx vitest run src/utils/a.ts', 'fail', ROOT, ROOT, DEFAULT_CONFIG)).toBeNull()
  })

  // #250: `root` is the run's own checkout (shellCheckout.ts). Against the session root, a run in a worktree nested under
  // it matches no layout, so it counts for no module.
  test('a run in a nested worktree is classified against the checkout it was given', () => {
    expect(ownTestRun(run, 'fail', 'C:/r/.claude/worktrees/w', ROOT, DEFAULT_CONFIG)).toBeNull()
    expect(ownTestRun(run, 'fail', 'C:/r/.claude/worktrees/w', 'C:/r/.claude/worktrees/w', DEFAULT_CONFIG)).toEqual({
      module: 'utils/a',
      testPath: 'C:/r/.claude/worktrees/w/tests/utils/a.test.ts',
    })
  })

  test('a module unlocked in another checkout is not this run to judge: its failures are not that module\'s', () => {
    expect(ownTestRun(run, 'fail', ROOT, ROOT, DEFAULT_CONFIG, ['utils/a'])).toBeNull()
    expect(ownTestRun(run, 'fail', ROOT, ROOT, DEFAULT_CONFIG, ['utils/b'])).toEqual({ module: 'utils/a', testPath: 'C:/r/tests/utils/a.test.ts' })
  })
})

describe('leftOutShellEdits: what a command wrote that dope-tdd cannot guard (#259)', () => {
  const py = { path: 'tools/a.py', why: 'stack' } as const
  const js = { path: 'helpers.js', why: 'layout' } as const
  const moved = { wasMs: 1, isMs: 2 }
  const pyListed = { path: 'tools/a.py', list: 'stack' }
  const jsListed = { path: 'helpers.js', list: 'shell' }

  test('a file the command named that changed on disk, and one git saw that is still there, once each', () => {
    expect(leftOutShellEdits([{ ...js, ...moved }, { ...py, ...moved }], [{ ...py, isMs: 2 }, { path: 'tools/b.py', why: 'stack', isMs: 2 }], true)).toEqual([jsListed, pyListed, { path: 'tools/b.py', list: 'stack' }])
  })

  test('a layout miss goes on the shell list, which stays off the band; another stack keeps its own', () => {
    expect(leftOutShellEdits([{ ...js, ...moved }], [], true)).toEqual([jsListed])
    expect(leftOutShellEdits([{ ...py, ...moved }], [], true)).toEqual([pyListed])
  })

  test('a named file that did not change, or is gone, did not land', () => {
    expect(leftOutShellEdits([{ ...js, wasMs: 1, isMs: 1 }], [], true)).toEqual([])
    expect(leftOutShellEdits([{ ...js, wasMs: null, isMs: null }], [], true)).toEqual([])
    expect(leftOutShellEdits([{ ...js, wasMs: 1, isMs: null }], [], true)).toEqual([])
  })

  test('a new file landed', () => {
    expect(leftOutShellEdits([{ ...js, wasMs: null, isMs: 2 }], [], true)).toEqual([jsListed])
  })

  test('a file git saw deleted is not an edit', () => {
    expect(leftOutShellEdits([], [{ ...py, isMs: null }], true)).toEqual([])
  })

  test('a command held read-only leaves what it names out', () => {
    expect(leftOutShellEdits([{ ...js, ...moved }], [], false)).toEqual([])
  })

  test('what git saw stands either way, and nothing written is nothing to say', () => {
    expect(leftOutShellEdits([], [{ ...py, isMs: 2 }], false)).toEqual([pyListed])
    expect(leftOutShellEdits([], [], true)).toEqual([])
  })
})
