// node --test tools/pool/scorecard.test.mjs
// The scorecard's arithmetic, on records whose answers are known.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeScorecard, renderScorecard } from './scorecard.mjs'

const ledger = [
  { id: 'a', mode: 'observe', costUsd: 0.2, turns: 10, durationMs: 20_000, blocked: 0, workarounds: 0, caught: null, proven: null },
  { id: 'a', mode: 'enforce', costUsd: 0.22, turns: 11, durationMs: 30_000, blocked: 1, workarounds: 0, caught: 1, proven: 0, missed: 0, unguarded: 0 },
  { id: 'b', mode: 'observe', costUsd: 0.4, turns: 12, durationMs: 40_000 },
  { id: 'b', mode: 'enforce', costUsd: 0.36, turns: 12, durationMs: 40_000, blocked: 0, workarounds: 1, caught: 0, proven: 0, missed: 1, unguarded: 0 },
  { id: 'c', mode: 'enforce', costUsd: 0.5, turns: 20, durationMs: 60_000, blocked: 0, workarounds: 0, caught: 0, proven: 1, missed: 0, unguarded: 2 },
]

test('the main goal counts guarded runs that ended with proof, and names the ones that did not', () => {
  const card = computeScorecard({ ledger })
  assert.equal(card.goal.guardedRuns, 3)
  assert.equal(card.goal.proved, 2)
  assert.deepEqual(card.goal.unprovedIds, ['b/enforce'])
})

test('overhead is the median ratio over A/B pairs only; a guarded run with no pair is left out', () => {
  const card = computeScorecard({ ledger })
  assert.equal(card.overhead.pairs, 2)
  assert.deepEqual(card.overhead.pairIds, ['a', 'b'])
  // cost ratios 1.1 and 0.9 → median 1.0; turns 1.1 and 1.0 → 1.05; time 1.5 and 1.0 → 1.25
  assert.ok(Math.abs(card.overhead.cost - 1.0) < 1e-9)
  assert.ok(Math.abs(card.overhead.turns - 1.05) < 1e-9)
  assert.ok(Math.abs(card.overhead.time - 1.25) < 1e-9)
})

test('refusals, workarounds and proof gaps add up over guarded runs only', () => {
  const card = computeScorecard({ ledger })
  assert.deepEqual(card.refusals, { runs: 3, total: 1, max: 1 })
  assert.deepEqual(card.workarounds, { runs: 3, total: 1 })
  assert.deepEqual(card.proofGaps, { missed: 1, unguarded: 2 })
  assert.ok(Math.abs(card.cost.total - 1.68) < 1e-9)
})

test('what is not measured says so, instead of a number', () => {
  const card = computeScorecard({})
  const text = renderScorecard(card, { at: 'now', files: [] })
  assert.equal(card.goal.share, null)
  assert.match(text, /no hand-checked runs yet/)
  assert.match(text, /not measured automatically yet/)
  assert.match(text, /0 of 0 \(n\/a\)/)
})

test('hand-checked verdicts count the wrong ones by id', () => {
  const card = computeScorecard({ checks: [{ id: 'a', correct: true }, { id: 'b', correct: false }] })
  assert.deepEqual(card.wrongVerdicts, { checked: 2, wrong: 1, wrongIds: ['b'] })
})
