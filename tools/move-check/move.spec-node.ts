// node --test tools/move-check/move.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { closingOnlyEnd, compare, coverageOf, declarations, findMoves, removedLinesIn, report, tokenize, tokensInLines } from './move.ts'

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

// #65: a rule given for one piece (pick now takes `random`) was applied to every piece, so code that still calls
// Math.random and never changed read DIFFERS. A rule applies to a piece only where the new side no longer has its old code.
test('a given rename skips a piece whose new side still has the old code, so unchanged code stays IDENTICAL', () => {
  const rule = [{ from: 'Math.random(', to: 'random(' }]
  const roll = 'return i.reply(String(Math.floor(Math.random() * sides) + 1))'
  assert.deepEqual(compare(tokenize(roll), tokenize(roll), rule), { verdict: 'IDENTICAL', renames: [] })

  const base = { 'bot.js': 'function pick(list) {\n  return list[Math.floor(Math.random() * list.length)]\n}' }
  const head = { 'bot.js': '', 'pick.js': 'function pick(list, random = Math.random) {\n  return list[Math.floor(random() * list.length)]\n}' }
  const [pick] = findMoves(base, head, rule)
  assert.equal(pick?.result.verdict, 'SIGNATURE')
  assert.deepEqual(pick?.result.verdict === 'SIGNATURE' ? pick.result.renames : [], [{ from: 'Math.random(', to: 'random(', explicit: true }])
})

// #66: a template literal was one token, so a name inside `${…}` was invisible to renames, detected or given.
test('names inside a template literal take part in renames; the literal text around them must match', () => {
  const before = tokenize('return i.reply(`pong, ${note} ${LIMIT}`)')
  const after = tokenize('return i.reply(`pong, ${note} ${limit}`)')
  assert.deepEqual(compare(before, after), { verdict: 'RENAMED', renames: [{ from: 'LIMIT', to: 'limit' }] })
  assert.deepEqual(compare(before, after, [{ from: 'LIMIT', to: 'limit' }]), {
    verdict: 'RENAMED',
    renames: [{ from: 'LIMIT', to: 'limit', explicit: true }],
  })
  assert.equal(compare(tokenize('`pong ${a}`'), tokenize('`ping ${a}`')).verdict, 'DIFFERS')
  assert.equal(compare(tokenize('`a ${f({ x: `${y}` })} b`'), tokenize('`a ${f({ x: `${z}` })} b`')).verdict, 'RENAMED')
})

// #64 part 1: a report that found a third of the moved code read as complete. It now says what no move accounts for.
test('the lines each file lost are read from git diff -U0, on the base side', () => {
  const diff = [
    'diff --git a/bot.js b/bot.js',
    'deleted file mode 100644',
    '--- a/bot.js',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-const A = 1',
    '-',
    '-const B = 2',
    'diff --git a/keep.js b/keep.js',
    '--- a/keep.js',
    '+++ b/keep.js',
    '@@ -5 +5 @@',
    '-old',
    '+new',
    '@@ -9,0 +10,2 @@',
    '+added',
    '+added',
    'diff --git a/new.js b/new.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.js',
    '@@ -0,0 +1 @@',
    '+x',
  ].join('\n')
  assert.deepEqual(removedLinesIn(diff), { 'bot.js': [1, 2, 3], 'keep.js': [5] })
})

test('coverage counts removed code lines inside a move as accounted for, and lists the rest as ranges, largest first', () => {
  const baseText = 'const A = 1\n\n// a note\nfunction f() {\n  return 1\n}\nconst B = 2\nconst C = 3\n'
  const removed = { 'a.js': [1, 2, 3, 4, 5, 6, 7, 8], 'b.js': [4] }
  const moves = findMoves({ 'a.js': 'function f() {\n  return 1\n}' }, { 'a.js': '', 'm.js': 'function f() {\n  return 1\n}' })
  const moved = moves.map(move => ({ ...move, fromLines: [4, 6] as [number, number] }))
  const coverage = coverageOf(removed, { 'a.js': baseText, 'b.js': 'x\nx\nx\nlost()\n' }, moved)
  // a.js: lines 2 (blank) and 3 (comment) are not code; 4-6 are the move; 1, 7, 8 are not accounted for. b.js: 4.
  assert.deepEqual(coverage, {
    removed: 7,
    accounted: 3,
    uncovered: [
      { path: 'a.js', start: 7, end: 8, lines: 2 },
      { path: 'a.js', start: 1, end: 1, lines: 1 },
      { path: 'b.js', start: 4, end: 4, lines: 1 },
    ],
  })
})

