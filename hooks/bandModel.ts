// What the band says, as plain data (#59; redesigned 2026-10-18). draw.tsx only paints it. The band answers, in order:
// is dope-tdd watching at all, what has the current module proven, and what is the one next step. Totals are not
// here: zeros read as "all good" when dope-tdd could see nothing, so only problems above zero are shown.
import type { TddStats } from '../types'
import { policyFor } from './config.ts'
import type { GuardConfig } from './config.ts'
import { isCodeFile } from './setup.ts'
import { stackOf } from './stacks.ts'

/** The fixed folder a layout template starts with: `tests/{module}.test.{ext}` lives under `tests/`. */
function fixedPrefix(template: string): string {
  return template.slice(0, Math.max(0, template.indexOf('{')))
}

/**
 * An edited file the layout classified as neither source nor test that dope-tdd should say it cannot guard: code of the
 * stack, not exempt, and not a helper inside the test folder (a test helper is tested through the tests that use it).
 */
export function countsAsUnwatched(relativePath: string, config: GuardConfig): boolean {
  const testFolder = fixedPrefix(config.layout.test)
  return (
    isCodeFile(relativePath, stackOf(config.stack)) &&
    policyFor(config, relativePath) !== 'exempt' &&
    !(testFolder !== '' && relativePath.startsWith(testFolder))
  )
}

export type Watch = { kind: 'watching'; where: string } | { kind: 'not-watching'; files: number; example: string } | { kind: 'cannot-read' }

export type StepName = 'test' | 'red' | 'green' | 'proven'
export type Step = { name: StepName; state: 'done' | 'open' | 'failed'; word?: string }
export type Problem = { label: string; tone: 'alarm' | 'warn' }
export type BandView = { watch: Watch; chain: Step[] | null; next: string; problems: Problem[] }

/** The part of the layout's source template before its first token: `hooks/{module}.{ext}` is watched in `hooks/`. */
function watchedPlace(config: Pick<GuardConfig, 'layout' | 'stack'>): string {
  const fixed = fixedPrefix(config.layout.source)
  return `${fixed === '' ? './' : fixed} · ${config.stack}`
}

function watchOf(s: TddStats, config: Pick<GuardConfig, 'layout' | 'stack'>): Watch {
  // Code edited that no layout pairs, and nothing guarded yet: the guard is looking somewhere else.
  if (s.unwatched.length > 0 && s.current === null) {
    return { kind: 'not-watching', files: s.unwatched.length, example: s.unwatched[0] ?? '' }
  }
  // Test runs happened and not one was read: no RED, no GREEN, no catch check can come of them.
  if (s.unreadRuns > 0 && s.passes + s.fails === 0) {
    return { kind: 'cannot-read' }
  }
  return { kind: 'watching', where: watchedPlace(config) }
}

function chainOf(s: TddStats): Step[] | null {
  const current = s.current
  if (current === null) {
    return null
  }
  const green = s.phase === 'green'
  const closedCycle = green && s.lastCycle?.module === current.module ? s.lastCycle : null
  const sawRed = (!green && s.sawRed) || closedCycle?.sawRed === true
  const neverSawRed = green && s.unproven.includes(current.module)
  const outcome = green && s.lastCatch?.module === current.module ? s.lastCatch.outcome : null
  const red: Step = sawRed ? { name: 'red', state: 'done' } : neverSawRed ? { name: 'red', state: 'failed', word: 'NEVER SAW RED' } : { name: 'red', state: 'open' }
  const proven: Step =
    outcome === null
      ? { name: 'proven', state: 'open' }
      : outcome.kind === 'caught' || outcome.kind === 'proven'
        ? { name: 'proven', state: 'done', word: outcome.kind.toUpperCase() }
        : outcome.kind === 'missed'
          ? { name: 'proven', state: 'failed', word: 'MISSED' }
          : { name: 'proven', state: 'open', word: outcome.kind.toUpperCase() }
  return [{ name: 'test', state: 'done' }, red, { name: 'green', state: green ? 'done' : 'open' }, proven]
}

function nextOf(s: TddStats, watch: Watch): string {
  if (watch.kind === 'not-watching') {
    return 'run /tdd setup, or add a layout to dope-tdd.json'
  }
  if (watch.kind === 'cannot-read') {
    return 'run one test file, so its summary line reaches the output'
  }
  if (s.paused) {
    return 'resume the guard when you are done'
  }
  const current = s.current
  if (current === null) {
    return 'write a failing test first'
  }
  if (s.phase === 'writing') {
    return 'run the test and see it fail'
  }
  if (s.phase === 'red') {
    return 'make it pass with the smallest change'
  }
  if (s.phase !== 'green') {
    return 'run the test'
  }
  const outcome = s.lastCatch?.module === current.module ? s.lastCatch.outcome : null
  if (outcome?.kind === 'missed') {
    const line = outcome.slipped?.[0]
    return line === undefined ? 'add an assertion that fails without your change' : `add an assertion that fails without:  ${line}`
  }
  if (outcome?.kind === 'unverified' || s.unproven.includes(current.module)) {
    return 'prove it by hand: break the code, see red, put it back'
  }
  return 'refactor while the test guards it, then commit'
}

function problemsOf(s: TddStats, config: Pick<GuardConfig, 'mode' | 'scope'>, watch: Watch): Problem[] {
  const counted: [number, string, Problem['tone']][] = [
    [s.missed, 'MISSED', 'alarm'],
    [s.neverSawRed, 'NEVER SAW RED', 'warn'],
    [s.testChanged, 'TEST CHANGED', 'warn'],
    [s.workarounds, 'WORKAROUNDS', 'warn'],
    [s.unguarded, 'UNGUARDED', 'warn'],
    [s.blocked, 'BLOCKED', 'warn'],
    // Unwatched edits are the alarm itself when nothing else is watched; beside watched work they are one count.
    [watch.kind === 'not-watching' ? 0 : s.unwatched.length, 'UNWATCHED', 'warn'],
  ]
  const problems = counted.filter(([count]) => count > 0).map(([count, label, tone]) => ({ label: `${count} ${label}`, tone }))
  const scoped = config.scope.length > 0
  return config.mode !== 'enforce' || scoped
    ? [...problems, { label: `MODE ${config.mode.toUpperCase()}${scoped ? ' (SCOPED)' : ''}`, tone: 'warn' }]
    : problems
}

export function bandView(s: TddStats, config: Pick<GuardConfig, 'layout' | 'stack' | 'mode' | 'scope'>): BandView {
  const watch = watchOf(s, config)
  return { watch, chain: chainOf(s), next: nextOf(s, watch), problems: problemsOf(s, config, watch) }
}
