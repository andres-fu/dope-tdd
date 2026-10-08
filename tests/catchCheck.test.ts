import { describe, expect, test } from 'claude-code/testing'

import { catchOutcome, runnerArgv, timeBudgetMs } from '../hooks/catchCheck'

describe('runnerArgv', () => {
  test('runs the test file through node directly, so no shell or npx wrapper is needed on any OS', () => {
    expect(runnerArgv('C:/w', 'vitest', 'tests/a.test.ts')).toEqual([
      'node',
      'C:/w/node_modules/vitest/vitest.mjs',
      'run',
      'tests/a.test.ts',
    ])
    expect(runnerArgv('C:/w', 'jest', 'tests/a.test.ts')).toEqual(['node', 'C:/w/node_modules/jest/bin/jest.js', 'tests/a.test.ts'])
  })
})

describe('catchOutcome', () => {
  test('a failing run with the change undone means the test catches it', () => {
    expect(catchOutcome({ stdout: ' Tests  1 failed (1)\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'caught' })
  })

  test('a passing run with the change undone means the test misses it', () => {
    expect(catchOutcome({ stdout: ' Tests  3 passed (3)\n', stderr: '', exitCode: 0 })).toEqual({ kind: 'missed' })
  })

  test('no tests run, a timeout, and no runner are unverified, each with its reason', () => {
    expect(catchOutcome({ stdout: 'No test files found\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'unverified', reason: 'no tests ran' })
    expect(catchOutcome('timeout')).toEqual({ kind: 'unverified', reason: 'timeout' })
    expect(catchOutcome('no-runner')).toEqual({ kind: 'unverified', reason: 'no runner found' })
  })
})

describe('timeBudgetMs', () => {
  test('is twice the green run plus five seconds, capped at a minute', () => {
    expect(timeBudgetMs(2_000)).toBe(9_000)
    expect(timeBudgetMs(60_000)).toBe(60_000)
  })
})
