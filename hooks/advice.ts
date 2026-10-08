import type { TddStats } from '../types'

export function touchAdvice(module: string): string {
  return `red-first: ${module} unlocked. Run its test and see it fail before editing src/${module}.`
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
