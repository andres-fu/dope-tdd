import { UNLOCK_TTL_MS, storeRoot } from './unlocks.ts'
import type { TddStats } from '../types'

/**
 * Left red on purpose (idea 15, Theory of Developer Momentum, 2026-10-26). A module still red when a session ends is
 * a stop, not a loss: the next session's briefing leads with it, so the agent starts where the last one stopped
 * instead of finding it again. `failing` is the stuck failure line when there is one, else the failing test names.
 */
export type LeftRed = { module: string; failing: string[]; atMs: number }

/** As long as an unlock carries over: a red older than that is someone else's week, not a stop to pick up. */
export const LEFT_RED_TTL_MS = UNLOCK_TTL_MS

export function leftRedKey(root: string): string {
  return `left-red:${storeRoot(root)}`
}

/** The modules this session leaves red, as of `nowMs`. */
export function redModules(s: TddStats, nowMs: number): LeftRed[] {
  return Object.entries(s.modules)
    .filter(([, state]) => state.phase === 'red')
    .map(([module, state]) => ({
      module,
      failing: s.sameRed?.module === module ? [s.sameRed.failure] : [...(state.redFailures ?? [])],
      atMs: nowMs,
    }))
}

/**
 * What the store keeps once this session ends. An earlier stop this session never touched stays: a short session on
 * other work must not erase it. One it worked on is replaced by what this session found, red again or gone.
 */
export function leftRedAtEnd(previous: readonly LeftRed[], s: TddStats, nowMs: number): LeftRed[] {
  return [...previous.filter(entry => s.modules[entry.module] === undefined), ...redModules(s, nowMs)]
}

function isLeftRed(value: unknown): value is LeftRed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LeftRed).module === 'string' &&
    typeof (value as LeftRed).atMs === 'number' &&
    Array.isArray((value as LeftRed).failing) &&
    (value as LeftRed).failing.every(name => typeof name === 'string')
  )
}

export function freshLeftRed(stored: unknown, nowMs: number): LeftRed[] {
  return Array.isArray(stored) ? stored.filter(isLeftRed).filter(entry => nowMs - entry.atMs <= LEFT_RED_TTL_MS) : []
}

/** The briefing line: the module, the failing test, the next step. */
export function leftRedNote(entries: readonly LeftRed[]): string | null {
  if (entries.length === 0) {
    return null
  }
  const named = entries.map(entry => (entry.failing.length === 0 ? entry.module : `${entry.module} (failing: ${entry.failing.map(name => `\`${name}\``).join(', ')})`))
  return `Left red when an earlier session ended: ${named.join('; ')}. Start there: run its test, then make it pass or say why it stays red.`
}