test('a run of uncovered lines is one range across blank and comment lines', () => {
  const coverage = coverageOf({ 'a.js': [1, 2, 3, 4] }, { 'a.js': 'a()\n\n// note\nb()\n' }, [])
  assert.deepEqual(coverage.uncovered, [{ path: 'a.js', start: 1, end: 4, lines: 2 }])
})

test('the report says how much of the removed code the moves account for, and where the rest is', () => {
  const coverage = { removed: 18, accounted: 7, uncovered: [{ path: 'bot.js', start: 1, end: 12, lines: 11 }] }
  const text = report([], 'main', coverage)
  assert.match(text, /Accounted for: 7 of 18 removed lines \(39%\)\. Not by any move above \(edits, deletions, or moves this check did not find\):/)
  assert.match(text, /- bot\.js:1-12 \(11 lines\)/)
  const all = report([], 'main', { removed: 4, accounted: 4, uncovered: [] })
  assert.match(all, /Accounted for: 4 of 4 removed lines \(100%\)\.$/m)
})

test('only the ten largest uncovered ranges are listed; the rest are counted', () => {
  const uncovered = Array.from({ length: 12 }, (_, k) => ({ path: 'a.js', start: k * 10 + 1, end: k * 10 + 1, lines: 1 }))
  const text = report([], 'main', { removed: 12, accounted: 0, uncovered })
  assert.equal((text.match(/^- a\.js:/gm) ?? []).length, 10)
  assert.match(text, /and 2 more ranges \(2 lines\)/)
})

// #64 part 2: a removed `if (name === 'key') { … }` or `case 'key':` and an added `key(…) { … }` method or `key:` entry
// are the same code moved, paired by the key. In the refactor that found this, 37 of 114 moved pieces had this shape.
const BOT = [
  'const LIMIT = 10;',
  '',
  'async function onCommand(name, i) {',
  "  if (name === 'ping') {",
  "    const note = 'up to';",
  '    return i.reply(`pong, ${note} ${LIMIT}`);',
  '  }',
  "  if (name === 'roll') {",
  '    const sides = 6;',
  '    return i.reply(String(Math.floor(Math.random() * sides) + 1));',
  '  }',
  '}',
].join('\n')
const COMMANDS = [
  'function createCommands({ limit }) {',
  '  return {',
  '    async ping(i) {',
  "      const note = 'up to';",
  '      return i.reply(`pong, ${note} ${limit}`);',
  '    },',
  '    roll: async (i) => {',
  '      const sides = 6;',
  '      return i.reply(String(Math.floor(Math.random() * sides) + 1));',
  '    },',
  '  };',
  '}',
].join('\n')

test('an if block that became a method, and one that became an entry, are paired by the key and compared', () => {
  const moves = findMoves({ 'bot.js': BOT }, { 'bot.js': '', 'commands.js': COMMANDS })
  assert.deepEqual(
    moves.map(move => [move.name, move.shape, move.fromLines, move.toLines, move.result.verdict]),
    [
      ['ping', { from: 'if', to: 'method' }, [4, 7], [3, 6], 'RENAMED'],
      ['roll', { from: 'if', to: 'entry' }, [8, 11], [7, 10], 'IDENTICAL'],
    ],
  )
  assert.deepEqual(moves[0]?.result.verdict === 'RENAMED' ? moves[0].result.renames : [], [{ from: 'LIMIT', to: 'limit' }])
})

test('a case that became a method is paired too, its break left out', () => {
  const base = { 'bot.js': "function on(name, i) {\n  switch (name) {\n    case 'ping':\n      i.reply('pong')\n      break\n    default:\n      i.reply('?')\n  }\n}" }
  const head = { 'bot.js': '', 'table.js': "const table = {\n  ping(i) {\n    i.reply('pong')\n  },\n}" }
  const [move] = findMoves(base, head)
  assert.deepEqual([move?.name, move?.shape, move?.result.verdict], ['ping', { from: 'case', to: 'method' }, 'IDENTICAL'])
})

