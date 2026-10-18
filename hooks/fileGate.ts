// The verdict on an Edit or Write before it happens (#59, third slice, 2026-10-18): out of register.tsx, so the gate's
// own catch check covers it. register.tsx gathers the facts (the file's kind and policy, the guard's state, the
// override that covers it), acts on the verdict, and does the writing and the bookkeeping.
import type { Policy } from './config.ts'
import { OVERRIDES_FILE } from './overrides.ts'

export type GateInput = {
  /** The written file, relative to the project root. */
  relativePath: string
  isConfig: boolean
  kind: 'source' | 'test' | 'other'
  /** The source file's policy; null for anything that is not source. */
  policy: Policy | null
  /** The module has a test on record. */
  unlocked: boolean
  /** ...but only through a carry-over from an earlier session, not yet run this session (#54). */
  inherited: boolean
  paused: boolean
  /** This session's approved override that covers the module, if any (overrides.ts, coveringOverride). */
  covering: { id: string } | null
  /** Code the layout pairs with no test (bandModel.ts, countsAsUnwatched). */
  unwatchedCode: boolean
}

export type GateVerdict =
  | { kind: 'deny-record' }
  | { kind: 'exempt' }
  | { kind: 'blocked' }
  | { kind: 'carry-wait' }
  /** `locked`: untested source let through (paused, warn, observe, or an override); `spend`: the override it uses. */
  | { kind: 'go'; locked: boolean; spend: string | null; unwatched: boolean }

export function gateWrite(input: GateInput): GateVerdict {
  // The record is evidence of who approved what: only dope-tdd writes it, whatever the mode.
  if (input.relativePath === OVERRIDES_FILE) {
    return { kind: 'deny-record' }
  }
  if (input.policy === 'exempt') {
    return { kind: 'exempt' }
  }
  const unwatched = input.kind === 'other' && !input.isConfig && input.unwatchedCode
  const locked = input.kind === 'source' && !input.unlocked
  const enforced = input.policy === 'enforce'
  if (locked && enforced && input.covering === null && !input.paused) {
    return { kind: 'blocked' }
  }
  // #54: unlocked only by a carry-over; enforce waits for one run of its test this session, warn reminds after.
  if (input.kind === 'source' && !locked && input.inherited && enforced && !input.paused) {
    return { kind: 'carry-wait' }
  }
  return { kind: 'go', locked, spend: locked && enforced && input.covering !== null ? input.covering.id : null, unwatched }
}
