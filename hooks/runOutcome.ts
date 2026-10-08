export type RunOutcome = 'pass' | 'fail' | 'none'

const NO_TESTS = /No test files found|No tests found/i
const SUMMARY_LINE = /^\s*(?:Tests|Test Files|Test Suites):?\s+(.+)$/gm
const FAILED = /(\d+)\s+failed/
const PASSED = /\d+\s+passed/

export function runOutcome(output: string, shellReportedError: boolean): RunOutcome {
  if (NO_TESTS.test(output)) {
    return 'none'
  }

  const summaries = [...output.matchAll(SUMMARY_LINE)].map(match => match[1] ?? '')
  if (summaries.some(summary => Number(FAILED.exec(summary)?.[1] ?? 0) > 0)) {
    return 'fail'
  }
  if (summaries.some(summary => PASSED.test(summary))) {
    return 'pass'
  }
  return shellReportedError ? 'fail' : 'pass'
}
