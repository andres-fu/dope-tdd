import { describe, expect, test } from 'claude-code/testing'

import { hollowAdvice, inheritedAdvice, runAdvice, touchAdvice } from '../hooks/advice'
import { INITIAL_STATS, recordRun, recordSourceEdit, recordTestTouch } from '../hooks/stats'

const at = (seconds: number) => 1_700_000_000_000 + seconds * 1_000
const touched = recordTestTouch(INITIAL_STATS, { module: 'money/formatCents', testPath: 'tests/money/formatCents.test.ts' }, at(0))

describe('touchAdvice', () => {
  test('tells the agent the module is unlocked and what to do before editing', () => {
    expect(touchAdvice('money/formatCents')).toBe(
      'red-first: money/formatCents unlocked. Run its test and see it fail before editing src/money/formatCents.',
    )
  })
})

describe('runAdvice', () => {
  test('after a failing run, says RED and what comes next', () => {
    const red = recordRun(touched, false, at(1))

    expect(runAdvice(touched, red)).toBe('red-first: RED on money/formatCents. Make it pass with the smallest change, then run it again.')
  })

  test('after a green that saw red, gives refactor credit and the next step', () => {
    const red = recordRun(touched, false, at(1))
    const edited = recordSourceEdit(red, 'money/formatCents', true, at(2))
    const green = recordRun(edited, true, at(3))

    expect(runAdvice(edited, green)).toBe('red-first: GREEN on money/formatCents, saw red. Now refactor with the test untouched.')
  })

  test('after a green that never saw red, says so and how to prove the test', () => {
    const green = recordRun(touched, true, at(1))

    expect(runAdvice(touched, green)).toBe(
      'red-first: GREEN on money/formatCents but it never saw red. Break the code on purpose and run again to prove the test can fail.',
    )
  })

  test('says nothing after a pass that completes no cycle', () => {
    const idlePass = recordRun(INITIAL_STATS, true, at(1))

    expect(runAdvice(INITIAL_STATS, idlePass)).toBeNull()
  })
})

describe('inheritedAdvice', () => {
  test('gives the agent the history behind an unlock from an earlier session', () => {
    expect(inheritedAdvice('money/formatCents', 'tests/money/formatCents.test.ts', 2 * 60 * 60_000)).toBe(
      'red-first: src/money/formatCents is unlocked because tests/money/formatCents.test.ts was touched 2H AGO in an earlier session. Run that test first if you have not this session.',
    )
  })
})

describe('hollowAdvice', () => {
  test('names the test file and says why an assertion-free test is worthless', () => {
    expect(hollowAdvice('tests/money/formatCents.test.ts')).toBe(
      'red-first: tests/money/formatCents.test.ts has no assertion. A test that asserts nothing passes no matter what the code does.',
    )
  })
})

describe('runAdvice with the catch check', () => {
  const red = recordRun(touched, false, at(1))
  const edited = recordSourceEdit(red, 'money/formatCents', true, at(2))
  const green = recordRun(edited, true, at(3))

  test('green, saw red, and the test catches the change', () => {
    expect(runAdvice(edited, green, { kind: 'caught' })).toBe(
      'red-first: GREEN on money/formatCents, saw red, and its test catches the change. Now refactor with the test untouched.',
    )
  })

  test('green, saw red, but the test misses the change: fix the test first', () => {
    expect(runAdvice(edited, green, { kind: 'missed' })).toBe(
      'red-first: GREEN on money/formatCents, but its test does NOT catch the change: with your change undone it still passes, so the test was changed to pass or the change did not matter. Fix the test before moving on.',
    )
  })

  test('green that never saw red, but the test catches the change, is a real test after all', () => {
    const greenFirst = recordRun(recordSourceEdit(touched, 'money/formatCents', true, at(1)), true, at(2))

    expect(runAdvice(touched, greenFirst, { kind: 'caught' })).toBe(
      'red-first: GREEN on money/formatCents, never saw red, but its test catches the change: with your change undone it fails. Now refactor with the test untouched.',
    )
  })

  test('when the check could not run, says why and moves on', () => {
    expect(runAdvice(edited, green, { kind: 'unverified', reason: 'timeout' })).toBe(
      'red-first: GREEN on money/formatCents, saw red. Could not verify that its test catches the change (timeout). Now refactor with the test untouched.',
    )
  })
})

describe('runAdvice on a pass that completes no cycle', () => {
  test('a refactor that kept the test green earns credit', () => {
    const green = recordRun(recordRun(touched, false, at(1)), true, at(2))
    const again = recordRun(green, true, at(4))

    expect(runAdvice(green, again, 'refactor')).toBe(
      'red-first: GREEN on money/formatCents: the refactor kept the test green with the test untouched. Refactor credit.',
    )
  })

  test('a test written after the code that misses the change is still called out', () => {
    const green = recordRun(touched, true, at(1))
    const again = recordRun(recordSourceEdit(green, 'money/formatCents', true, at(2)), true, at(3))

    expect(runAdvice(green, again, { kind: 'missed' })).toMatch(/has proven nothing yet/)
  })
})
