// What the band says, as plain data (#59; redesigned 2026-10-18). draw.tsx only paints it. The band answers, in order:
// is dope-tdd watching at all, what has the current module proven, and what is the one next step. Totals are not
// here: zeros read as "all good" when dope-tdd could see nothing, so only problems above zero are shown.
import type { Override, TddStats } from '../types'
import { policyFor } from './config.ts'
import type { GuardConfig } from './config.ts'
import { moduleLabel } from './mirror.ts'
import { deciderLabel, overrideLeft } from './overrides.ts'
import type { SavedState } from './gitChanges.ts'
import { UNNAMED_FAILURE } from './runPlan.ts'
import { isCodeFile } from './setup.ts'
import { stackOf } from './stacks.ts'
import { RED_TIMER_ALARM_MS } from './theme.ts'
import { formatAgo, formatSpan } from './timeText.ts'

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

// The chain had a `test` step that was always done and nothing read (2026-10-18): band v3 draws red and green only.
export type StepName = 'red' | 'green' | 'proven'
export type Step = { name: StepName; state: 'done' | 'open' | 'failed'; word?: string }
/** A word on the band and how it reads: pass (green), ember (red, MISSED), alarm (red too long), warn (amber), dim, plain. */
export type Token = { text: string; tone: 'pass' | 'ember' | 'alarm' | 'warn' | 'dim' | 'plain' }
/** The guard when it is not simply enforcing: one amber word and what it means; null while it enforces. */
export type Guard = { word: string; detail: string } | null
/** `showProgress`: the phase and the run trail belong to a module; with none current, or nothing watched, they mislead. */
/** `pending`: an override waiting for a person. `overridden`: the current module's open module override. */
export type BandView = {
  watch: Watch
  showProgress: boolean
  chain: Step[] | null
  next: string
  guard: Guard
  /** The red and green steps, as words. */
  tokens: Token[]
  /** What the green is worth: PROVEN, CHANGED, MISSED or UNPROVEN with the reason; null before a green. */
  verdict: Token | null
  /** The current module as the developer names it, or null. */
  module: string | null
  /** Nothing to say yet: the band shows a one-line introduction instead of vanishing. */
  idle: boolean
  pending: Override | null
  overridden: Override | null
  /** Every override that still lets something through, whichever module is current: an open door has a sign on it. */
  open: { target: string; text: string }[]
  /** The last test run in words, or null before any: which test, how it went, whose it was, when (2026-10-18). */
  lastRun: string | null
  /** The test file a click on the last run opens, as recorded (maybe relative); null keeps the line plain text. */
  lastRunOpens: string | null
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
  // The code changed since the green: neither the green nor what proved it is about this code any more (2026-10-18).
  if (green && changedSinceGreen(s, current.module)) {
    return [red, { name: 'green', state: 'open', word: 'CHANGED' }, { name: 'proven', state: 'open' }]
  }
  return [red, { name: 'green', state: green ? 'done' : 'open' }, proven]
}

function changedSinceGreen(s: TddStats, module: string): boolean {
  return s.modules[module]?.editedSinceRun === true
}

/** Whether a module's work is committed or pushed, as git last said. */
export type Saved = { module: string; state: SavedState }

