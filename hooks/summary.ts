import type { TddStats } from '../types'
import { describeConfig } from './config.ts'
import type { GuardConfig } from './config.ts'
import { moduleLabel } from './mirror.ts'
import { otherOpenModules } from './stats.ts'
import { formatAgo, formatSpan } from './timeText.ts'
import { WORKAROUND_KINDS } from './workarounds.ts'

const WORKAROUND_WORDS: Readonly<Record<string, string>> = {
  config: 'config loosened',
  pause: 'paused',
  'test-changed': 'test changed',
  skipped: 'skipped',
  'assertion-removed': 'assertions removed',
  'commented-out': 'commented out',
  'hollow-touch': 'touched unchanged',
  'record-edited': 'override record edited',
}

const RECENT_EVENTS = 10

function cycleLine(s: TddStats): string {
  if (s.cycles === 0) {
    return 'cycles: 0'
  }
  const testChanged = s.testChanged === 0 ? '' : `, test changed ${s.testChanged}`
  return `cycles: ${s.cycles} (avg ${formatSpan(s.cycleMsTotal / s.cycles)}, never saw red ${s.neverSawRed}${testChanged})`
}

function runsLine(s: TddStats): string {
  const unread = s.unreadRuns === 0 ? '' : `, ${s.unreadRuns} unread`
  return `runs: ${s.passes + s.fails} (${s.passes} pass, ${s.fails} fail${unread})`
}

function phaseLine(s: TddStats, nowMs: number): string {
  const open = s.cycleStartMs === null ? '' : ` for ${formatSpan(nowMs - s.cycleStartMs)}`
  const elsewhere = s.redElsewhere.length === 0 ? '' : ` (red elsewhere: ${s.redElsewhere.join(', ')})`
  return `phase: ${s.phase.toUpperCase()}${open}${elsewhere}`
}

/** Other modules with a cycle still open: a red or a test waiting somewhere the band is not looking. */
function openLine(s: TddStats, label: Label): string[] {
  const others = otherOpenModules(s)
  return others.length === 0 ? [] : [`also open: ${others.map(({ module, phase }) => `${label(module)} (${phase})`).join(', ')}`]
}

// "when: what" rows under a header row: the app shows /tdd as a table of "key: value" rows (2026-10-18).
function eventLines(s: TddStats, nowMs: number, label: Label): string[] {
  if (s.events.length === 0) {
    return ['recent events: none yet']
  }
  const rows = s.events
    .slice(-RECENT_EVENTS)
    .reverse()
    .map(e => {
      const what = [e.module === undefined ? '' : label(e.module), e.detail === undefined ? '' : `(${e.detail})`].filter(part => part !== '').join(' ')
      return `${formatAgo(nowMs - e.atMs)}: ${e.kind} ${what}`.trimEnd()
    })
  return ['recent events: newest first', ...rows]
}

function catchLine(s: TddStats): string[] {
  const verdicts =
    s.caught + s.proven + s.missed + s.unverified === 0
      ? []
      : [`catch check: caught ${s.caught} · proven ${s.proven} · missed ${s.missed} · unverified ${s.unverified}`]
  // A refactor is a fact about the change, not a verdict on the test, so it never sits beside caught and proven.
  const refactors = s.refactors === 0 ? [] : [`refactors: ${s.refactors} (changed while green with the test untouched; not re-checked)`]
  return [...verdicts, ...refactors]
}

function workaroundLine(s: TddStats): string[] {
  if (s.workarounds === 0) {
    return []
  }
  const parts = WORKAROUND_KINDS.filter(kind => (s.workaroundsBy[kind] ?? 0) > 0).map(kind => `${WORKAROUND_WORDS[kind]} ${s.workaroundsBy[kind]}`)
  return [`workarounds: ${s.workarounds} (${parts.join(', ')})`]
}

