import type { CatchOutcome } from '../types'
import { runOutcome, stripAnsi } from './runOutcome'

export type RunnerKind = 'vitest' | 'jest'
export type RunResult = { stdout: string; stderr: string; exitCode: number }
export type RunFailure = 'timeout' | 'no-runner' | { failedToStart: string }

const NO_TESTS_RAN = /^\s*Tests\s+no tests/m
const MAX_BUDGET_MS = 60_000
const TIMED_OUT = /time(?:d)?\s?out/i

/** `runnerRoot` is the directory whose node_modules holds the runner; in a monorepo that can be above the project. */
export function runnerArgv(runnerRoot: string, runner: RunnerKind, testPath: string): string[] {
  return runner === 'vitest'
    ? ['node', `${runnerRoot}/node_modules/vitest/vitest.mjs`, 'run', testPath]
    : ['node', `${runnerRoot}/node_modules/jest/bin/jest.js`, testPath]
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

export function catchOutcome(run: RunResult | RunFailure): CatchOutcome {
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
  const outcome = runOutcome(output)
  if (outcome === 'none') {
    return { kind: 'unverified', reason: 'no tests ran' }
  }
  if (outcome === 'unknown') {
    return { kind: 'unverified', reason: 'no runner summary' }
  }
  return outcome === 'fail' ? { kind: 'caught' } : { kind: 'missed' }
}

export function timeBudgetMs(greenRunMs: number): number {
  return Math.min(2 * greenRunMs + 5_000, MAX_BUDGET_MS)
}
