export type RunOutcome = 'pass' | 'fail' | 'none' | 'unknown'

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const NO_TESTS = /No test files found|No tests found/i
const SUMMARY_LINE = /^\s*(?:Tests|Test Files|Test Suites):?\s+(.+)$/gm
const FAILED = /(\d+)\s+failed/
const PASSED = /\d+\s+passed/
const FAILED_FILE = /^\s*(?:FAIL|❯|×)\s+((?:[A-Za-z]:)?[\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gm
const TRUNCATION_BANNER = /Output too large/

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/**
 * Reads the runner's own summary line. There is no exit-code fallback on
 * purpose: a pipe, `|| true`, a crash before any test ran, or a truncated
 * tool result all leave no summary, and none of them is a verdict.
 */
export function runOutcome(output: string): RunOutcome {
  const text = stripAnsi(output)
  if (NO_TESTS.test(text)) {
    return 'none'
  }

  const summaries = [...text.matchAll(SUMMARY_LINE)].map(match => match[1] ?? '')
  if (summaries.some(summary => Number(FAILED.exec(summary)?.[1] ?? 0) > 0)) {
    return 'fail'
  }
  if (summaries.some(summary => PASSED.test(summary))) {
    return 'pass'
  }
  return 'unknown'
}

/** Test files the runner named as failed (Vitest `FAIL`/`❯` lines, Jest `FAIL` lines). */
export function failedFiles(output: string): string[] {
  const files = [...stripAnsi(output).matchAll(FAILED_FILE)].flatMap(match =>
    match[1] === undefined ? [] : [match[1].replace(/\\/g, '/')],
  )
  return [...new Set(files)]
}

/** Claude Code replaces a long tool result with a preview and this banner; the summary line is gone with it. */
export function isTruncated(output: string): boolean {
  return TRUNCATION_BANNER.test(output)
}
