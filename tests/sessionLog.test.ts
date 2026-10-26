import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import { changedRecords, sealRecord, sessionRecord, verifyRecord } from '../hooks/sessionLog'
import { FRESH_MODULE, INITIAL_STATS } from '../hooks/stats'

// Integrity of the session log (2026-10-26: could an agent or a person game this?). Only dope-tdd writes these files,
// and only when a session ends, so an existing record that changed while a shell command ran was edited by it.
describe('changedRecords', () => {
  const entry = (name: string, size: number, mtimeMs: number) => ({ name, size, mtimeMs })

  test('an existing record whose size or time changed is named', () => {
    const before = [entry('2026-10-26-a.json', 100, 1), entry('2026-10-26-b.json', 100, 1)]
    const after = [entry('2026-10-26-a.json', 120, 1), entry('2026-10-26-b.json', 100, 9)]
    expect(changedRecords(before, after)).toEqual(['2026-10-26-a.json', '2026-10-26-b.json'])
  })

  test('a new record (another session ending) or a removed one (the 30-day cleanup) is not', () => {
    const before = [entry('2026-09-01-old.json', 100, 1)]
    const after = [entry('2026-10-26-new.json', 100, 5)]
    expect(changedRecords(before, after)).toEqual([])
    expect(changedRecords([entry('a.json', 1, 1)], [entry('a.json', 1, 1)])).toEqual([])
  })
})

// A digest shows a hand edit to a record. It is not a seal against an agent that reads this code: without a secret
// the agent cannot also read, nothing local is. The pull-request check in CI is what an agent cannot write.
describe('sealRecord and verifyRecord', () => {
  const record = { sessionId: 'sess-1', proven: 2, receipt: 'proven 2' }

  test('a sealed record verifies; the same record with a number changed does not', () => {
    const text = JSON.stringify(sealRecord(record), null, 2)
    expect(verifyRecord(text)).toBe('sealed')
    expect(verifyRecord(text.replace('"proven": 2', '"proven": 9'))).toBe('edited')
  })

  test('a record from before digests is unsealed; text that is not a record is edited', () => {
    expect(verifyRecord(JSON.stringify(record))).toBe('unsealed')
    expect(verifyRecord('not json')).toBe('edited')
  })

  // A change to the hash would make every record written before it read as edited: the algorithm is pinned.
  test('the digest of a known record is fixed', () => {
    expect(sealRecord({ sessionId: 'sess-1', proven: 2 }).digest).toBe('cyrb53:11b8454f6bbe21')
  })

  test('the digest does not depend on key order or spacing', () => {
    const sealed = sealRecord(record)
    const reordered = { receipt: sealed.receipt, digest: sealed.digest, proven: sealed.proven, sessionId: sealed.sessionId }
    expect(verifyRecord(JSON.stringify(reordered))).toBe('sealed')
  })
})

// Idea 15, and the observability rule: what a session left red is a field a dashboard can query.
describe('sessionRecord', () => {
  test('lists the modules left red, with their failing tests', () => {
    const s = { ...INITIAL_STATS, modules: { 'utils/a': { ...FRESH_MODULE, phase: 'red' as const, redFailures: ['x'] }, 'utils/b': { ...FRESH_MODULE, phase: 'green' as const } } }
    const endedAtMs = Date.UTC(2026, 9, 26)
    const record = sessionRecord(s, DEFAULT_CONFIG, { sessionId: 'sess-1', reason: 'other', root: 'C:/work/x', endedAtMs, gitDir: null }, '')
    expect(record.leftRed).toEqual([{ module: 'utils/a', failing: ['x'], atMs: endedAtMs }])
  })
})

describe('sessionRecord spikes', () => {
  test('lists the spikes', () => {
    const s = { ...INITIAL_STATS, spikes: [{ atMs: 1, question: 'q' }] }
    const record = sessionRecord(s, DEFAULT_CONFIG, { sessionId: 'sess-1', reason: 'other', root: 'C:/work/x', endedAtMs: 2, gitDir: null }, '')
    expect(record.spikes).toEqual([{ atMs: 1, question: 'q' }])
  })
})
