import { describe, expect, test } from 'claude-code/testing'

import { carriedOnAdvice, carryWaitMessage, configChangedAdvice, hollowAdvice, inheritedAdvice, runAdvice, staleUnlockNote, touchAdvice, unreadRunAdvice } from '../hooks/advice'
import { INITIAL_STATS, recordRun, recordSourceEdit, recordTestTouch, recordChange } from '../hooks/stats'

const at = (seconds: number) => 1_700_000_000_000 + seconds * 1_000
const touched = recordTestTouch(INITIAL_STATS, { module: 'money/formatCents', testPath: 'tests/money/formatCents.test.ts' }, at(0))

describe('touchAdvice', () => {
  test('tells the agent the module is unlocked and what to do before editing', () => {
    expect(touchAdvice('money/formatCents')).toBe(
      'dope-tdd: money/formatCents unlocked. Run its test and see it fail before editing src/money/formatCents.',
    )
  })
})

describe('runAdvice', () => {
  // VibeCast field test: a new pin's first red was told to "make it pass", when the pin had guessed today's
  // behaviour wrongly. Before any code change this cycle, the red is either the bug or a wrong pin: say both.
  test('a red before any code change names both readings: the bug, or a pin that guessed wrong', () => {
    const red = recordRun(touched, false, at(1))

    expect(runAdvice(touched, red)).toBe(
      'dope-tdd: RED on money/formatCents. If this is the bug or the missing behaviour, make it pass with the smallest change, then run it again. If you are pinning what the code does now, the pin guessed wrong: fix the assertion and say why.',
    )
  })

  test('a red after a code change is the change to make pass', () => {
    const changed = recordChange(recordRun(touched, false, at(1)), 'money/formatCents', 'C:/w/src/money/formatCents.ts', 'a', 'b')
    const red = recordRun(changed, false, at(2))

    expect(runAdvice(changed, red)).toBe('dope-tdd: RED on money/formatCents. Make it pass with the smallest change, then run it again.')
  })

  test('after a green that saw red, says so and gives the next step', () => {
    const red = recordRun(touched, false, at(1))
    const edited = recordSourceEdit(red, 'money/formatCents', true, at(2))
    const green = recordRun(edited, true, at(3))

    expect(runAdvice(edited, green)).toBe('dope-tdd: GREEN on money/formatCents, saw red. Now refactor with the test untouched, or write the next failing test.')
  })

  test('after a green that never saw red, says so and how to prove the test', () => {
    const green = recordRun(touched, true, at(1))

    expect(runAdvice(touched, green)).toBe(
      'dope-tdd: GREEN on money/formatCents but it never saw red: UNPROVEN. Break the code on purpose and run again to prove the test can fail.',
    )
  })

  test('says nothing after a pass that completes no cycle', () => {
    const idlePass = recordRun(INITIAL_STATS, true, at(1))

    expect(runAdvice(INITIAL_STATS, idlePass)).toBeNull()
  })
})

describe('runAdvice when the red is elsewhere', () => {
  test('names the files that failed and says the module has not seen red', () => {
    const elsewhere = recordRun(touched, false, at(1), ['tests/cart/applyDiscount.test.ts'])

    expect(runAdvice(touched, elsewhere, undefined, { elsewhere: ['tests/cart/applyDiscount.test.ts'] })).toBe(
      "dope-tdd: RED, but not on money/formatCents: tests/cart/applyDiscount.test.ts failed; money/formatCents's own test did not fail this run. money/formatCents has not seen red yet. Make its test fail before editing src/money/formatCents.",
    )
  })

  test('after the module did see red, only names the files', () => {
    const red = recordRun(touched, false, at(1))
    const elsewhere = recordRun(red, false, at(2), ['tests/cart/applyDiscount.test.ts'])

    expect(runAdvice(red, elsewhere, undefined, { elsewhere: ['tests/cart/applyDiscount.test.ts'] })).toBe(
      "dope-tdd: RED, but not on money/formatCents: tests/cart/applyDiscount.test.ts failed; money/formatCents's own test did not fail this run.",
    )
  })
})

