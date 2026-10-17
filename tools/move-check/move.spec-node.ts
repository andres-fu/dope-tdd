// npx tsx --test tools/move-check/move.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compare, declarations, findMoves, report, tokenize, tokensInLines } from './move'

const texts = (source: string) => tokenize(source).map(token => token.text)

test('tokens skip whitespace and comments, and keep strings, templates and regexes whole', () => {
  assert.deepEqual(texts('const a = 1 // one\n/* two */ let b'), ['const', 'a', '=', '1', 'let', 'b'])
  assert.deepEqual(texts("f('a // not a comment', \"b { c\")"), ['f', '(', "'a // not a comment'", ',', '"b { c"', ')'])
  assert.deepEqual(texts('`x ${ { y: `}` }.y } z`'), ['`x ${ { y: `}` }.y } z`'])
  assert.deepEqual(texts('const r = /a\\/b{/g; x = a / b / c'), ['const', 'r', '=', '/a\\/b{/g', ';', 'x', '=', 'a', '/', 'b', '/', 'c'])
  assert.deepEqual(texts('a === b ?? c?.d => ...e'), ['a', '===', 'b', '??', 'c', '?.', 'd', '=>', '...', 'e'])
})

test('top-level declarations, with their lines; nested ones are part of their parent', () => {
  const source = [
    "const fs = require('fs')",
    'function a(x) {',
    '  function inner() { return "}" }',
    '  return inner()',
    '}',
    'async function b() { await a(1) }',
    'export const c = (n) => {',
    '  return n + 1',
    '}',
    'class D { m() { return 1 } }',
    'module.exports = { a, b }',
  ].join('\n')
  const found = declarations(source)
  assert.deepEqual(
    found.map(({ name, startLine, endLine }) => [name, startLine, endLine]),
    [
      ['fs', 1, 1],
      ['a', 2, 5],
      ['b', 6, 6],
      ['c', 7, 9],
      ['D', 10, 10],
    ],
  )
})

test('the same code with other spacing and comments is IDENTICAL', () => {
  const result = compare(tokenize('function a(x) {\n  return x + 1 // add\n}'), tokenize('function a(x){ return x+1 }'))
  assert.deepEqual(result, { verdict: 'IDENTICAL', renames: [] })
})

test('names changed consistently are RENAMED, and the renames are listed for the reviewer', () => {
  const before = 'function swap(cfg) { lavalinkNodes.push(cfg); sendWebhookAlert(cfg.name); return lavalinkNodes }'
  const after = 'function swap(cfg) { nodes.push(cfg); alert(cfg.name); return nodes }'
  assert.deepEqual(compare(tokenize(before), tokenize(after)), {
    verdict: 'RENAMED',
    renames: [
      { from: 'lavalinkNodes', to: 'nodes' },
      { from: 'sendWebhookAlert', to: 'alert' },
    ],
  })
})

test('a rename that is not one to one, a changed keyword, string or number, or a different shape DIFFERS', () => {
  const differs = (a: string, b: string) => compare(tokenize(a), tokenize(b)).verdict
  assert.equal(differs('f(a); g(a)', 'f(b); g(c)'), 'DIFFERS')
  assert.equal(differs('f(a); g(b)', 'f(c); g(c)'), 'DIFFERS')
  assert.equal(differs('const x = 1', 'let x = 1'), 'DIFFERS')
  assert.equal(differs("log('a')", "log('b')"), 'DIFFERS')
  assert.equal(differs('if (n > 0.2) go()', 'if (n > 0.5) go()'), 'DIFFERS')
  assert.equal(differs('if (a === b) go()', 'if (a >= b) go()'), 'DIFFERS')
  assert.equal(differs('ping(cfg)', 'ping(cfg, { fetch })'), 'DIFFERS')
})

test('a difference is shown in context, from the first token that differs', () => {
  const result = compare(tokenize('function a() { if (ok) return 1; return 2 }'), tokenize('function a() { if (ok) return 1; return 3 }'))
  assert.equal(result.verdict, 'DIFFERS')
  assert.equal(result.verdict === 'DIFFERS' && result.difference, 'before: `return 2 }` · after: `return 3 }`')
})

