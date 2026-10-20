import { describe, expect, test } from 'claude-code/testing'

import { carriedOnAdvice, carryWaitMessage, configChangedAdvice, hollowAdvice, inheritedAdvice, runAdvice, staleUnlockNote, touchAdvice, unreadRunAdvice } from '../hooks/advice'
import { say } from '../hooks/messages'
import { INITIAL_STATS, recordRun, recordSourceEdit, recordTestTouch, recordChange } from '../hooks/stats'

// These tests check which message is said, with which facts. The words themselves are pinned once, in
// tests/fixtures/messages.golden.ts (the message catalogue, 2026-10-18).
const at = (seconds: number) => 1_700_000_000_000 + seconds * 1_000
const MODULE = 'money/formatCents'
const SOURCE = 'src/money/formatCents'
const touched = recordTestTouch(INITIAL_STATS, { module: MODULE, testPath: 'tests/money/formatCents.test.ts' }, at(0))

describe('touchAdvice', () => {
  test('tells the agent the module is unlocked and what to do before editing', () => {
    expect(touchAdvice(MODULE)).toBe(say('touch.unlocked', { module: MODULE, sourcePath: SOURCE, command: undefined }))
  })
})

describe('runAdvice', () => {
  // VibeCast field test: a new pin's first red was told to "make it pass", when the pin had guessed today's
  // behaviour wrongly. Before any code change this cycle, the red is either the bug or a wrong pin: say both.
  test('a red before any code change names both readings: the bug, or a pin that guessed wrong', () => {
    expect(runAdvice(touched, recordRun(touched, false, at(1)))).toBe(say('red.first', { module: MODULE }))
  })

  test('a red after a code change is the change to make pass', () => {
    const changed = recordChange(recordRun(touched, false, at(1)), MODULE, 'C:/w/src/money/formatCents.ts', 'a', 'b')
    expect(runAdvice(changed, recordRun(changed, false, at(2)))).toBe(say('red.again', { module: MODULE }))
  })

  test('after a green that saw red, says so and gives the next step', () => {
    const edited = recordSourceEdit(recordRun(touched, false, at(1)), MODULE, true, at(2))
    expect(runAdvice(edited, recordRun(edited, true, at(3)))).toBe(say('green.sawRed', { module: MODULE }))
  })

  // Karl's Python trial (2026-10-19): a pin broken on purpose, red, then green again was told only "saw red", while
  // the briefing calls exactly that PROVEN, and the counts had already stopped calling it never failed.
  test('after a pin went green, then red, then green again, says the pin is PROVEN', () => {
    const pinned = recordRun(touched, true, at(1))
    const broken = recordRun(pinned, false, at(2))
    expect(runAdvice(broken, recordRun(broken, true, at(3)))).toBe(say('green.pinBreakProven', { module: MODULE }))
  })

  // A pin's first red proves it only when a test failed on an assertion (2026-10-19): an import or collection error
  // says nothing about whether the test can fail, so the red says so and the pin stays unproven.
  test('a red of errors only after a pin went green says it proves nothing yet', () => {
    const pinned = recordRun(touched, true, at(1))
    const crashed = recordRun(pinned, false, at(2), [], { errorsOnly: true })
    expect(runAdvice(pinned, crashed, undefined, { errorsOnly: true })).toBe(say('red.first', { module: MODULE }) + say('note.errorsOnly', { module: MODULE }))
    // The same red on a module with no unproven pin needs no note.
    const red = recordRun(touched, false, at(1), [], { errorsOnly: true })
    expect(runAdvice(touched, red, undefined, { errorsOnly: true })).toBe(say('red.first', { module: MODULE }))
  })

  test('after a green that never saw red, says so and how to prove the test', () => {
    expect(runAdvice(touched, recordRun(touched, true, at(1)))).toBe(say('green.neverRed', { module: MODULE }))
  })

  // Seen live (2026-10-19): runners' own test imported shell, so its red was said only as "RED on shell".
  test("a run through another open module's own test names that module too, red or green", () => {
    const red = runAdvice(touched, recordRun(touched, false, at(1)), undefined, { ownTestOf: 'runners' })
    expect(red).toBe(say('red.first', { module: MODULE }) + say('note.ownTestToo', { module: MODULE, other: 'runners', outcome: 'red' }))
    const edited = recordSourceEdit(recordRun(touched, false, at(1)), MODULE, true, at(2))
    const green = runAdvice(edited, recordRun(edited, true, at(3)), undefined, { ownTestOf: 'runners' })
    expect(green).toBe(say('green.sawRed', { module: MODULE }) + say('note.ownTestToo', { module: MODULE, other: 'runners', outcome: 'green' }))
  })

  test('says nothing after a pass that completes no cycle', () => {
    expect(runAdvice(INITIAL_STATS, recordRun(INITIAL_STATS, true, at(1)))).toBeNull()
  })
})

