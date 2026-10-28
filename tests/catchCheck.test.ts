import { describe, expect, test } from 'claude-code/testing'

import { catchOutcome, linkArgv, nestedPackageDirs, runFailure, runnerArgv, timeBudgetMs, unlinkArgv, worktreeFailureReason } from '../hooks/catchCheck'
import { NODE_TEST_REAL_IPC_CRASH, NODE_TEST_REAL_LOAD_ERROR, PYTEST_COLLECTION_ERROR_QUIET, PYTEST_FAIL, UNITTEST_IMPORT_ERROR, VITEST_REAL_FAIL } from './fixtures/runnerOutputs'

describe('runFailure', () => {
  test('a timeout is a timeout; anything else is a runner that could not start, with its message', () => {
    expect(runFailure(new Error('process timed out after 9000ms'))).toBe('timeout')
    expect(runFailure({ deny: 'timed out' })).toBe('timeout')
    expect(runFailure(new Error('spawn node ENOENT'))).toEqual({ failedToStart: 'spawn node ENOENT' })
    expect(catchOutcome({ failedToStart: 'spawn node ENOENT' })).toEqual({ kind: 'unverified', reason: 'runner could not start (spawn node ENOENT)' })
  })
})

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

  test('takes the directory that holds the runner, which in a monorepo is above the project', () => {
    expect(runnerArgv('C:/mono', 'vitest', 'tests/a.test.ts')[1]).toBe('C:/mono/node_modules/vitest/vitest.mjs')
  })
})

