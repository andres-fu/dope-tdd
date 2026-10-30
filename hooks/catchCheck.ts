import type { CatchOutcome, CycleChange } from '../types'
import { failedFilesIn, failedOnlyOnErrors, failedTestsIn, failureMessage, nodeRunnerCrashed, readRun, runnerNamed } from './runners.ts'
import type { RunnerKind, RunnerOptions } from './runners.ts'
import { runnerDidNotStart, stripAnsi } from './runOutcome.ts'
import { sameIgnoringLineEndings } from './unlocks.ts'

export type { RunnerKind, RunnerOptions } from './runners.ts'

export type CatchPlanInput = {
  /** This cycle's change to the module's source, if one was captured. */
  change: CycleChange | undefined
  /** The module has a test on record. */
  hasTest: boolean
  /** The backstop saw an edit since the last run (a patch, a formatter, a copy). */
  editedSinceRun: boolean
  /** The module saw red in this cycle and its test was not edited after that red. */
  provedByRed: boolean
  /** That red never reached an assertion: an import, a collection or a compile broke (#132). */
  redErrorsOnly: boolean
  /** The config lets the check touch the changed file: not observe, not exempt, and catchCheck is not false. */
  checkable: boolean
}

/**
 * `done`: the verdict, with nothing to run. `pin`: proven by a deliberate break; the pinned file then gets the small
 * changes a new file gets. `new-file`: those small changes, as there is no old code. `revert`: the old code against the test.
 */
export type CatchPlan =
  | { kind: 'done'; result: CatchOutcome | 'unchecked' | 'refactor' }
  | { kind: 'pin'; lineEndings: boolean }
  | { kind: 'new-file' }
  | { kind: 'revert' }

/** What a green asks of the catch check, before anything is run or reverted (out of register.tsx, verifyCatch). */
export function catchPlan(input: CatchPlanInput): CatchPlan {
  const { change } = input
  if (change === undefined) {
    // The backstop saw an edit that the text capture did not: say so, never stay silent.
    return { kind: 'done', result: input.editedSinceRun && input.hasTest ? { kind: 'unverified', reason: 'change not captured' } : 'unchecked' }
  }
  if (!input.hasTest) {
    return { kind: 'done', result: 'unchecked' }
  }
  // #57: on Windows a checkout keeps CRLF, and Git Bash's `sed -i` writes the whole file back with LF. A restore by
  // shell is then the code from before the break with other line endings. That changes nothing the code does, so it
  // counts as restored; reverting it would "undo" only line endings and read as MISSED. The agent is told why.
  const lineEndingsOnly = change.before !== null && change.before !== change.after && sameIgnoringLineEndings(change.before, change.after)
  if (change.before === change.after || lineEndingsOnly) {
    // Broken on purpose, red, restored byte for byte: the red was the check, so there is nothing left to revert.
    // Never when the test was edited after the red: that green came from the test, and is TEST CHANGED.
    if (!input.provedByRed) {
      return { kind: 'done', result: 'unchecked' }
    }
    // A break that only stopped the test from loading (a bad import) proves no assertion can fail; the red message said
    // so, and the restore must not then say PROVEN (#132's break-and-restore door, found 2026-10-21).
    if (input.redErrorsOnly) {
      return { kind: 'done', result: { kind: 'unverified', reason: 'the red was an error, not a failed assertion: no assertion ran' } }
    }
    // #55: one break proves one behaviour. The pinned file gets the small changes a new file gets, in the worktree,
    // where the config allows a check at all. They add what else the pins miss; the verdict stays PROVEN either way.
    if (!input.checkable) {
      return { kind: 'done', result: { kind: 'proven', ...(lineEndingsOnly ? { lineEndings: true } : {}) } }
    }
    return { kind: 'pin', lineEndings: lineEndingsOnly }
  }
  if (change.kind === 'refactor') {
    return { kind: 'done', result: 'refactor' }
  }
  // Observe touches nothing on disk: a module the config only watches (observe mode, or outside the scope) is never reverted.
  if (!input.checkable) {
    return { kind: 'done', result: 'unchecked' }
  }
  if (change.before === null) {
    return change.beforeState === 'unreadable' ? { kind: 'done', result: { kind: 'unverified', reason: 'could not read the file before the edit' } } : { kind: 'new-file' }
  }
  return { kind: 'revert' }
}

