import type { CatchOutcome, TddStats } from '../types'
import { formatAgo } from './timeText'

const REFACTOR = 'Now refactor with the test untouched.'
const PROVE = 'Break the code on purpose and run again to prove the test can fail.'

export type Check = CatchOutcome | 'refactor'

export type RunContext = {
  /** Test files that failed when the current module's own test did not. */
  elsewhere?: readonly string[]
  /** The test was edited after this cycle's red and the code did not change. */
  testChanged?: boolean
  /** How messages name the module's source under the project's layout; `src/<module>` by default. */
  sourcePath?: string
}

function defaultSource(module: string): string {
  return `src/${module}`
}

function defaultTest(module: string): string {
  return `tests/${module}.test.ts(x)`
}

export function touchAdvice(module: string, sourcePath = defaultSource(module), command?: string): string {
  const run = command === undefined ? '' : ` Run it with: ${command}`
  return `dope-tdd: ${module} unlocked. Run its test and see it fail before editing ${sourcePath}.${run}`
}

export function inheritedAdvice(module: string, testPath: string, ageMs: number, sourcePath = defaultSource(module)): string {
  return `dope-tdd: ${sourcePath} is unlocked because ${testPath} was touched ${formatAgo(ageMs)} in an earlier session. Run that test first if you have not this session.`
}

export function redUnlockAdvice(module: string, sourcePath = defaultSource(module)): string {
  return `dope-tdd: ${module} unlocked by a red run of its own test. Fix ${sourcePath}, run again, and the fix will be checked.`
}

export function hollowTouchAdvice(testPath: string): string {
  return `dope-tdd: ${testPath} was re-saved unchanged. A touch that changes nothing proves nothing. Recorded; say why in your reply.`
}

export function hollowAdvice(testPath: string): string {
  return `dope-tdd: ${testPath} has no assertion. A test that asserts nothing passes no matter what the code does.`
}

export function unguardedAdvice(module: string, sourcePath = defaultSource(module), testPath = defaultTest(module)): string {
  return `dope-tdd: ${sourcePath} was edited with no test touched first. Write ${testPath} next and see it fail.`
}

export function unreadRunAdvice(truncated: boolean): string {
  const why = truncated ? ' (the result was truncated)' : ''
  return `dope-tdd: a test run happened but its summary line was not in the output${why}, so nothing was counted. Run the one test file, or pipe through tail -40, so the summary survives.`
}

export function configChangedAdvice(detail: string): string {
  return `dope-tdd: dope-tdd.json changed (${detail}). This is recorded in /tdd; say why in your reply.`
}

export function skippedAdvice(testPath: string, added: number): string {
  return `dope-tdd: ${testPath} gained ${added} skip/only marker${added === 1 ? '' : 's'}. A skipped test guards nothing. Recorded; say why in your reply.`
}

export function assertionsRemovedAdvice(testPath: string, before: number, after: number): string {
  return `dope-tdd: ${testPath} went from ${before} to ${after} assertion${after === 1 ? '' : 's'}. Recorded; say why in your reply.`
}

export function commentedOutAdvice(sourcePath: string, lines: number): string {
  return `dope-tdd: ${sourcePath}: ${lines} line${lines === 1 ? '' : 's'} of code commented out by this edit. Recorded; say why in your reply.`
}

function elsewhereAdvice(module: string, files: readonly string[], sawRed: boolean, sourcePath: string): string {
  const failed = `${files.join(', ')} failed; ${module}'s own test did not fail this run.`
  return sawRed
    ? `dope-tdd: RED, but not on ${module}: ${failed}`
    : `dope-tdd: RED, but not on ${module}: ${failed} ${module} has not seen red yet. Make its test fail before editing ${sourcePath}.`
}

function testChangedAdvice(module: string, sourcePath: string): string {
  return `dope-tdd: GREEN on ${module}, saw red, but the test changed after red and ${sourcePath} did not. The green came from the test, not from a fix. If the red was real, put the assertion back and fix the code.`
}

function slippedLines(slipped: readonly string[] | undefined): string {
  return slipped === undefined || slipped.length === 0
    ? ''
    : ` The change it did not notice:\n${slipped.map(line => `  ${line}`).join('\n')}\nAdd an assertion that fails without it.`
}

function missedAdvice(module: string, sawRed: boolean, slipped?: readonly string[]): string {
  return `${missedVerdict(module, sawRed)}${slippedLines(slipped)}`
}

function missedVerdict(module: string, sawRed: boolean): string {
  return sawRed
    ? `dope-tdd: GREEN on ${module}, but its test does NOT catch the change: with your change undone it still passes, so the test was changed to pass or the change did not matter. Fix the test before moving on.`
    : `dope-tdd: GREEN on ${module}. Its test has never failed, and it still passes with your change undone, so it has proven nothing yet. If the change was a fix, the test is missing an assertion for it; if it was a refactor, break the code on purpose and run again to prove the test.`
}

function greenAdvice(
  module: string,
  sawRed: boolean,
  check: Check | undefined,
  cycleCompleted: boolean,
  testChanged: boolean,
  sourcePath: string,
): string | null {
  if (check === 'refactor') {
    return `dope-tdd: GREEN on ${module} with the test untouched: a refactor, not re-checked. The test still guards only what it asserted before.`
  }
  if (check?.kind === 'missed') {
    return missedAdvice(module, sawRed, check.slipped)
  }
  if (check?.kind === 'caught') {
    return sawRed
      ? `dope-tdd: GREEN on ${module}, saw red, and its test catches the change. ${REFACTOR}`
      : `dope-tdd: GREEN on ${module}, never saw red, but its test catches the change: with your change undone it fails. ${REFACTOR}`
  }
  if (check?.kind === 'unverified') {
    return `dope-tdd: GREEN on ${module}${sawRed ? ', saw red' : ''}. Could not verify that its test catches the change (${check.reason}). ${REFACTOR}`
  }
  if (testChanged) {
    return testChangedAdvice(module, sourcePath)
  }
  if (!cycleCompleted) {
    return null
  }
  return sawRed
    ? `dope-tdd: GREEN on ${module}, saw red. ${REFACTOR}`
    : `dope-tdd: GREEN on ${module} but it never saw red. ${PROVE}`
}

export function runAdvice(before: TddStats, after: TddStats, check?: Check, context: RunContext = {}): string | null {
  const module = after.current?.module
  if (module === undefined) {
    return null
  }
  const sourcePath = context.sourcePath ?? defaultSource(module)
  if (context.elsewhere !== undefined && context.elsewhere.length > 0) {
    return elsewhereAdvice(module, context.elsewhere, before.sawRed, sourcePath)
  }
  if (after.phase === 'red') {
    return `dope-tdd: RED on ${module}. Make it pass with the smallest change, then run it again.`
  }
  return greenAdvice(module, before.sawRed, check, after.cycles > before.cycles, context.testChanged === true, sourcePath)
}
