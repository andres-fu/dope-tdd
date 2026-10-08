import type { TddStats } from '../types'
import { formatAgo } from './timeText'

export function touchAdvice(module: string): string {
  return `red-first: ${module} unlocked. Run its test and see it fail before editing src/${module}.`
}

export function inheritedAdvice(module: string, testPath: string, ageMs: number): string {
  return `red-first: src/${module} is unlocked because ${testPath} was touched ${formatAgo(ageMs)} in an earlier session. Run that test first if you have not this session.`
}

export function hollowAdvice(testPath: string): string {
  return `red-first: ${testPath} has no assertion. A test that asserts nothing passes no matter what the code does.`
}

export function runAdvice(before: TddStats, after: TddStats): string | null {
  const module = after.current?.module
  if (module === undefined) {
    return null
  }
  if (after.phase === 'red') {
    return `red-first: RED on ${module}. Make it pass with the smallest change, then run it again.`
  }
  if (after.cycles === before.cycles) {
    return null
  }
  return after.neverSawRed > before.neverSawRed
    ? `red-first: GREEN on ${module} but it never saw red. Break the code on purpose and run again to prove the test can fail.`
    : `red-first: GREEN on ${module}, saw red. Now refactor with the test untouched.`
}