describe('runAdvice when the red is elsewhere', () => {
  const files = ['tests/cart/applyDiscount.test.ts']

  test('names the files that failed and says the module has not seen red', () => {
    const elsewhere = recordRun(touched, false, at(1), files)
    expect(runAdvice(touched, elsewhere, undefined, { elsewhere: files })).toBe(say('red.elsewhere', { module: MODULE, sourcePath: SOURCE, files, sawRed: false }))
  })

  test('after the module did see red, only names the files', () => {
    const red = recordRun(touched, false, at(1))
    const elsewhere = recordRun(red, false, at(2), files)
    expect(runAdvice(red, elsewhere, undefined, { elsewhere: files })).toBe(say('red.elsewhere', { module: MODULE, sourcePath: SOURCE, files, sawRed: true }))
  })
})

describe('runAdvice when the test changed after red and the code did not', () => {
  test('says the green came from the test', () => {
    const retouched = recordTestTouch(recordRun(touched, false, at(1)), { module: MODULE, testPath: 'tests/money/formatCents.test.ts' }, at(2))
    expect(runAdvice(retouched, recordRun(retouched, true, at(3)), undefined, { testChanged: true })).toBe(say('green.testChanged', { module: MODULE, sourcePath: SOURCE }))
  })
})

describe('unreadRunAdvice', () => {
  test('says nothing was counted and how to get a readable result', () => {
    expect(unreadRunAdvice(false)).toBe(say('run.unread', { nodeTest: false }))
    // VibeCast field test: a 40 KB npm test was cut before its summary, and the advice said to pipe through tail.
    expect(unreadRunAdvice(true)).toBe(say('run.truncated', {}))
  })

  test('for node --test, which prints its summary before the failures, the hint keeps the top or uses TAP (#18)', () => {
    expect(unreadRunAdvice(false, 'node-test')).toBe(say('run.unread', { nodeTest: true }))
  })

  test('a node --test run that crashed reading its test process is said as that, with what to do (#26)', () => {
    expect(unreadRunAdvice(false, 'node-test', true)).toBe(say('run.crashed', {}))
  })
})

describe('configChangedAdvice', () => {
  test('names the change and asks the agent to say why', () => {
    expect(configChangedAdvice('mode enforce → observe')).toBe(say('config.changed', { detail: 'mode enforce → observe' }))
  })
})

describe('inheritedAdvice', () => {
  test('gives the agent the history behind an unlock from an earlier session', () => {
    const ageMs = 2 * 60 * 60_000
    expect(inheritedAdvice(MODULE, 'tests/money/formatCents.test.ts', ageMs)).toBe(say('inherited.reminder', { sourcePath: SOURCE, testPath: 'tests/money/formatCents.test.ts', ageMs }))
  })
})

// #54: each message says what happened, why, and the exact next step, so an agent meeting this edge case cold
// understands it without reading the plugin.
describe('carried-over unlocks (#54)', () => {
  const HOURS_2 = 2 * 60 * 60_000

  test('the refused first edit says when and how it was unlocked, the command to run, why, and that no test edit is needed', () => {
    const command = 'npx vitest run tests/money/formatCents.test.ts'
    expect(carryWaitMessage('src/money/formatCents.ts', 'tests/money/formatCents.test.ts', HOURS_2, command)).toBe(
      say('carry.wait', { sourcePath: 'src/money/formatCents.ts', testPath: 'tests/money/formatCents.test.ts', ageMs: HOURS_2, command }),
    )
  })

  test('without a known run command, it names the test file to run', () => {
    expect(carryWaitMessage('src/a.ts', 'tests/a.test.ts', HOURS_2)).toMatch(/run that test once, red or green: tests\/a\.test\.ts\./)
  })

  test('a green run, or a red one, says the unlock is active again', () => {
    expect(carriedOnAdvice('src/a.ts', 'tests/a.test.ts', true)).toBe(say('carry.onGreen', { sourcePath: 'src/a.ts', testPath: 'tests/a.test.ts' }))
    expect(carriedOnAdvice('src/a.ts', 'tests/a.test.ts', false)).toBe(say('carry.onRed', { sourcePath: 'src/a.ts', testPath: 'tests/a.test.ts' }))
  })

  test('an unlock dropped because the test changed says why the edit is refused after all', () => {
    expect(staleUnlockNote('tests/a.test.ts', HOURS_2)).toBe(say('note.staleUnlock', { testPath: 'tests/a.test.ts', ageMs: HOURS_2 }))
  })
})

describe('hollowAdvice', () => {
  test('names the test file and says why an assertion-free test is worthless', () => {
    expect(hollowAdvice('tests/money/formatCents.test.ts')).toBe(say('test.noAssertion', { testPath: 'tests/money/formatCents.test.ts' }))
  })
})

