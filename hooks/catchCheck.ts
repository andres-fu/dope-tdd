import type { CatchOutcome } from '../types'
import { readRun, runnerNamed } from './runners'
import type { RunnerKind, RunnerOptions } from './runners'
import { stripAnsi } from './runOutcome'

export type { RunnerKind, RunnerOptions } from './runners'
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
  const outcome = readRun(output)
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
