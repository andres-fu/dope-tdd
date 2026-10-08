import { describe, expect, test } from 'claude-code/testing'

import { failedFiles, isTruncated, neverRan, runOutcome, stripAnsi } from '../hooks/runOutcome'

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
FAIL tests/money/formatCents.test.ts
  ● puts the minus sign before the dollar sign

Tests:       2 failed, 1 passed, 3 total
Snapshots:   0 total
Time:        1.2 s
`
const JEST_PASS = `
PASS tests/money/formatCents.test.ts
Tests:       3 passed, 3 total
Time:        0.9 s
`
const COLOURED_FAIL = '\u001b[2m Tests\u001b[22m  \u001b[1m\u001b[31m2 failed\u001b[39m\u001b[22m | 1 passed (3)\n'

describe('runOutcome', () => {
  test('reads the runner summary, so a pipe through tail or || true cannot hide a failure', () => {
    expect(runOutcome(VITEST_FAIL)).toBe('fail')
    expect(runOutcome(JEST_FAIL)).toBe('fail')
  })

  test('reads a pass from the summary alone, whatever the shell said', () => {
    expect(runOutcome(VITEST_PASS)).toBe('pass')
    expect(runOutcome(JEST_PASS)).toBe('pass')
  })

  test('a suite that could not load is a failure, not a pass', () => {
    expect(runOutcome(' Test Files  1 failed (1)\n      Tests  no tests\n')).toBe('fail')
    expect(runOutcome('Test Suites: 1 failed, 1 total\nTests:       0 total\n')).toBe('fail')
  })

  test('no test files found is not a run', () => {
    expect(runOutcome('No test files found, exiting with code 1\n')).toBe('none')
  })

  test('no summary is unknown, never a verdict: a crash, a truncated result and an empty output all count nothing', () => {
    expect(runOutcome('')).toBe('unknown')
    expect(runOutcome('Error: Cannot find module vitest')).toBe('unknown')
    expect(runOutcome('Output too large (41.9KB). Full output saved to: C:/x.txt\n\nPreview (first 2KB):\n RUN  v3\n')).toBe('unknown')
  })

  test('a coloured summary is read through the escape codes', () => {
    expect(runOutcome(COLOURED_FAIL)).toBe('fail')
    expect(stripAnsi(COLOURED_FAIL)).toBe(' Tests  2 failed | 1 passed (3)\n')
  })
})

describe('failedFiles', () => {
  test('names the test files Vitest and Jest reported as failed, once each', () => {
    expect(failedFiles(VITEST_FAIL)).toEqual(['tests/money/formatCents.test.ts'])
    expect(failedFiles(JEST_FAIL)).toEqual(['tests/money/formatCents.test.ts'])
    expect(failedFiles(' ❯ tests/a.test.ts (3 tests | 1 failed)\n ✓ tests/b.test.ts (2 tests)\n FAIL  tests/a.test.ts > x\n')).toEqual(['tests/a.test.ts'])
  })

  test('is empty for a pass or for output it cannot read', () => {
    expect(failedFiles(VITEST_PASS)).toEqual([])
    expect(failedFiles(JEST_PASS)).toEqual([])
    expect(failedFiles('')).toEqual([])
  })

  test('normalises Windows separators and strips colour', () => {
    expect(failedFiles(' FAIL  tests\\money\\formatCents.test.ts > x\n')).toEqual(['tests/money/formatCents.test.ts'])
    expect(failedFiles('\u001b[31m FAIL \u001b[39m tests/a.test.ts\n')).toEqual(['tests/a.test.ts'])
  })
})

describe('neverRan', () => {
  test('recognises the texts Claude Code returns when a command was held for approval or refused', () => {
    expect(neverRan('This PowerShell command contains multiple operations. The following part requires approval: npx vitest run tests/text/slugify.test.ts')).toBe(true)
    expect(neverRan("Claude requested permissions to use Bash, but you haven't granted it yet.")).toBe(true)
    expect(neverRan('Permission for this action was denied by the Claude Code auto mode classifier.')).toBe(true)
  })

  test('does not mistake a runner output for a hold', () => {
    expect(neverRan(VITEST_FAIL)).toBe(false)
    expect(neverRan('Error: Cannot find module vitest')).toBe(false)
  })
})

describe('isTruncated', () => {
  test('recognises the banner Claude Code puts on a tool result it cut short', () => {
    expect(isTruncated('Output too large (41.9KB). Full output saved to: C:/x.txt')).toBe(true)
    expect(isTruncated(VITEST_PASS)).toBe(false)
  })
})
