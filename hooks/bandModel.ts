// What the band says, as plain data (#59; redesigned 2026-10-18). draw.tsx only paints it. The band answers, in order:
// is dope-tdd watching at all, what has the current module proven, and what is the one next step. Totals are not
// here: zeros read as "all good" when dope-tdd could see nothing, so only problems above zero are shown.
import type { Override, TddStats } from '../types'
import { policyFor } from './config.ts'
import type { GuardConfig } from './config.ts'
import { openDebt } from './overrides.ts'
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
/** `showProgress`: the phase and the run trail belong to a module; with none current, or nothing watched, they mislead. */
/** `pending`: an override waiting for a person. `overridden`: the current module's open module override. */
export type BandView = {
  watch: Watch
  showProgress: boolean
  chain: Step[] | null
  next: string
  problems: Problem[]
  pending: Override | null
  overridden: Override | null
}

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
  const outcome = green && s.lastCatch?.module === current.module ? s.lastCatch.outcome : null
  // A CAUGHT or PROVEN catch check ran the test without the change and saw it fail: that is the red, seen by dope-tdd
  // instead of by hand. Skipping red still counts in /tdd and on the receipt; the band just stops asking for it.
  const caught = outcome?.kind === 'caught' || outcome?.kind === 'proven'
  const neverSawRed = green && s.unproven.includes(current.module)
  const red: Step = sawRed
    ? { name: 'red', state: 'done' }
    : neverSawRed && caught
      ? { name: 'red', state: 'done', word: 'BY CATCH' }
      : neverSawRed
        ? { name: 'red', state: 'failed', word: 'NEVER SAW RED' }
        : { name: 'red', state: 'open' }
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

function nextOf(s: TddStats, watch: Watch, pending: Override | null): string {
  if (watch.kind === 'not-watching') {
    return 'run /tdd setup, or add a layout to dope-tdd.json'
  }
  if (watch.kind === 'cannot-read') {
    return 'run one test file, so its summary line reaches the output'
  }
  // The agent stopped for this: nothing moves until a person decides.
  if (pending !== null) {
    return 'approve or deny the override request: /tdd approve, or /tdd deny <why>'
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
  const caught = outcome?.kind === 'caught' || outcome?.kind === 'proven'
  if (outcome?.kind === 'unverified' || (!caught && s.unproven.includes(current.module))) {
    return 'prove it by hand: break the code, see red, put it back'
  }
  return 'refactor while the test guards it, then commit'
}

// Events that close a cycle rather than belong to the next one: a pass and the verdicts that follow it.
const CLOSING: ReadonlySet<string> = new Set(['pass', 'caught', 'proven', 'missed', 'unverified', 'refactor', 'carried-on'])
const WORKAROUND_KINDS: ReadonlySet<string> = new Set(['skipped', 'assertion-removed', 'commented-out', 'hollow-touch'])

/**
 * Every event during the current module's current cycle, whichever module it touched: from the module's previous pass
 * on, including the events that closed the cycle when it has just closed. An unguarded edit made now shows now, and a
 * cycle's problems stay on the band until the next cycle opens, and no longer.
 */
function cycleEvents(s: TddStats): TddStats['events'] {
  const module = s.current?.module
  if (module === undefined) {
    return []
  }
  const own = s.events.flatMap((event, index) => (event.module === module ? [{ event, index }] : []))
  let end = own.length
  while (end > 0 && CLOSING.has(own[end - 1]?.event.kind ?? '')) {
    end -= 1
  }
  let start = end
  while (start > 0 && own[start - 1]?.event.kind !== 'pass') {
    start -= 1
  }
  const from = start === 0 ? 0 : (own[start - 1]?.index ?? -1) + 1
  return s.events.slice(from)
}

function problemsOf(s: TddStats, config: Pick<GuardConfig, 'mode' | 'scope'>, watch: Watch, record: readonly Override[]): Problem[] {
  // The current cycle's problems only: session totals never clear, and a warning that never clears stops being read.
  // MISSED and NEVER SAW RED are already in the chain; the session's totals are in /tdd and on the receipt.
  const events = cycleEvents(s)
  const count = (kinds: ReadonlySet<string>) => events.filter(event => kinds.has(event.kind)).length
  const counted: [number, string, Problem['tone']][] = [
    [count(new Set(['test-changed'])), 'TEST CHANGED', 'warn'],
    [count(WORKAROUND_KINDS), 'WORKAROUNDS', 'warn'],
    [count(new Set(['unguarded'])), 'UNGUARDED', 'warn'],
    [count(new Set(['blocked'])), 'BLOCKED', 'warn'],
    // Unwatched edits are the alarm itself when nothing else is watched; beside watched work they are one count.
    [watch.kind === 'not-watching' ? 0 : s.unwatched.length, 'UNWATCHED', 'warn'],
  ]
  const problems = counted.filter(([count]) => count > 0).map(([count, label, tone]) => ({ label: `${count} ${label}`, tone }))
  // Overrides are not per cycle: an open one, or its debt, stays on the band until a person ends it.
  const open = openDebt(record).length
  if (open > 0) {
    problems.push({ label: `${open} ${open === 1 ? 'OVERRIDE' : 'OVERRIDES'} OPEN`, tone: 'warn' })
  }
  const scoped = config.scope.length > 0
  return config.mode !== 'enforce' || scoped
    ? [...problems, { label: `MODE ${config.mode.toUpperCase()}${scoped ? ' (SCOPED)' : ''}`, tone: 'warn' }]
    : problems
}

export function bandView(s: TddStats, config: Pick<GuardConfig, 'layout' | 'stack' | 'mode' | 'scope'>, record: readonly Override[] = []): BandView {
  const watch = watchOf(s, config)
  const showProgress = watch.kind === 'watching' && s.current !== null
  const pending = record.find(o => o.status === 'pending') ?? null
  const module = s.current?.module
  const overridden = record.find(o => o.status === 'approved' && o.endedAtMs === null && o.scope === 'module' && o.module === module) ?? null
  return { watch, showProgress, chain: chainOf(s), next: nextOf(s, watch, pending), problems: problemsOf(s, config, watch, record), pending, overridden }
}
