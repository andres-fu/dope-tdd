import type { CatchOutcome, TddStats } from '../types'
import { formatAgo } from './timeText'

const REFACTOR = 'Now refactor with the test untouched.'

export function touchAdvice(module: string): string {
  return `red-first: ${module} unlocked. Run its test and see it fail before editing src/${module}.`
}

export function inheritedAdvice(module: string, testPath: string, ageMs: number): string {
  return `red-first: src/${module} is unlocked because ${testPath} was touched ${formatAgo(ageMs)} in an earlier session. Run that test first if you have not this session.`
}

export function hollowAdvice(testPath: string): string {
  return `red-first: ${testPath} has no assertion. A test that asserts nothing passes no matter what the code does.`
}

function greenAdvice(module: string, sawRed: boolean, check: Check | undefined, before: TddStats, after: TddStats): string | null {
  if (check === 'refactor') {
    return `red-first: GREEN on ${module}: the refactor kept the test green with the test untouched. Refactor credit.`
  }
  if (check?.kind === 'missed') {
    return `red-first: GREEN on ${module}, but its test does NOT catch the change: with your change undone it still passes. Fix the test before moving on.`
  }
  if (check?.kind === 'caught') {
    return sawRed
      ? `red-first: GREEN on ${module}, saw red, and its test catches the change. ${REFACTOR}`
      : `red-first: GREEN on ${module}, never saw red, but its test catches the change: with your change undone it fails. ${REFACTOR}`
  }
  if (check?.kind === 'unverified') {
    return `red-first: GREEN on ${module}, saw red. Could not verify that its test catches the change (${check.reason}). ${REFACTOR}`
  }
  if (check === undefined && after.cycles === before.cycles) {
    return null
  }
  return sawRed
    ? `red-first: GREEN on ${module}, saw red. ${REFACTOR}`
    : `red-first: GREEN on ${module} but it never saw red. Break the code on purpose and run again to prove the test can fail.`
}

export type Check = CatchOutcome | 'refactor'

export function runAdvice(before: TddStats, after: TddStats, check?: Check): string | null {
  const module = after.current?.module
  if (module === undefined) {
    return null
  }
  if (after.phase === 'red') {
    return `red-first: RED on ${module}. Make it pass with the smallest change, then run it again.`
  }
  return greenAdvice(module, before.sawRed, check, before, after)
}
