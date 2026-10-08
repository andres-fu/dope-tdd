import { describe, expect, test } from 'claude-code/testing'

import { runOutcome } from '../hooks/runOutcome'

const VITEST_FAIL = `
 FAIL  tests/money/formatCents.test.ts > puts the minus sign before the dollar sign
AssertionError: expected '$-12.50' to be '-$12.50'

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
   Start at  00:00:58
   Duration  549ms
`
const VITEST_PASS = `
 ✓ tests/money/formatCents.test.ts (3 tests) 4ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  412ms
`
const JEST_FAIL = `
Tests:       2 failed, 1 passed, 3 total
Snapshots:   0 total
Time:        1.2 s
`
const JEST_PASS = `
Tests:       3 passed, 3 total
Time:        0.9 s
`

describe('runOutcome', () => {
  test('reads the runner summary, so a pipe through tail or || true cannot hide a failure', () => {
    expect(runOutcome(VITEST_FAIL, false)).toBe('fail')
    expect(runOutcome(JEST_FAIL, false)).toBe('fail')
  })

  test('reads a pass from the summary even when the shell reported an error', () => {
    expect(runOutcome(VITEST_PASS, true)).toBe('pass')
    expect(runOutcome(JEST_PASS, true)).toBe('pass')
  })

  test('a suite that could not load is a failure, not a pass', () => {
    expect(runOutcome(' Test Files  1 failed (1)\n      Tests  no tests\n', false)).toBe('fail')
    expect(runOutcome('Test Suites: 1 failed, 1 total\nTests:       0 total\n', false)).toBe('fail')
  })

  test('no test files found is not a run', () => {
    expect(runOutcome('No test files found, exiting with code 1\n', true)).toBe('none')
  })

  test('falls back to the shell result when there is no summary to read', () => {
    expect(runOutcome('', false)).toBe('pass')
    expect(runOutcome('Error: Cannot find module vitest', true)).toBe('fail')
  })
})
