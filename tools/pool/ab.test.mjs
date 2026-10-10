// node --test tools/pool/ab.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MIN_CLAUDE_CODE, readReceipt, versionAtLeast } from './ab.mjs'

test('a Claude Code older than the mods minimum is refused; the minimum and newer pass', () => {
  assert.equal(versionAtLeast('2.1.12 (Claude Code)', MIN_CLAUDE_CODE), false)
  assert.equal(versionAtLeast('2.1.286 (Claude Code)', MIN_CLAUDE_CODE), false)
  assert.equal(versionAtLeast('2.1.287 (Claude Code)', MIN_CLAUDE_CODE), true)
  assert.equal(versionAtLeast('2.1.292 (Claude Code)', MIN_CLAUDE_CODE), true)
  assert.equal(versionAtLeast('3.0.0 (Claude Code)', MIN_CLAUDE_CODE), true)
  assert.equal(versionAtLeast('not a version', MIN_CLAUDE_CODE), false)
})

test('the receipt block and its counts are read from an agent reply', () => {
  const reply = 'Done.\n\n## RECORD\n```\ndope-tdd\nguard: ON\ntest-first: 1/1 · unguarded 0 · blocked 0\ncatch check: caught 1 · proven 0 · missed 0 · unverified 0\n```\nAll good.'
  const receipt = readReceipt(reply)
  assert.equal(receipt.testFirst, '1/1')
  assert.equal(receipt.caught, 1)
  assert.equal(receipt.blocked, 0)
  assert.equal(readReceipt('no receipt here').block, null)
})
