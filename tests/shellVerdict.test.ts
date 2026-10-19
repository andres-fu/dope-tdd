import { describe, expect, test } from 'claude-code/testing'

import { carriedOnAdvice, redUnlockAdvice, unreadableRunnerAdvice } from '../hooks/advice'
import { DEFAULT_CONFIG } from '../hooks/config'
import { gateShellWrites, judgeFailures, shellGate, shellReminders } from '../hooks/shellVerdict'
import type { ShellReminderFacts } from '../hooks/shellVerdict'

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
