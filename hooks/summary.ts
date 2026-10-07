import type { TddStats } from '../types'
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

export function formatStatus(s: TddStats, nowMs: number): string {
  return [
    'red-first',
    `guard: ${s.paused ? 'PAUSED' : 'ON'}`,
    phaseLine(s, nowMs),
    `module: ${s.current?.module ?? 'none'}`,
    `runs: ${s.passes + s.fails} (${s.passes} pass, ${s.fails} fail)`,
    cycleLine(s),
    `test-first: ${s.testFirst}/${s.testFirst + s.blocked + s.unguarded} · unguarded ${s.unguarded} · blocked ${s.blocked}`,
    'recent events:',
    ...eventLines(s, nowMs),
  ].join('\n')
}