function nextOf(s: TddStats, watch: Watch, pending: Override | null, open: readonly { target: string }[], saved: Saved | null): string {
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
  const door = open[0]
  if (current === null && door !== undefined) {
    return `use it or end it: /tdd override end ${door.target}`
  }
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
  if (s.checking?.module === current.module) {
    return 'wait a moment: dope-tdd is undoing the change to check the test catches it'
  }
  if (changedSinceGreen(s, current.module)) {
    return 'run the test: the code changed since it went green'
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
  // Read from git after each tool call while green, so a pushed PR stops being told to commit (2026-10-19).
  const where = saved?.module === current.module ? saved.state : 'uncommitted'
  return where === 'pushed'
    ? 'committed and pushed · write the next failing test'
    : where === 'committed'
      ? 'committed · push it, or refactor while the test guards it'
      : 'refactor while the test guards it, then commit'
}

// Band v3 (2026-10-18), from the principal UX and engineering reviews. Counts (BLOCKED, WORKAROUNDS, UNWATCHED) left
// the band for /tdd: a refusal is the guard working, and a count reads as blame. What stays says something specific.

/**
 * One word for a guard that is not simply enforcing, with what it means and the fix; null while it enforces and
 * watches, because silence is the signal. The first that applies wins.
 */
function guardOf(s: TddStats, config: Pick<GuardConfig, 'mode'>, watch: Watch, record: readonly Override[], nowMs: number, standingDown: string): Guard {
  // First: while a guard is throwing, nothing else the band says is true (verified review A13).
  if (s.guardFailures > 0) {
    const calls = `${s.guardFailures} call${s.guardFailures === 1 ? '' : 's'}`
    return { word: 'GUARD FAILING', detail: `${calls} went through unguarded after an internal error · see the log` }
  }
  if (standingDown !== '') {
    return { word: 'STANDING DOWN', detail: `git ${standingDown} in progress · back when it ends` }
  }
  if (s.paused) {
    const pause = record.find(o => o.status === 'approved' && o.scope === 'pause' && o.endedAtMs === null)
    const left = pause === undefined ? null : overrideLeft(pause, nowMs)
    return { word: 'PAUSED', detail: left === null ? '/tdd resume' : `resumes by itself in ${left.replace(/ left$/, '')} · /tdd resume` }
  }
  if (watch.kind === 'not-watching') {
    const files = `${watch.files} edited code file${watch.files === 1 ? ' matches' : 's match'}`
    return { word: 'NOT WATCHING', detail: `${files} no test layout: ${watch.example}${watch.files > 1 ? ` +${watch.files - 1}` : ''} · fix: /tdd setup` }
  }
  if (watch.kind === 'cannot-read') {
    const runs = `${s.unreadRuns} run${s.unreadRuns === 1 ? '' : 's'}`
    return { word: "CAN'T READ RUNS", detail: `${runs}, none with a summary line · fix: run one test file, without piping it` }
  }
  if (config.mode === 'warn') {
    return { word: 'WARN ONLY', detail: 'untested edits go through, with a warning' }
  }
  if (config.mode === 'observe') {
    return { word: 'OBSERVING', detail: 'nothing is refused; dope-tdd only records' }
  }
  return null
}

/** The red and green steps as words: what the chain says, plus how long RED has been open. */
function tokensOf(s: TddStats, chain: Step[] | null, nowMs: number): Token[] {
  if (chain === null) {
    return []
  }
  const red = chain.find(step => step.name === 'red')
  const green = chain.find(step => step.name === 'green')
  const openMs = s.cycleStartMs === null ? null : nowMs - s.cycleStartMs
  const redToken: Token =
    s.phase === 'red'
      ? { text: openMs === null ? 'RED' : `RED ${formatSpan(openMs)}`, tone: openMs !== null && openMs >= RED_TIMER_ALARM_MS ? 'alarm' : 'ember' }
      : red?.state === 'done'
        ? { text: 'red ✓', tone: 'pass' }
        : red?.state === 'failed'
          ? { text: 'red ✗', tone: 'warn' }
          : { text: 'red ·', tone: 'dim' }
  // A green the code has since changed was still a green: the verdict says CHANGED.
  const greenToken: Token = green?.state === 'done' || green?.word === 'CHANGED' ? { text: 'green ✓', tone: 'pass' } : { text: 'green ·', tone: 'dim' }
  return [redToken, greenToken]
}

/** The one word that says what the green is worth, or null before a green. MISSED is the strongest warning. */
function verdictOf(s: TddStats): Token | null {
  const current = s.current
  if (current === null || s.phase !== 'green') {
    return null
  }
  if (s.checking?.module === current.module) {
    return { text: 'proving…', tone: 'dim' }
  }
  if (changedSinceGreen(s, current.module)) {
    return { text: 'CHANGED', tone: 'warn' }
  }
  if (s.lastCycle?.module === current.module && s.lastCycle.pinCorrected === true) {
    // Pin corrected (2026-10-18): the expected fix while pinning, but the pin has proven nothing until a break.
    return { text: 'UNPROVEN · pin corrected: prove it with a break', tone: 'warn' }
  }
  if (s.lastCycle?.module === current.module && s.lastCycle.testChanged) {
    return { text: "UNPROVEN · the test changed, the code didn't", tone: 'warn' }
  }
  const outcome = s.lastCatch?.module === current.module ? s.lastCatch.outcome : null
  if (outcome?.kind === 'missed') {
    // The band adds what MISSED means: it is the strongest warning, and the only verdict with no second word.
    return { text: 'MISSED · passes without your change', tone: 'ember' }
  }
  if (outcome !== null) {
    return { text: catchWord(outcome), tone: outcome.kind === 'unverified' ? 'warn' : outcome.kind === 'refactor' ? 'plain' : 'pass' }
  }
  return s.unproven.includes(current.module) ? { text: 'UNPROVEN · never failed', tone: 'warn' } : null
}

/**
 * A catch check's outcome in the one vocabulary (2026-10-18), for the band, /tdd, and the model reviewer's facts.
 * CAUGHT (dope-tdd undid the change) and PROVEN (you broke the code on purpose) are the same fact to a reader.
 */
export function catchWord(outcome: NonNullable<TddStats['lastCatch']>['outcome']): string {
  switch (outcome.kind) {
    case 'caught':
    case 'proven':
      return 'PROVEN'
    case 'missed':
      return 'MISSED'
    case 'unverified':
      return `UNPROVEN · not checked: ${outcome.reason}`
    default:
      return 'refactor · not re-checked'
  }
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

/**
 * The last run in words, in place of a trail of ● and ✗ that said nothing a person could act on (2026-10-18): the test,
 * how it went, and whose it was when it was not the current module's. Read from the stored record, never from event
 * text, so a run that could not be read is the last run too.
 */
/** The last run in words: the band shows it, and a refusal quotes it (refusals.ts), so both read one fact. */
export function lastRunLine(s: TddStats, nowMs: number): string | null {
  const last = s.lastRun
  if (last === null) {
    return null
  }
  const ago = formatAgo(nowMs - last.atMs).toLowerCase()
  if (last.outcome === 'unread') {
    return `last run: not read · the output had no summary line · ${ago}`
  }
  if (last.outcome === 'elsewhere') {
    const files = last.files
    const first = files[0]
    if (first === undefined || first === UNNAMED_FAILURE) {
      return `last run: failed, the output did not say where · not this module · ${ago}`
    }
    return `last run: ${fileName(first)}${files.length > 1 ? ` +${files.length - 1}` : ''} failed · not this module · ${ago}`
  }
  const module = last.module
  const testPath = module === null ? undefined : s.unlocked[module]
  const name = testPath !== undefined ? fileName(testPath) : module !== null ? `${module} test` : 'the tests'
  const whose = module !== null && s.current !== null && module !== s.current.module ? ' · another module' : ''
  return `last run: ${name} ${last.outcome === 'pass' ? 'passed' : 'failed'}${whose} · ${ago}`
}

/**
 * The test file the last run was (2026-10-18), so "last run" on the band opens it: a pass or a fail opens the test of
 * the module it belonged to, a failure elsewhere the first file that failed. An unread run, a failure the output did
 * not place, or a module with no known test has nothing to open, and the line stays plain.
 */
export function lastRunTarget(s: TddStats): string | null {
  const last = s.lastRun
  if (last === null || last.outcome === 'unread') {
    return null
  }
  if (last.outcome === 'elsewhere') {
    const first = last.files[0]
    return first === undefined || first === UNNAMED_FAILURE ? null : first
  }
  return last.module === null ? null : (s.unlocked[last.module] ?? null)
}

/** `session`: this session's id, so another session's override is marked as theirs (overrides.ts, coveringOverride). */
export function bandView(
  s: TddStats,
  config: Pick<GuardConfig, 'layout' | 'layouts' | 'roots' | 'stack' | 'mode' | 'scope'>,
  record: readonly Override[] = [],
  nowMs = 0,
  session?: string,
  /** The git operation the guard stands down for, or ''. */
  standingDown = '',
  saved: Saved | null = null,
): BandView {
  const watch = watchOf(s, config)
  const showProgress = watch.kind === 'watching' && s.current !== null
  const pending = record.find(o => o.status === 'pending') ?? null
  const module = s.current?.module
  const overridden = record.find(o => o.status === 'approved' && o.endedAtMs === null && o.scope === 'module' && o.module === module) ?? null
  const open = record.flatMap(o => {
    const left = overrideLeft(o, nowMs)
    const theirs = o.session !== undefined && session !== undefined && o.session !== session ? " · another session's" : ''
    return left === null ? [] : [{ target: o.module ?? 'pause', text: `${o.module ?? 'every module'} · ${o.kind} · ${left} · approved by ${deciderLabel(o)}${theirs}` }]
  })
  const chain = chainOf(s)
  const guard = guardOf(s, config, watch, record, nowMs, standingDown)
  const lastRun = lastRunLine(s, nowMs)
  return {
    watch,
    showProgress,
    chain,
    next: nextOf(s, watch, pending, open, saved),
    pending,
    overridden,
    open,
    lastRun,
    lastRunOpens: lastRunTarget(s),
    guard,
    tokens: tokensOf(s, chain, nowMs),
    verdict: verdictOf(s),
    module: s.current === null ? null : moduleLabel(config, s.current.module),
    idle: s.current === null && guard === null && pending === null && open.length === 0 && lastRun === null,
  }
}