// The runners whose check runs in a throwaway copy. The others are experimental: their check undoes the change on
// disk, so it runs only with "catchCheck": true. One list for the plugin and the pull-request check (#192).
const ISOLATED_RUNNERS: ReadonlySet<RunnerKind> = new Set<RunnerKind>(['vitest', 'jest', 'ava', 'node-test'])

export function isIsolatedRunner(kind: RunnerKind): boolean {
  return ISOLATED_RUNNERS.has(kind)
}
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
/** Why the throwaway copy (a git worktree) gave no outcome: the step that failed, with what it saw. */
export type WorktreeFailure = { readonly step: 'copy' | 'changes' | 'too-many' | 'unreadable' | 'not-green' | 'error'; readonly detail?: string }

/**
 * The reason a check in the throwaway copy is unverified, in words (#168). It used to say "see the log" for every
 * failure, while most of them wrote nothing to any log; now the step that failed is named in the reason itself.
 */
export function worktreeFailureReason(failure: WorktreeFailure): string {
  const left = 'so your file was left alone'
  switch (failure.step) {
    case 'copy':
      return `the throwaway copy could not be made (git worktree add failed), ${left}`
    case 'changes':
      return `the throwaway copy could not be made (git could not list your uncommitted changes), ${left}`
    case 'too-many':
      return `the throwaway copy could not be made (more than ${failure.detail ?? 'the limit of'} uncommitted files to copy), ${left}`
    case 'unreadable':
      return `the throwaway copy could not be made (${failure.detail ?? 'a changed file'} could not be read), ${left}`
    case 'not-green':
      // #168: a nested package whose Vite config resolves from the project folder ran red in the copy only.
      return `the test did not pass in the throwaway copy with your change in (${failure.detail ?? 'red'}), ${left}: a config that resolves paths from the project folder can run differently there`
    case 'error':
      return `the throwaway copy could not run the test (${failure.detail ?? 'an error'}), ${left}`
  }
}

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
  if (outcome !== 'fail') {
    return { kind: 'missed' }
  }
  // Idea 18: what the test said with the change undone, for the PROVEN line and the receipt.
  const message = failureMessage(output)
  return message === null ? { kind: 'caught' } : { kind: 'caught', message }
}

/**
 * #168: the folders from the root down to where the run happens, root left out, as `a`, `a/b`. The copy lives inside
 * `.git`, so a runner walking up from it reaches the root's node_modules but never a nested package's (an Astro site
 * in `site/`, with `site/node_modules` and a config that imports `astro`). Each of these whose node_modules exists is
 * linked into the copy at the same place.
 */
export function nestedPackageDirs(runInRelative: string): string[] {
  const parts = runInRelative.replace(/\\/g, '/').split('/').filter(part => part !== '' && part !== '.')
  return parts.map((_part, i) => parts.slice(0, i + 1).join('/'))
}

/** A directory junction on Windows (no admin rights needed), a symlink elsewhere: Node ignores the type off Windows. */
export function linkArgv(target: string, link: string): string[] {
  return ['node', '-e', "require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')", target, link]
}

/**
 * Removes a link made by linkArgv, never what it points at. unlinkSync takes the junction away and leaves its target
 * (checked by hand on Windows, 2026-10-26); on a real folder it throws, so it cannot delete one. A missing link is fine.
 */
export function unlinkArgv(link: string): string[] {
  return ['node', '-e', "try { require('node:fs').unlinkSync(process.argv[1]) } catch (error) { if (error.code !== 'ENOENT') throw error }", link]
}

export function timeBudgetMs(greenRunMs: number): number {
  return Math.min(2 * greenRunMs + 5_000, MAX_BUDGET_MS)
}