describe('runAdvice with the catch check', () => {
  const red = recordRun(touched, false, at(1))
  const edited = recordSourceEdit(red, MODULE, true, at(2))
  const green = recordRun(edited, true, at(3))

  test('green, saw red, and the test catches the change', () => {
    expect(runAdvice(edited, green, { kind: 'caught' })).toBe(say('green.caught', { module: MODULE, sawRed: true }))
  })

  test('green, saw red, but the test misses the change: fix the test first', () => {
    expect(runAdvice(edited, green, { kind: 'missed' })).toBe(say('green.missed', { module: MODULE, sawRed: true, slipped: [] }))
  })

  test('green that never saw red, but the test catches the change, is a real test after all', () => {
    const greenFirst = recordRun(recordSourceEdit(touched, MODULE, true, at(1)), true, at(2))
    expect(runAdvice(touched, greenFirst, { kind: 'caught' })).toBe(say('green.caught', { module: MODULE, sawRed: false }))
  })

  test('when the check could not run, says why and moves on', () => {
    expect(runAdvice(edited, green, { kind: 'unverified', reason: 'timeout' })).toBe(say('green.notChecked', { module: MODULE, sawRed: true, reason: 'timeout' }))
  })
})

describe('runAdvice on a pass that completes no cycle', () => {
  test('a refactor that kept the test green is named as a fact, not praised', () => {
    const green = recordRun(recordRun(touched, false, at(1)), true, at(2))
    expect(runAdvice(green, recordRun(green, true, at(4)), 'refactor')).toBe(say('green.refactor', { module: MODULE }))
  })

  test('a test written after the code that misses the change is still called out', () => {
    const green = recordRun(touched, true, at(1))
    const again = recordRun(recordSourceEdit(green, MODULE, true, at(2)), true, at(3))
    expect(runAdvice(green, again, { kind: 'missed' })).toBe(say('green.missed', { module: MODULE, sawRed: false, slipped: [] }))
  })
})

// Pin corrected (2026-10-18, from the VibeCast field test): fixing a pin that guessed today's behaviour wrongly looks,
// on the record alone, exactly like a test bent to match a bug. The difference is the pin skill: with it in use this
// session, the correction is said as what it is, on its own line and not as a workaround; without it, it stays
// "test changed". Either way the pin still has to be proven by a deliberate break.
describe('runAdvice when a pin was corrected after red', () => {
  test('says it is the expected fix, on the record, and that a break still proves it', () => {
    const red = recordRun({ ...touched, pinning: true }, false, at(1))
    const retouched = recordTestTouch(red, { module: MODULE, testPath: 'tests/money/formatCents.test.ts' }, at(2))
    expect(runAdvice(retouched, recordRun(retouched, true, at(3)), undefined, { testChanged: true })).toBe(say('green.pinCorrected', { module: MODULE, sourcePath: SOURCE }))
  })
})

// The proof's follow-up list (#27, #55): which message, by the kind of proof and whether small changes were tried.
describe('runAdvice after a proof with small changes tried', () => {
  const red = recordRun(touched, false, at(1))
  const edited = recordSourceEdit(red, MODULE, true, at(2))
  const green = recordRun(edited, true, at(3))
  const mutation = { tried: 3, caught: 2, survived: ['line 4: `<` → `<=`'] }

  test('a pin proven by a break, then small changes: the pin message with what went unnoticed', () => {
    expect(runAdvice(edited, green, { kind: 'proven', pinned: true, mutation })).toBe(say('green.pinProven', { module: MODULE, ...mutation, lineEndings: false }))
  })

  test('a new file proven by small changes alone: the new-file message', () => {
    expect(runAdvice(edited, green, { kind: 'proven', mutation })).toBe(say('green.newFileProven', { module: MODULE, ...mutation }))
  })

  test('a new file whose test passed every small change: missed, with each change named', () => {
    expect(runAdvice(edited, green, { kind: 'missed', mutation })).toBe(say('green.newFileMissed', { module: MODULE, tried: 3, survived: mutation.survived }))
  })

  test('a break with no small changes tried: proven by the break alone', () => {
    expect(runAdvice(edited, green, { kind: 'proven', pinned: true })).toBe(say('green.brokenProven', { module: MODULE, lineEndings: false }))
  })

  test('caught by a test that imports the module, not its own: proven by that test', () => {
    expect(runAdvice(edited, green, { kind: 'caught', by: 'test/slugify.test.ts', own: 'test/io.test.ts' })).toBe(
      say('green.provenBy', { module: MODULE, sawRed: true, own: 'test/io.test.ts', by: 'test/slugify.test.ts' }),
    )
  })
})
