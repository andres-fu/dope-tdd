import type { TddStats } from '../types'
import { describeConfig } from './config'
import type { GuardConfig } from './config'
import { formatAgo, formatSpan } from './timeText'

const RECENT_EVENTS = 10

function cycleLine(s: TddStats): string {
  if (s.cycles === 0) {
    return 'cycles: 0'
  }
  return `cycles: ${s.cycles} (avg ${formatSpan(s.cycleMsTotal / s.cycles)}, never saw red ${s.neverSawRed})`
}

function phaseLine(s: TddStats, nowMs: number): string {
  const open = s.cycleStartMs === null ? '' : ` for ${formatSpan(nowMs - s.cycleStartMs)}`
  return `phase: ${s.phase.toUpperCase()}${open}`
}

function eventLines(s: TddStats, nowMs: number): string[] {
  if (s.events.length === 0) {
    return ['  no events yet']
  }
  return s.events
    .slice(-RECENT_EVENTS)
    .reverse()
    .map(e => `  ${formatAgo(nowMs - e.atMs).padEnd(9)} ${e.kind.padEnd(10)} ${e.module ?? ''}`.trimEnd())
}

function catchLine(s: TddStats): string[] {
  return s.caught + s.missed + s.unverified + s.refactors === 0
    ? []
    : [`catch check: caught ${s.caught} · missed ${s.missed} · unverified ${s.unverified} · refactors ${s.refactors}`]
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
    `runs: ${s.passes + s.fails} (${s.passes} pass, ${s.fails} fail)`,
    cycleLine(s),
    `test-first: ${s.testFirst}/${s.testFirst + s.blocked + s.unguarded} · unguarded ${s.unguarded} · blocked ${s.blocked}`,
    ...catchLine(s),
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
    '  GREEN          the last run passed',
    '  SAW RED        this cycle\'s test failed before the code made it pass, so it can catch something',
    '  NEVER SAW RED  the test went green without ever failing; it has proven nothing yet',
    '  CAUGHT         with the change undone, the test fails: it guards this change',
    '  MISSED         with the change undone, the test still passes: it does not guard this change',
    '  UNVERIFIED     the catch check could not run; /tdd has the reason',
    '  REFACTOR       code changed while green with the test untouched: a safe refactor',
    '  UNGUARDED      a source file changed with no test touched first',
    '  BLOCKED        an edit was refused until the test is written',
    '  PAUSED         the guard is off; edits are not counted',
    '  MODE           enforce denies, warn tells, observe only records (dope-tdd.json)',
  ].join('\n')
}
