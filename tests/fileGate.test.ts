import { describe, expect, test } from 'claude-code/testing'

import { gateWrite } from '../hooks/fileGate'
import type { GateInput } from '../hooks/fileGate'

// #59, third slice: the verdict on an Edit or Write before it happens, out of register.tsx (2026-10-18).
const source = (over: Partial<GateInput> = {}): GateInput => ({
  relativePath: 'hooks/runPlan.ts',
  isConfig: false,
  kind: 'source',
  policy: 'enforce',
  unlocked: false,
  inherited: false,
  paused: false,
  covering: null,
  unwatchedCode: false,
  ...over,
})

describe('gateWrite', () => {
  test('the override record is only dope-tdd’s to write, whatever else is true', () => {
    expect(gateWrite(source({ relativePath: 'dope-tdd.overrides.json', kind: 'other', policy: null }))).toEqual({ kind: 'deny-record' })
    expect(gateWrite(source({ relativePath: 'dope-tdd.overrides.json', paused: true, policy: 'exempt' }))).toEqual({ kind: 'deny-record' })
  })

  test('an exempt file goes through untouched by the guard', () => {
    expect(gateWrite(source({ policy: 'exempt' }))).toEqual({ kind: 'exempt' })
  })

  test('untested source under enforce is blocked', () => {
    expect(gateWrite(source())).toEqual({ kind: 'blocked' })
  })

  test('an override that covers it lets it through and is spent on it', () => {
    expect(gateWrite(source({ covering: { id: 'o1' } }))).toEqual({ kind: 'go', locked: true, spend: 'o1', unwatched: false })
  })

  test('a paused guard lets it through, still locked, so the edit is counted as unguarded', () => {
    expect(gateWrite(source({ paused: true }))).toEqual({ kind: 'go', locked: true, spend: null, unwatched: false })
  })

  test('warn and observe let it through, locked', () => {
    expect(gateWrite(source({ policy: 'warn' }))).toEqual({ kind: 'go', locked: true, spend: null, unwatched: false })
    expect(gateWrite(source({ policy: 'observe' }))).toEqual({ kind: 'go', locked: true, spend: null, unwatched: false })
  })

  test('unlocked only by a carry-over from an earlier session: wait for one run of its test', () => {
    expect(gateWrite(source({ unlocked: true, inherited: true }))).toEqual({ kind: 'carry-wait' })
  })

  test('a carry-over does not wait when paused or under warn', () => {
    expect(gateWrite(source({ unlocked: true, inherited: true, paused: true }))).toEqual({ kind: 'go', locked: false, spend: null, unwatched: false })
    expect(gateWrite(source({ unlocked: true, inherited: true, policy: 'warn' }))).toEqual({ kind: 'go', locked: false, spend: null, unwatched: false })
  })

  test('unlocked source goes', () => {
    expect(gateWrite(source({ unlocked: true }))).toEqual({ kind: 'go', locked: false, spend: null, unwatched: false })
  })

  test('a test file goes', () => {
    expect(gateWrite(source({ kind: 'test', relativePath: 'tests/runPlan.test.ts', policy: null }))).toEqual({ kind: 'go', locked: false, spend: null, unwatched: false })
  })

  test('code no layout pairs goes, and is remembered as unwatched; the config file never is', () => {
    expect(gateWrite(source({ kind: 'other', relativePath: 'scripts/build.ts', policy: null, unwatchedCode: true }))).toEqual({
      kind: 'go',
      locked: false,
      spend: null,
      unwatched: true,
    })
    expect(gateWrite(source({ kind: 'other', relativePath: 'dope-tdd.json', isConfig: true, policy: null, unwatchedCode: true }))).toEqual({
      kind: 'go',
      locked: false,
      spend: null,
      unwatched: false,
    })
  })
})