describe('runAdvice when the test changed after red and the code did not', () => {
  test('says the green came from the test', () => {
    const red = recordRun(touched, false, at(1))
    const retouched = recordTestTouch(red, { module: 'money/formatCents', testPath: 'tests/money/formatCents.test.ts' }, at(2))
    const green = recordRun(retouched, true, at(3))

    expect(runAdvice(retouched, green, undefined, { testChanged: true })).toBe(
      'dope-tdd: GREEN on money/formatCents, saw red, but the test changed after red and src/money/formatCents did not. The green came from the test, not from a fix. If the red was real, put the assertion back and fix the code. If the assertion was wrong (a pin that guessed today\'s behaviour wrongly), say why in your reply; it stays on the record.',
    )
  })
})

describe('unreadRunAdvice', () => {
  test('says nothing was counted and how to get a readable result', () => {
    expect(unreadRunAdvice(false)).toBe(
      'dope-tdd: a test run happened but its summary line was not in the output, so nothing was counted. Run one test file and keep the end of its output, where the summary is.',
    )
    // VibeCast field test: a 40 KB npm test was cut before its summary, and the advice said to pipe through tail.
    expect(unreadRunAdvice(true)).toBe(
      'dope-tdd: a test run happened but the output was too long and was cut before its summary line, so nothing was counted. Run one test file, or the runner with a quieter reporter, so the summary fits.',
    )
  })

  test('for node --test, which prints its summary before the failures, the hint keeps the top or uses TAP (#18)', () => {
    expect(unreadRunAdvice(false, 'node-test')).toBe(
      'dope-tdd: a test run happened but its summary line was not in the output, so nothing was counted. node --test prints its summary before the failures, so a tail cuts it: run the one test file without a pipe, or with --test-reporter=tap | tail -40.',
    )
  })

  test('a node --test run that crashed reading its test process is said as that, with what to do (#26)', () => {
    expect(unreadRunAdvice(false, 'node-test', true)).toBe(
      'dope-tdd: node --test could not read its test process output (a Node bug when a test prints non-ASCII text, such as emoji), so nothing was counted. Run it again; if it keeps happening, quiet the logging in the code under test.',
    )
  })
})

describe('configChangedAdvice', () => {
  test('names the change and asks the agent to say why', () => {
    expect(configChangedAdvice('mode enforce → observe')).toBe(
      'dope-tdd: dope-tdd.json changed (mode enforce → observe). This is recorded in /tdd; say why in your reply.',
    )
  })
})

describe('inheritedAdvice', () => {
  test('gives the agent the history behind an unlock from an earlier session', () => {
    expect(inheritedAdvice('money/formatCents', 'tests/money/formatCents.test.ts', 2 * 60 * 60_000)).toBe(
      'dope-tdd: src/money/formatCents is unlocked because tests/money/formatCents.test.ts was touched 2H AGO in an earlier session. Run that test first if you have not this session.',
    )
  })
})