test('an explicit rename replaces a token sequence on the old side first, and is listed with the inferred ones', () => {
  const before = 'function stop(guildId) { const p = shoukaku.players.get(guildId); return p }'
  const after = 'function stop(guildId) { const player = getPlayer(guildId); return player }'
  assert.deepEqual(compare(tokenize(before), tokenize(after), [{ from: 'shoukaku.players.get(', to: 'getPlayer(' }]), {
    verdict: 'RENAMED',
    renames: [
      { from: 'shoukaku.players.get(', to: 'getPlayer(', explicit: true },
      { from: 'p', to: 'player' },
    ],
  })
})

test('a declaration that left one file and appeared in another is a move; one that stayed, or is new, is not', () => {
  const base = {
    'index.js': 'function ping(cfg) { return fetch(cfg.url) }\nfunction keep() { return 1 }\nconst LIMIT = 3',
  }
  const head = {
    'index.js': "const { ping, LIMIT } = require('./nodePool')\nfunction keep() { return 1 }",
    'nodePool.js': 'function ping(cfg) { return fetch(cfg.url) }\nconst LIMIT = 4\nfunction brandNew() {}',
  }
  const moves = findMoves(base, head)
  assert.deepEqual(
    moves.map(move => [move.name, move.from, move.to, move.result.verdict]),
    [
      ['ping', 'index.js', 'nodePool.js', 'IDENTICAL'],
      ['LIMIT', 'index.js', 'nodePool.js', 'DIFFERS'],
    ],
  )
  assert.deepEqual([moves[0]?.fromLines, moves[0]?.toLines], [[1, 1], [1, 1]])
})

test('the report is a table to paste into a pull request, with a count of each verdict', () => {
  const moves = findMoves(
    { 'index.js': 'function a(x) { return x }\nfunction b(n) { return lavalinkNodes[n] }\nfunction c() { return 1 }' },
    { 'pool.js': 'function a(x) { return x }\nfunction b(n) { return nodes[n] }\nfunction c() { return 2 }', 'index.js': '' },
  )
  const text = report(moves, 'origin/main (2526e8c)')
  assert.match(text, /1 identical · 1 renamed · 0 signature changed · 1 differs, against origin\/main \(2526e8c\)\./)
  assert.match(text, /\| `a` \| index\.js:1 → pool\.js:1 \| \*\*IDENTICAL\*\* \| \|/)
  assert.match(text, /\| `b` \| index\.js:2 → pool\.js:2 \| \*\*RENAMED\*\* \| `lavalinkNodes` → `nodes` \|/)
  assert.match(text, /\| `c` \| index\.js:3 → pool\.js:3 \| \*\*DIFFERS\*\* \| before: `return 1 }` · after: `return 2 }` \|/)
  assert.match(report([], 'main'), /No declaration moved between files against main\./)
})

test('a line range compares code that was never a declaration of its own, such as a loop body', () => {
  const before = 'setInterval(async () => {\n  for (const cfg of [...lavalinkNodes]) {\n    await check(cfg)\n  }\n}, 5000)'
  const after = 'async function checkAll() {\n  for (const cfg of [...nodes]) {\n    await check(cfg)\n  }\n}'
  assert.deepEqual(tokensInLines(before, 2, 4).map(token => token.text).join(' '), 'for ( const cfg of [ ... lavalinkNodes ] ) { await check ( cfg ) }')
  assert.deepEqual(compare(tokensInLines(before, 2, 4), tokensInLines(after, 2, 4)), {
    verdict: 'RENAMED',
    renames: [{ from: 'lavalinkNodes', to: 'nodes' }],
  })
})

test('code that landed inside a factory in the new file is found there, nested (dependency injection)', () => {
  const base = { 'index.js': 'async function playNext(guildId) {\n  const q = getQueue(guildId)\n  return q.next()\n}' }
  const head = {
    'index.js': "const { playNext } = createTrackAdvancer({ getQueue })",
    'trackAdvance.js': 'function createTrackAdvancer({ getQueue }) {\n  async function playNext(guildId) {\n    const q = getQueue(guildId)\n    return q.next()\n  }\n  return { playNext }\n}',
  }
  const moves = findMoves(base, head)
  assert.deepEqual(
    moves.map(move => [move.name, move.from, move.to, move.result.verdict, move.toLines]),
    [['playNext', 'index.js', 'trackAdvance.js', 'IDENTICAL', [2, 5]]],
  )
})