function inheritedLine(s: TddStats, nowMs: number, label: Label): string[] {
  const entries = Object.entries(s.inherited)
  if (entries.length === 0) {
    return []
  }
  return [`unlocked earlier: ${entries.map(([module, atMs]) => `${label(module)} (${formatAgo(nowMs - atMs)})`).join(', ')}`]
}

type Label = (module: string) => string

/** `build`: which dope-tdd is running (build.ts), the first row; the app already names the plugin. */
export function formatStatus(s: TddStats, nowMs: number, config?: GuardConfig, build?: string): string {
  const label: Label = module => (config === undefined ? module : moduleLabel(config, module))
  return [
    build ?? 'dope-tdd',
    `guard: ${s.paused ? 'PAUSED' : 'ON'}`,
    ...(config === undefined ? [] : describeConfig(config)),
    phaseLine(s, nowMs),
    `module: ${s.current === null ? 'none' : label(s.current.module)}`,
    ...openLine(s, label),
    runsLine(s),
    cycleLine(s),
    `test-first: ${s.testFirst}/${s.testFirst + s.blocked + s.unguarded} · unguarded ${s.unguarded} · blocked ${s.blocked}`,
    ...catchLine(s),
    ...workaroundLine(s),
    ...inheritedLine(s, nowMs, label),
    ...eventLines(s, nowMs, label),
  ].join('\n')
}

export function formatGlossary(): string {
  return [
    'dope-tdd: what the words mean',
    '  WATCHING       the edited code matches the layout and the test runs can be read: dope-tdd is guarding it',
    '  NOT WATCHING   code was edited that no test layout pairs, and nothing is guarded yet: /tdd setup, or a layout in dope-tdd.json',
    "  CAN'T READ RUNS test runs happened and none could be read: run one test file so its summary line is in the output",
    '  UNWATCHED      code files edited outside the layout, beside guarded work: dope-tdd cannot check them',
    '  NEXT           the one step to take now',
    '  WRITING        a test was created or edited and has not run yet',
    '  RED            the last run of that test failed: the bug or the missing behaviour is reproduced',
    '  RED ELSEWHERE  the last run failed in other test files, not in this module\'s test',
    '  GREEN          the last run passed',
    '  SAW RED        this cycle\'s test failed before the code made it pass, so it can catch something',
    '  NEVER SAW RED  the test went green without ever failing; it has proven nothing yet',
    '  TEST CHANGED   the test was edited after red and the code was not; the green came from the test',
    '  CAUGHT         with the change undone, the test fails: it guards this change',
    '  PROVEN         the code was broken on purpose, the test went red, and the code is back as it was: the red was the check',
    '  MISSED         with the change undone, the test still passes: it does not guard this change',
    '  UNVERIFIED     the catch check could not run; /tdd has the reason',
    '  REFACTOR       code changed while green with the test untouched; not re-checked',
    '  UNGUARDED      a source file changed with no test touched first',
    '  WORKAROUNDS    ways around the guard, each on the record: config loosened, pause, test changed after red, skip/only added, assertion removed, code commented out, a test re-saved unchanged',
    '  BLOCKED        an edit was refused until the test is written',
    '  PAUSED         /tdd pause <minutes> <reason>: edits are not counted until it ends by itself, or /tdd resume; they stay debt',
    '  OVERRIDE REQUESTED the agent asked to pass the guard and waits: /tdd approve, or /tdd deny <why>',
    '  OVERRIDE OPEN  an approved override that still lets edits through: what is left and who approved it; END closes it',
    '  OVERRIDES OPEN overrides not yet ended, and hotfixes or paused edits with no test yet: debt on the receipt',
    '  GIT REBASE     a git rebase, merge, cherry-pick, revert, am or bisect is in progress: the guard stands down until it ends',
    '  MODE           enforce denies, warn tells, observe only records (dope-tdd.json)',
    "  DOPE           Deny, Observe, Prove, Evidence. Motto: don't overdub, prove every bar",
  ].join('\n')
}
