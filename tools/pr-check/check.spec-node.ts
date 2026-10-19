// node --test tools/pr-check/check.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findMoves } from '../move-check/move.ts'
import { movedRow, report } from './check.ts'

test('the report counts each verdict and lists every module with its reason', () => {
  const text = report(
    [
      { module: 'memory/liststore', source: 'a.py', test: 'tests/test_a.py', verdict: 'PROVEN', note: 'the test fails without the change' },
      { module: 'utils/b', source: 'b.ts', test: null, verdict: 'UNTESTED', note: 'no test' },
    ],
    'origin/main (2526e8c)',
  )
  assert.match(text, /1 proven · 0 missed · 0 moved · 1 untested · 0 not checked, against origin\/main \(2526e8c\)\./)
  assert.match(text, /\| memory\/liststore \| tests\/test_a\.py \| \*\*PROVEN\*\* \|/)
  assert.match(text, /\| utils\/b \| — \| \*\*UNTESTED\*\* \|/)
})

// One verdict vocabulary (2026-10-18): the pull-request check says what the plugin says. CAUGHT is PROVEN, and a
// check that could not tell is UNPROVEN · not checked, with the reason.
test('the report speaks the plugin\'s words, and the legend explains them', () => {
  const text = report([{ module: 'utils/c', source: 'c.ts', test: 'tests/c.test.ts', verdict: 'UNPROVEN', note: 'not checked: no test runner found' }], 'main')
  assert.match(text, /0 proven · 0 missed · 0 moved · 0 untested · 1 not checked, against main\./)
  assert.match(text, /\| utils\/c \| tests\/c\.test\.ts \| \*\*UNPROVEN\*\* \| not checked: no test runner found \|/)
  assert.match(text, /PROVEN: with the base version of the source put back, the test fails/)
  assert.match(text, /UNPROVEN: the check could not tell; the reason is given\./)
  assert.doesNotMatch(text, /CAUGHT|UNVERIFIED|caught|unverified/)
})

test('a pull request that touches no guarded source says so', () => {
  assert.match(report([], 'main'), /No source file in this pull request is one the project guards\./)
})

test('a new file whose code all moved from another file, unchanged, is MOVED; the new code in it is named (#40)', () => {
  const base = { 'index.js': 'function ping(cfg) { return fetch(cfg.url) }\nfunction swap(n) { return lavalinkNodes[n] }\nfunction keep() {}' }
  const head = {
    'index.js': "const { ping } = require('./pool')\nfunction keep() {}",
    'pool.js': 'function createPool({ nodes }) {\n  function ping(cfg) { return fetch(cfg.url) }\n  function swap(n) { return nodes[n] }\n  return { ping, swap }\n}',
  }
  assert.deepEqual(movedRow(findMoves(base, head), 'pool.js', head['pool.js']), {
    verdict: 'MOVED',
    note: 'moved from index.js: `ping` identical, `swap` renamed (`lavalinkNodes` → `nodes`); new here, not checked: `createPool`',
  })
})

test('a new file with moved code that differs keeps its verdict, and the note says where it differs (#40)', () => {
  const base = { 'index.js': 'function ping(cfg) { return fetch(cfg.url, 5000) }' }
  const head = { 'index.js': '', 'pool.js': 'function ping(cfg) { return fetch(cfg.url, 8000) }' }
  assert.deepEqual(movedRow(findMoves(base, head), 'pool.js', head['pool.js']), {
    note: 'moved code differs: `ping` before: `, 5000 ) }` · after: `, 8000 ) }`',
  })
})

test('a new file that nothing moved into is left as it was (#40)', () => {
  assert.equal(movedRow(findMoves({ 'a.js': 'function f() {}' }, { 'a.js': 'function f() {}', 'b.js': 'function g() {}' }), 'b.js', 'function g() {}'), null)
})

test('MOVED is counted and explained in the report, and never fails the check (#40)', () => {
  const text = report([{ module: 'pool', source: 'pool.js', test: null, verdict: 'MOVED', note: 'moved from index.js: `ping` identical' }], 'main')
  assert.match(text, /0 proven · 0 missed · 1 moved · 0 untested · 0 not checked, against main\./)
  assert.match(text, /\| pool \| — \| \*\*MOVED\*\* \| moved from index\.js: `ping` identical \|/)
  assert.match(text, /MOVED: a new file whose code came from another file unchanged/)
})

test('two new files in one pull request each list only the code that moved into them (#40)', () => {
  const base = { 'index.js': 'function ping() { return 1 }\nfunction play() { return 2 }' }
  const head = { 'index.js': '', 'pool.js': 'function ping() { return 1 }', 'player.js': 'function play() { return 2 }' }
  const moves = findMoves(base, head)
  assert.deepEqual(movedRow(moves, 'pool.js', head['pool.js']), { verdict: 'MOVED', note: 'moved from index.js: `ping` identical' })
  assert.deepEqual(movedRow(moves, 'player.js', head['player.js']), { verdict: 'MOVED', note: 'moved from index.js: `play` identical' })
})

test('a file that already existed and received moved code is never MOVED: its own change is still checked, and the move is a note (#1)', () => {
  const base = { 'a.js': 'function f() { return 1 }', 'b.js': 'function g() { return 2 }' }
  const head = { 'a.js': 'function f() { return 3 }\nfunction g() { return 2 }', 'b.js': '' }
  assert.deepEqual(movedRow(findMoves(base, head), 'a.js', head['a.js'], false), {
    note: 'also received moved code from b.js: `g` identical',
  })
})
