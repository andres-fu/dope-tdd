import type { TddStats } from '../types'
import { describeConfig } from './config'
import type { GuardConfig } from './config'
import { otherOpenModules } from './stats'
import { formatAgo, formatSpan } from './timeText'
import { WORKAROUND_KINDS } from './workarounds'

const WORKAROUND_WORDS: Readonly<Record<string, string>> = {
  config: 'config loosened',
  pause: 'paused',
  'test-changed': 'test changed',
  skipped: 'skipped',
  'assertion-removed': 'assertions removed',
  'commented-out': 'commented out',
  'hollow-touch': 'touched unchanged',
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
function openLine(s: TddStats): string[] {
  const others = otherOpenModules(s)
  return others.length === 0 ? [] : [`also open: ${others.map(({ module, phase }) => `${module} (${phase})`).join(', ')}`]
}

function eventLines(s: TddStats, nowMs: number): string[] {
  if (s.events.length === 0) {
    return ['  no events yet']
  }
  return s.events
    .slice(-RECENT_EVENTS)
    .reverse()
    .map(e => {
      const what = [e.module ?? '', e.detail === undefined ? '' : `(${e.detail})`].filter(part => part !== '').join(' ')
      return `  ${formatAgo(nowMs - e.atMs).padEnd(9)} ${e.kind.padEnd(12)} ${what}`.trimEnd()
    })
}

function catchLine(s: TddStats): string[] {
  return s.caught + s.missed + s.unverified + s.refactors === 0
    ? []
    : [`catch check: caught ${s.caught} · missed ${s.missed} · unverified ${s.unverified} · refactors ${s.refactors}`]
}

function workaroundLine(s: TddStats): string[] {
  if (s.workarounds === 0) {
    return []
  }
  const parts = WORKAROUND_KINDS.filter(kind => (s.workaroundsBy[kind] ?? 0) > 0).map(kind => `${WORKAROUND_WORDS[kind]} ${s.workaroundsBy[kind]}`)
  return [`workarounds: ${s.workarounds} (${parts.join(', ')})`]
}

function inheritedLine(s: TddStats, nowMs: number): string[] {
  const entries = Object.entries(s.inherited)
  if (entries.length === 0) {
    return []
  }
  return [`unlocked earlier: ${entries.map(([module, atMs]) => `${module} (${formatAgo(nowMs - atMs)})`).join(', ')}`]
}

export function formatStatus(s: TddStats, nowMs: number, config?: GuardConfig): string {
  return [
    'dope-tdd',
    `guard: ${s.paused ? 'PAUSED' : 'ON'}`,
    ...(config === undefined ? [] : describeConfig(config)),
    phaseLine(s, nowMs),
    `module: ${s.current?.module ?? 'none'}`,
    ...openLine(s),
    runsLine(s),
    cycleLine(s),
    `test-first: ${s.testFirst}/${s.testFirst + s.blocked + s.unguarded} · unguarded ${s.unguarded} · blocked ${s.blocked}`,
    ...catchLine(s),
    ...workaroundLine(s),
    ...inheritedLine(s, nowMs),
    'recent events:',
    ...eventLines(s, nowMs),
  ].join('\n')
}

export function formatGlossary(): string {
  return [
    'dope-tdd: what the words mean',
    '  WRITING        a test was created or edited and has not run yet',
    '  RED            the last run of that test failed: the bug or the missing behaviour is reproduced',
    '  RED ELSEWHERE  the last run failed in other test files, not in this module\'s test',
    '  GREEN          the last run passed',
    '  SAW RED        this cycle\'s test failed before the code made it pass, so it can catch something',
    '  NEVER SAW RED  the test went green without ever failing; it has proven nothing yet',
    '  TEST CHANGED   the test was edited after red and the code was not; the green came from the test',
    '  CAUGHT         with the change undone, the test fails: it guards this change',
    '  MISSED         with the change undone, the test still passes: it does not guard this change',
    '  UNVERIFIED     the catch check could not run; /tdd has the reason',
    '  REFACTOR       code changed while green with the test untouched; not re-checked',
    '  UNGUARDED      a source file changed with no test touched first',
    '  WORKAROUNDS    ways around the guard, each on the record: config loosened, pause, test changed after red, skip/only added, assertion removed, code commented out, a test re-saved unchanged',
    '  BLOCKED        an edit was refused until the test is written',
    '  PAUSED         the guard is off; edits are not counted',
    '  MODE           enforce denies, warn tells, observe only records (dope-tdd.json)',
    "  DOPE           Deny, Observe, Prove, Evidence. Motto: don't overdub, prove every bar",
  ].join('\n')
}
