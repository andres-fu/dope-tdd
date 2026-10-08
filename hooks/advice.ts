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
}

export function touchAdvice(module: string): string {
  return `dope-tdd: ${module} unlocked. Run its test and see it fail before editing src/${module}.`
}

export function inheritedAdvice(module: string, testPath: string, ageMs: number): string {
  return `dope-tdd: src/${module} is unlocked because ${testPath} was touched ${formatAgo(ageMs)} in an earlier session. Run that test first if you have not this session.`
}

export function hollowAdvice(testPath: string): string {
  return `dope-tdd: ${testPath} has no assertion. A test that asserts nothing passes no matter what the code does.`
}

export function unguardedAdvice(module: string): string {
  return `dope-tdd: src/${module} was edited with no test touched first. Write tests/${module}.test.ts(x) next and see it fail.`
}

export function unreadRunAdvice(truncated: boolean): string {
  const why = truncated ? ' (the result was truncated)' : ''
  return `dope-tdd: a test run happened but its summary line was not in the output${why}, so nothing was counted. Run the one test file, or pipe through tail -40, so the summary survives.`
}

export function configChangedAdvice(detail: string): string {
  return `dope-tdd: dope-tdd.json changed (${detail}). This is recorded in /tdd; say why in your reply.`
}

function elsewhereAdvice(module: string, files: readonly string[], sawRed: boolean): string {
  const failed = `${files.join(', ')} failed; ${module}'s own test did not fail this run.`
  return sawRed
    ? `dope-tdd: RED, but not on ${module}: ${failed}`
    : `dope-tdd: RED, but not on ${module}: ${failed} ${module} has not seen red yet. Make its test fail before editing src/${module}.`
}

function testChangedAdvice(module: string): string {
  return `dope-tdd: GREEN on ${module}, saw red, but the test changed after red and src/${module} did not. The green came from the test, not from a fix. If the red was real, put the assertion back and fix the code.`
}

function missedAdvice(module: string, sawRed: boolean): string {
  return sawRed
    ? `dope-tdd: GREEN on ${module}, but its test does NOT catch the change: with your change undone it still passes, so the test was changed to pass or the change did not matter. Fix the test before moving on.`
    : `dope-tdd: GREEN on ${module}. Its test has never failed, and it still passes with your change undone, so it has proven nothing yet. If the change was a fix, the test is missing an assertion for it; if it was a refactor, break the code on purpose and run again to prove the test.`
}

function greenAdvice(module: string, sawRed: boolean, check: Check | undefined, cycleCompleted: boolean, testChanged: boolean): string | null {
  if (check === 'refactor') {
    return `dope-tdd: GREEN on ${module} with the test untouched: a refactor, not re-checked. The test still guards only what it asserted before.`
  }
  if (check?.kind === 'missed') {
    return missedAdvice(module, sawRed)
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
    return testChangedAdvice(module)
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
  if (context.elsewhere !== undefined && context.elsewhere.length > 0) {
    return elsewhereAdvice(module, context.elsewhere, before.sawRed)
  }
  if (after.phase === 'red') {
    return `dope-tdd: RED on ${module}. Make it pass with the smallest change, then run it again.`
  }
  return greenAdvice(module, before.sawRed, check, after.cycles > before.cycles, context.testChanged === true)
}