// #54: each message says what happened, why, and the exact next step, so an agent meeting this edge case cold
// understands it without reading the plugin.
describe('carried-over unlocks (#54)', () => {
  const HOURS_2 = 2 * 60 * 60_000

  test('the refused first edit says when and how it was unlocked, the command to run, why, and that no test edit is needed', () => {
    expect(carryWaitMessage('src/money/formatCents.ts', 'tests/money/formatCents.test.ts', HOURS_2, 'npx vitest run tests/money/formatCents.test.ts')).toBe(
      'dope-tdd: src/money/formatCents.ts was unlocked 2H AGO in an earlier session, when tests/money/formatCents.test.ts was touched. ' +
        'Before the first edit this session, run that test once, red or green: npx vitest run tests/money/formatCents.test.ts. ' +
        'Why: the earlier proof counts only while the test still runs, and a run now shows where things stand before your change. No test edit is needed.',
    )
  })

  test('without a known run command, it names the test file to run', () => {
    expect(carryWaitMessage('src/a.ts', 'tests/a.test.ts', HOURS_2)).toMatch(/run that test once, red or green: tests\/a\.test\.ts\./)
  })

  test('a green run says the unlock is active again', () => {
    expect(carriedOnAdvice('src/a.ts', 'tests/a.test.ts', true)).toBe(
      'dope-tdd: tests/a.test.ts ran green this session, so the unlock of src/a.ts carried over from an earlier session is active again. Edit away; your next green is checked as usual.',
    )
  })

  test('a red run says the unlock is active and the failures were there before any edit', () => {
    expect(carriedOnAdvice('src/a.ts', 'tests/a.test.ts', false)).toBe(
      'dope-tdd: tests/a.test.ts ran red this session, before any edit, so the unlock of src/a.ts carried over from an earlier session is active again. Those failures were already there: they are not from your change.',
    )
  })

  test('an unlock dropped because the test changed says why the edit is refused after all', () => {
    expect(staleUnlockNote('tests/a.test.ts', HOURS_2)).toBe(
      ' tests/a.test.ts unlocked it 2H AGO in an earlier session, but that test has changed since (a checkout, a merge, or an edit this guard did not see), so the earlier unlock no longer counts.',
    )
  })
})

describe('hollowAdvice', () => {
  test('names the test file and says why an assertion-free test is worthless', () => {
    expect(hollowAdvice('tests/money/formatCents.test.ts')).toBe(
      'dope-tdd: tests/money/formatCents.test.ts has no assertion. A test that asserts nothing passes no matter what the code does.',
    )
  })
})

describe('runAdvice with the catch check', () => {
  const red = recordRun(touched, false, at(1))
  const edited = recordSourceEdit(red, 'money/formatCents', true, at(2))
  const green = recordRun(edited, true, at(3))

  test('green, saw red, and the test catches the change', () => {
    expect(runAdvice(edited, green, { kind: 'caught' })).toBe(
      'dope-tdd: GREEN on money/formatCents, saw red, and its test catches the change: PROVEN. Now refactor with the test untouched, or write the next failing test.',
    )
  })

  test('green, saw red, but the test misses the change: fix the test first', () => {
    expect(runAdvice(edited, green, { kind: 'missed' })).toBe(
      'dope-tdd: GREEN on money/formatCents, but MISSED: with your change undone its test still passes, so the test was changed to pass or the change did not matter. Fix the test before moving on.',
    )
  })

  test('green that never saw red, but the test catches the change, is a real test after all', () => {
    const greenFirst = recordRun(recordSourceEdit(touched, 'money/formatCents', true, at(1)), true, at(2))

    expect(runAdvice(touched, greenFirst, { kind: 'caught' })).toBe(
      'dope-tdd: GREEN on money/formatCents, never saw red, but its test catches the change: with your change undone it fails, so it is PROVEN. Now refactor with the test untouched, or write the next failing test.',
    )
  })

  test('when the check could not run, says why and moves on', () => {
    expect(runAdvice(edited, green, { kind: 'unverified', reason: 'timeout' })).toBe(
      'dope-tdd: GREEN on money/formatCents, saw red. UNPROVEN: not checked (timeout). Now refactor with the test untouched, or write the next failing test.',
    )
  })
})

describe('runAdvice on a pass that completes no cycle', () => {
  test('a refactor that kept the test green is named as a fact, not praised', () => {
    const green = recordRun(recordRun(touched, false, at(1)), true, at(2))
    const again = recordRun(green, true, at(4))

    expect(runAdvice(green, again, 'refactor')).toBe(
      'dope-tdd: GREEN on money/formatCents with the test untouched: a refactor, not re-checked. The test still guards only what it asserted before. If it changed what the code does, that has no test yet: write one first.',
    )
  })

  test('a test written after the code that misses the change is still called out', () => {
    const green = recordRun(touched, true, at(1))
    const again = recordRun(recordSourceEdit(green, 'money/formatCents', true, at(2)), true, at(3))

    expect(runAdvice(green, again, { kind: 'missed' })).toMatch(/^dope-tdd: GREEN on money\/formatCents, MISSED: .*has proven nothing yet/)
  })
})
