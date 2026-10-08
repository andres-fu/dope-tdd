import type { CatchOutcome } from '../types'
import { runOutcome } from './runOutcome'

export type RunnerKind = 'vitest' | 'jest'
export type RunResult = { stdout: string; stderr: string; exitCode: number }

const NO_TESTS_RAN = /^\s*Tests\s+no tests/m
const MAX_BUDGET_MS = 60_000

export function runnerArgv(root: string, runner: RunnerKind, testPath: string): string[] {
  return runner === 'vitest'
    ? ['node', `${root}/node_modules/vitest/vitest.mjs`, 'run', testPath]
    : ['node', `${root}/node_modules/jest/bin/jest.js`, testPath]
}

export function catchOutcome(run: RunResult | 'timeout' | 'no-runner'): CatchOutcome {
  if (run === 'timeout') {
    return { kind: 'unverified', reason: 'timeout' }
  }
  if (run === 'no-runner') {
    return { kind: 'unverified', reason: 'no runner found' }
  }
  const output = `${run.stdout}\n${run.stderr}`
  if (NO_TESTS_RAN.test(output)) {
    return { kind: 'unverified', reason: 'no tests ran' }
  }
  const outcome = runOutcome(output, run.exitCode !== 0)
  if (outcome === 'none') {
    return { kind: 'unverified', reason: 'no tests ran' }
  }
  return outcome === 'fail' ? { kind: 'caught' } : { kind: 'missed' }
}

export function timeBudgetMs(greenRunMs: number): number {
  return Math.min(2 * greenRunMs + 5_000, MAX_BUDGET_MS)
}