test('a moved function whose parameters changed but whose body did not is SIGNATURE, with both parameter lists', () => {
  const base = { 'index.js': 'function ping(cfg) {\n  return fetch(cfg.url, { timeout: LIMIT })\n}' }
  const head = { 'pool.js': 'function ping(cfg, { fetch, limit }) {\n  return fetch(cfg.url, { timeout: limit })\n}', 'index.js': '' }
  const [move] = findMoves(base, head)
  assert.deepEqual(move?.result, {
    verdict: 'SIGNATURE',
    parameters: { before: '( cfg )', after: '( cfg , { fetch , limit } )' },
    renames: [{ from: 'LIMIT', to: 'limit' }],
  })
  const text = report(findMoves(base, head), 'main')
  assert.match(text, /0 identical · 0 renamed · 1 signature changed · 0 differs, against main\./)
  assert.match(text, /\| `ping` \| index\.js:1 → pool\.js:1 \| \*\*SIGNATURE\*\* \| parameters `\( cfg \)` → `\( cfg , \{ fetch , limit \} \)`; body: `LIMIT` → `limit` \|/)
})

test('a body that changed is DIFFERS even when the parameters changed too', () => {
  const [move] = findMoves({ 'a.js': 'function f(x) { return x + 1 }' }, { 'b.js': 'function f(x, y) { return x + 2 }', 'a.js': '' })
  assert.equal(move?.result.verdict, 'DIFFERS')
})

test('a const carries on over lines that end on an operator or start with one', () => {
  const source = 'const total =\n  a +\n  b\nconst p = fetch(url)\n  .then(r => r.json())\nfunction next() {}'
  assert.deepEqual(
    declarations(source).map(({ name, startLine, endLine }) => [name, startLine, endLine]),
    [
      ['total', 1, 3],
      ['p', 4, 5],
      ['next', 6, 6],
    ],
  )
})

test('a name the new file already declared, even nested, did not arrive there', () => {
  const base = { 'index.js': 'function run() { return 1 }', 'jobs.js': 'function make() {\n  function run() { return 2 }\n  return run\n}' }
  const head = { 'index.js': '', 'jobs.js': base['jobs.js'] }
  assert.deepEqual(findMoves(base, head), [])
})

test('new parameters with a changed head (async added) DIFFERS, not SIGNATURE', () => {
  const [move] = findMoves({ 'a.js': 'function f(x) { return x }' }, { 'b.js': 'async function f(x, y) { return x }', 'a.js': '' })
  assert.equal(move?.result.verdict, 'DIFFERS')
})

test('a pipe in a note is escaped so the table holds', () => {
  const text = report(findMoves({ 'a.js': 'function f(x) { return x || 1 }' }, { 'b.js': 'function f(x) { return x || 2 }', 'a.js': '' }), 'main')
  assert.ok(text.includes('| before: `\\|\\| 1 }` · after: `\\|\\| 2 }` |'), text)
})

// #60: a declaration moved into a new module has to be exported there. That keyword is part of moving, not a change
// to the code: without this, extracting code into a module could never read IDENTICAL.
test('a move that only adds (or drops) export, export default or declare is IDENTICAL', () => {
  const base = { 'register.ts': 'function succeeded(r) { return r.ok }\nconst PREFIX = "x:"\nfunction gone() { return 1 }' }
  const head = {
    'register.ts': '',
    'result.ts': 'export function succeeded(r) { return r.ok }\nexport const PREFIX = "x:"',
    'other.ts': 'export default function gone() { return 1 }',
  }
  assert.deepEqual(
    findMoves(base, head).map(move => [move.name, move.result.verdict]),
    [
      ['succeeded', 'IDENTICAL'],
      ['PREFIX', 'IDENTICAL'],
      ['gone', 'IDENTICAL'],
    ],
  )
  const back = findMoves({ 'a.ts': 'export const LIMIT = 3' }, { 'a.ts': '', 'b.ts': 'const LIMIT = 3' })
  assert.equal(back[0]?.result.verdict, 'IDENTICAL')
})

test('export added together with a real change still shows the change', () => {
  const [move] = findMoves({ 'a.ts': 'const LIMIT = 3' }, { 'a.ts': '', 'b.ts': 'export const LIMIT = 4' })
  assert.equal(move?.result.verdict, 'DIFFERS')
  const [sig] = findMoves({ 'a.ts': 'function f(x) { return x }' }, { 'a.ts': '', 'b.ts': 'export function f(x, y) { return x }' })
  assert.equal(sig?.result.verdict, 'SIGNATURE')
})
