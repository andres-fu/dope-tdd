import type { CatchOutcome } from '../types'
import { failedFilesIn, failedOnlyOnErrors, failedTestsIn, nodeRunnerCrashed, readRun, runnerNamed } from './runners.ts'
import type { RunnerKind, RunnerOptions } from './runners.ts'
import { runnerDidNotStart, stripAnsi } from './runOutcome.ts'

export type { RunnerKind, RunnerOptions } from './runners.ts'
export type RunResult = { stdout: string; stderr: string; exitCode: number }
export type RunFailure = 'timeout' | 'no-runner' | { failedToStart: string }

// Vitest's exact words when a file ran but held no test; the readers say 'none' for every other runner's form.
const NO_TESTS_RAN = /^\s*Tests\s+no tests/m
const MAX_BUDGET_MS = 60_000
const TIMED_OUT = /time(?:d)?\s?out/i

/**
 * The command that runs one test file. `runnerRoot` is where the runner was
 * found (in a monorepo that can be above the project); `tool` is the program
 * found there, or the runner's fallback when none was.
 */
export function runnerArgv(runnerRoot: string, runner: RunnerKind, testPath: string, tool?: string, options: RunnerOptions = {}): string[] {
  const entry = runnerNamed(runner)
  const program = tool ?? (entry.fallback.includes('/') ? `${runnerRoot}/${entry.fallback}` : entry.fallback)
  return entry.argv(runnerRoot, testPath, program, options)
}

/** What a rejected runner process means: a timeout is one thing, a runner that never started is another. */
export function runFailure(error: unknown): RunFailure {
  const message = failureText(error)
  return TIMED_OUT.test(message) ? 'timeout' : { failedToStart: message }
}

/** The engine rejects with an Error; a refusal from a mod above arrives as its reason. Either way, the words. */
function failureText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    for (const key of ['deny', 'message', 'reason']) {
      const value = record[key]
      if (typeof value === 'string') {
        return value
      }
    }
  }
  return String(error)
}

/** A failed file names this test when one path ends with the other: runners print paths from where they ran. */
function namesTest(failed: readonly string[], testPath: string): boolean {
  const want = testPath.replace(/\\/g, '/').toLowerCase()
  return failed.some(path => {
    const seen = path.replace(/\\/g, '/').toLowerCase()
    return seen.endsWith(want) || want.endsWith(seen)
  })
}

/**
 * `testPath` is the test the check ran. When the runner names the files that
 * failed, the red must include it: a red in other files is not this test
 * catching the change.
 */
export function catchOutcome(run: RunResult | RunFailure, testPath?: string, known: readonly string[] = []): CatchOutcome {
  if (run === 'timeout') {
    return { kind: 'unverified', reason: 'timeout' }
  }
  if (run === 'no-runner') {
    return { kind: 'unverified', reason: 'no runner found' }
  }
  if ('failedToStart' in run) {
    return { kind: 'unverified', reason: `runner could not start (${run.failedToStart})` }
  }
  const output = stripAnsi(`${run.stdout}\n${run.stderr}`)
  if (NO_TESTS_RAN.test(output)) {
    return { kind: 'unverified', reason: 'no tests ran' }
  }
  // Before the summary: the crash reads as a red of the whole file, which is how a false CAUGHT came about (#26).
  if (nodeRunnerCrashed(output)) {
    return { kind: 'unverified', reason: 'node --test could not read its test process output (a Node bug when a test prints non-ASCII text)' }
  }
  const outcome = readRun(output)
  if (outcome === 'none') {
    return { kind: 'unverified', reason: 'no tests ran' }
  }
  if (outcome === 'unknown') {
    // Named when the output says so, as the shell reading does (verified review D5, 2026-10-20).
    const notStarted = runnerDidNotStart(output)
    return { kind: 'unverified', reason: notStarted === null ? 'no runner summary' : `the runner did not start: ${notStarted}` }
  }
  // A load error is no tests run (the catch-check decision, 2026-10-08). Vitest says so; pytest, unittest and node --test
  // print an error count that reads as a red, which earned a PROVEN no assertion ran for (#132, 2026-10-21).
  if (outcome === 'fail' && failedOnlyOnErrors(output)) {
    return { kind: 'unverified', reason: 'with the change undone the test could not run (an import, a collection or a compile error), so no assertion was checked' }
  }
  // Only tests that were failing before the change failed: nothing that checks this change went red.
  if (outcome === 'fail' && known.length > 0) {
    const names = failedTestsIn(output)
    if (names.length > 0 && names.every(name => known.includes(name))) {
      return { kind: 'missed' }
    }
  }
  if (outcome === 'fail' && testPath !== undefined) {
    const failed = failedFilesIn(output)
    if (failed.length > 0 && !namesTest(failed, testPath)) {
      return { kind: 'unverified', reason: 'the red was in other test files' }
    }
  }
  return outcome === 'fail' ? { kind: 'caught' } : { kind: 'missed' }
}

export function timeBudgetMs(greenRunMs: number): number {
  return Math.min(2 * greenRunMs + 5_000, MAX_BUDGET_MS)
}
