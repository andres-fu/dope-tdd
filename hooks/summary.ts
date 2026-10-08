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
    'red-first',
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