describe('catchOutcome', () => {
  test('a failing run with the change undone means the test catches it', () => {
    expect(catchOutcome({ stdout: ' Tests  1 failed (1)\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'caught' })
  })

  test('a red in other test files only is not this test catching the change', () => {
    const elsewhere = { stdout: ' FAIL  tests/other.test.ts > x\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n', stderr: '', exitCode: 1 }
    const own = { stdout: ' FAIL  tests/utils/a.test.ts > x\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n', stderr: '', exitCode: 1 }
    expect(catchOutcome(elsewhere, 'tests/utils/a.test.ts')).toEqual({ kind: 'unverified', reason: 'the red was in other test files' })
    expect(catchOutcome(own, 'tests/utils/a.test.ts')).toEqual({ kind: 'caught' })
    expect(catchOutcome({ stdout: ' Tests  1 failed (1)\n', stderr: '', exitCode: 1 }, 'tests/utils/a.test.ts')).toEqual({ kind: 'caught' })
  })

  test('a passing run with the change undone means the test misses it', () => {
    expect(catchOutcome({ stdout: ' Tests  3 passed (3)\n', stderr: '', exitCode: 0 })).toEqual({ kind: 'missed' })
  })

  test('no tests run, a timeout, and no runner are unverified, each with its reason', () => {
    expect(catchOutcome({ stdout: 'No test files found\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'unverified', reason: 'no tests ran' })
    expect(catchOutcome('timeout')).toEqual({ kind: 'unverified', reason: 'timeout' })
    expect(catchOutcome('no-runner')).toEqual({ kind: 'unverified', reason: 'no runner found' })
  })

  test('a runner that crashed before any test ran is unverified, never caught: the exit code is not evidence', () => {
    expect(catchOutcome({ stdout: '', stderr: 'Error: Cannot find module vitest.config.ts', exitCode: 1 })).toEqual({
      kind: 'unverified',
      reason: 'no runner summary',
    })
    expect(catchOutcome({ stdout: '', stderr: '', exitCode: 0 })).toEqual({ kind: 'unverified', reason: 'no runner summary' })
  })

  // Verified review D5 (2026-10-20): a check whose runner was missing said only "no runner summary"; the shell path
  // already named the missing module, the check did not.
  test('a runner that never started says why, as the shell reading does', () => {
    expect(catchOutcome({ stdout: '', stderr: 'C:\\Python314\\python.exe: No module named pytest', exitCode: 1 })).toEqual({
      kind: 'unverified',
      reason: 'the runner did not start: No module named pytest',
    })
  })

  test('node --test crashing on its child process output is unverified, never caught, and says why (#26)', () => {
    // The crash names the file as one failed test: read as a red, it was a CAUGHT no assertion earned.
    expect(catchOutcome({ stdout: NODE_TEST_REAL_IPC_CRASH, stderr: '', exitCode: 1 }, 'test/sources/youtube.test.js')).toEqual({
      kind: 'unverified',
      reason: 'node --test could not read its test process output (a Node bug when a test prints non-ASCII text)',
    })
  })

  // The catch-check decision (2026-10-08) counts a load error as no tests run. Vitest says so in its summary; pytest,
  // unittest and node --test report an error count instead, which read as a red and earned a PROVEN no assertion ran for.
  test('a run with the change undone that failed only on errors is unverified, never caught', () => {
    for (const stdout of [PYTEST_COLLECTION_ERROR_QUIET, UNITTEST_IMPORT_ERROR, NODE_TEST_REAL_LOAD_ERROR]) {
      expect(catchOutcome({ stdout, stderr: '', exitCode: 1 })).toEqual({
        kind: 'unverified',
        reason: 'with the change undone the test could not run (an import, a collection or a compile error), so no assertion was checked',
      })
    }
    expect(catchOutcome({ stdout: PYTEST_FAIL, stderr: '', exitCode: 1 })).toEqual({ kind: 'caught', message: 'assert 3 == 4' })
  })

  test('reads a coloured summary', () => {
    expect(catchOutcome({ stdout: '\u001b[2m Tests\u001b[22m  \u001b[31m1 failed\u001b[39m (1)\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'caught' })
  })
})

describe('timeBudgetMs', () => {
  test('is twice the green run plus five seconds, capped at a minute', () => {
    expect(timeBudgetMs(2_000)).toBe(9_000)
    expect(timeBudgetMs(60_000)).toBe(60_000)
  })
})

// #168, seen adopting dope-tdd in an Astro + Vitest site: "the throwaway copy could not run the test ... see the log",
// while most ways the copy fails wrote nothing to any log. The reason now says which step failed.
describe('worktreeFailureReason', () => {
  test('names the step that failed, and leaves the user\'s file alone', () => {
    expect(worktreeFailureReason({ step: 'copy' })).toBe('the throwaway copy could not be made (git worktree add failed), so your file was left alone')
    expect(worktreeFailureReason({ step: 'changes' })).toBe('the throwaway copy could not be made (git could not list your uncommitted changes), so your file was left alone')
    expect(worktreeFailureReason({ step: 'too-many', detail: '300' })).toBe('the throwaway copy could not be made (more than 300 uncommitted files to copy), so your file was left alone')
    expect(worktreeFailureReason({ step: 'unreadable', detail: 'site/src/a.ts' })).toBe('the throwaway copy could not be made (site/src/a.ts could not be read), so your file was left alone')
    expect(worktreeFailureReason({ step: 'error', detail: 'EPERM' })).toBe('the throwaway copy could not run the test (EPERM), so your file was left alone')
  })

  test('a test that does not pass in the copy says why, and where the copy runs it differently', () => {
    expect(worktreeFailureReason({ step: 'not-green', detail: 'red' })).toBe(
      'the test did not pass in the throwaway copy with your change in (red), so your file was left alone: a config that resolves paths from the project folder can run differently there',
    )
  })
})

// Idea 18 (2026-10-26): what the test said when the change was undone travels with the catch.
describe('a caught change keeps the failure message', () => {
  test('the first assertion the run failed on; none when the output has none', () => {
    expect(catchOutcome({ stdout: VITEST_REAL_FAIL, stderr: '', exitCode: 1 }, 'sum.test.js')).toEqual({ kind: 'caught', message: 'expected 2 to be 3' })
    expect(catchOutcome({ stdout: ' Tests  1 failed (1)\n', stderr: '', exitCode: 1 })).toEqual({ kind: 'caught' })
  })
})

// #168: a nested package (site/ in an Astro site) keeps its own node_modules. From the copy inside .git, a runner walks
// up past it and cannot load the package's config, so each folder on the way down to the run gets its node_modules
// linked in the copy.
describe('nestedPackageDirs', () => {
  test('every folder from the root down to where the run happens, the root itself left out', () => {
    expect(nestedPackageDirs('site')).toEqual(['site'])
    expect(nestedPackageDirs('apps/web')).toEqual(['apps', 'apps/web'])
    expect(nestedPackageDirs('apps\\web\\')).toEqual(['apps', 'apps/web'])
  })

  test('a run at the root needs none', () => {
    expect(nestedPackageDirs('')).toEqual([])
    expect(nestedPackageDirs('.')).toEqual([])
  })
})

describe('linkArgv and unlinkArgv', () => {
  test('paths are arguments, never part of the script', () => {
    const link = linkArgv("C:/w/site/node_modules", "C:/w/.git/dope-tdd/wt/si'te/node_modules")
    expect(link.slice(0, 2)).toEqual(['node', '-e'])
    expect(link[2]).toMatch(/symlinkSync\(process\.argv\[1\], process\.argv\[2\], 'junction'\)/)
    expect(link.slice(3)).toEqual(["C:/w/site/node_modules", "C:/w/.git/dope-tdd/wt/si'te/node_modules"])
  })

  // Checked by hand on Windows (2026-10-26): unlinkSync removes a junction and leaves its target; on a real folder it
  // throws, so the unlink can never delete what a link pointed at, or a folder that was not a link.
  test('the unlink removes only a link, and a missing one is fine', () => {
    const unlink = unlinkArgv('C:/w/.git/dope-tdd/wt/site/node_modules')
    expect(unlink[2]).toMatch(/unlinkSync\(process\.argv\[1\]\)/)
    expect(unlink[2]).toMatch(/ENOENT/)
    expect(unlink[2]).not.toMatch(/rmSync|recursive/)
    expect(unlink[3]).toBe('C:/w/.git/dope-tdd/wt/site/node_modules')
  })
})
