// node --test tools/pr-check/check.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findMoves } from '../move-check/move.ts'
import { isFailing, movedRow, notCheckedBecause, report } from './check.ts'
import { DEFAULT_CONFIG } from '../../hooks/config.ts'

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

// #192: the check read dope-tdd.json only in part. It ignored mode, scope and catchCheck, so it ran experimental
// runners in place whatever the config said. It now decides as the plugin does.
test('a module in observe, by mode or outside scope, is not checked, as the plugin runs no catch check there', () => {
  assert.match(notCheckedBecause({ ...DEFAULT_CONFIG, mode: 'observe' }, 'observe', 'vitest') ?? '', /observe/)
  assert.match(notCheckedBecause({ ...DEFAULT_CONFIG, scope: ['src/billing/**'] }, 'observe', 'vitest') ?? '', /scope/)
})

test('"catchCheck": false turns the check off', () => {
  assert.match(notCheckedBecause({ ...DEFAULT_CONFIG, catchCheck: false }, 'enforce', 'vitest') ?? '', /"catchCheck": false/)
})

test('an experimental runner is checked only with "catchCheck": true, in the plugin\'s words', () => {
  assert.match(notCheckedBecause(DEFAULT_CONFIG, 'enforce', 'pytest') ?? '', /pytest is experimental, so its check would undo your change on disk; "catchCheck": true in dope-tdd\.json allows it/)
  assert.equal(notCheckedBecause({ ...DEFAULT_CONFIG, catchCheck: true }, 'enforce', 'pytest'), null)
  assert.equal(notCheckedBecause(DEFAULT_CONFIG, 'enforce', 'vitest'), null)
  assert.equal(notCheckedBecause(DEFAULT_CONFIG, 'warn', 'vitest'), null)
})

test('a MISSED fails the check only where the module is enforced; under warn it is reported, not failed', () => {
  const missed = { module: 'a', source: 'a.ts', test: 'a.test.ts', verdict: 'MISSED', note: '' } as const
  assert.equal(isFailing([{ ...missed, policy: 'enforce' }], 'missed'), true)
  assert.equal(isFailing([{ ...missed, policy: 'warn' }], 'missed'), false)
  assert.equal(isFailing([{ ...missed, policy: 'enforce' }], 'never'), false)
  const untested = { module: 'b', source: 'b.ts', test: null, verdict: 'UNTESTED', note: '', policy: 'enforce' } as const
  assert.equal(isFailing([untested], 'missed'), false)
  assert.equal(isFailing([untested], 'untested'), true)
  assert.equal(isFailing([{ ...untested, policy: 'warn' }], 'untested'), false)
})