test('a block still in its file, or a key that is not unique on either side, is not paired', () => {
  const kept = findMoves({ 'bot.js': BOT }, { 'bot.js': BOT, 'commands.js': COMMANDS })
  assert.deepEqual(kept.filter(move => move.shape !== undefined), [])
  const twice = BOT + "\nfunction other(name, i) {\n  if (name === 'ping') {\n    return 1\n  }\n}"
  const moves = findMoves({ 'bot.js': twice }, { 'bot.js': '', 'commands.js': COMMANDS })
  assert.deepEqual(moves.map(move => move.name), ['roll'])
})

test('the report says what shape a paired block had and has', () => {
  const text = report(findMoves({ 'bot.js': BOT }, { 'bot.js': '', 'commands.js': COMMANDS }), 'main')
  assert.match(text, /\| `ping` \| bot\.js:4 \(if 'ping'\) → commands\.js:3 \(method\) \| \*\*RENAMED\*\* \|/)
  assert.match(text, /\| `roll` \| bot\.js:8 \(if 'roll'\) → commands\.js:7 \(entry\) \| \*\*IDENTICAL\*\* \|/)
})

// #64 part 3: a hand-written --pair one line too long read as DIFFERS with `before: ; · after: ; } ,`, which looks like
// a real change. When only trailing closers differ, the line that side should end on is given instead.
test('a pair that differs only by trailing closing tokens says which line that side should end on', () => {
  const block = "if (name === 'ping') {\n  const note = 'up to'\n  return i.reply(note)\n}"
  const method = "const t = {\n  async ping(i) {\n    const note = 'up to'\n    return i.reply(note)\n  },\n}"
  assert.deepEqual(closingOnlyEnd(tokensInLines(block, 2, 3), tokensInLines(method, 3, 5), []), { side: 'after', endLine: 4 })
  assert.deepEqual(closingOnlyEnd(tokensInLines(method, 3, 5), tokensInLines(block, 2, 3), []), { side: 'before', endLine: 4 })
})

test('no hint when the pair matches, or differs in more than closers', () => {
  const a = 'const x = f(1)\nreturn x\n'
  assert.equal(closingOnlyEnd(tokensInLines(a, 1, 2), tokensInLines(a, 1, 2), []), null)
  assert.equal(closingOnlyEnd(tokensInLines(a, 1, 2), tokensInLines('const x = f(2)\nreturn x\n}\n', 1, 3), []), null)
})

// #76: only functions, classes and const/let/var were declarations, so a moved `type` or `interface` was never found.
test('a type alias and an interface that moved are found and compared like any declaration', () => {
  const base = {
    'register.ts': "type SharedLock = { kind: 'acquired'; sha: string } | { kind: 'busy' }\ninterface JournalFile {\n  path: string\n  before: string\n}\nconst keep = 1",
  }
  const head = {
    'register.ts': 'const keep = 1',
    'journal.ts': "export type SharedLock = { kind: 'acquired'; sha: string } | { kind: 'busy' }\nexport interface JournalFile extends Base {\n  path: string\n  after: string\n}",
  }
  assert.deepEqual(
    findMoves(base, head).map(move => [move.name, move.fromLines, move.result.verdict]),
    [
      ['SharedLock', [1, 1], 'IDENTICAL'],
      ['JournalFile', [2, 5], 'DIFFERS'],
    ],
  )
})

test('a value or property named type is not a type declaration', () => {
  assert.deepEqual(declarations('const type = 1\ntype(1)\nobj.type = 2\nexport type { A } from "./a"').map(decl => decl.name), ['type'])
})

// Found while checking #76 on real history: a function whose return type is an object type (`): { a: string } {`)
// was cut off at that type's `}`, so its body was never compared and a changed body still read IDENTICAL.
test('a function with an object return type is read to the end of its body, so a changed body is DIFFERS', () => {
  const before = 'function parseLock(text: string): { module: string } | null {\n  return JSON.parse(text)\n}'
  const after = 'function parseLock(text: string): { module: string } | null {\n  return null\n}'
  const [decl] = declarations(before)
  assert.deepEqual([decl?.name, decl?.startLine, decl?.endLine], ['parseLock', 1, 3])
  const [move] = findMoves({ 'a.ts': before }, { 'a.ts': '', 'b.ts': after })
  assert.equal(move?.result.verdict, 'DIFFERS')
  const generic = declarations('function wrap<T>(x: T): Promise<{ value: T }> {\n  return Promise.resolve({ value: x })\n}')
  assert.deepEqual([generic[0]?.name, generic[0]?.endLine], ['wrap', 3])
})
