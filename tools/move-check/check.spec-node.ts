// node --test tools/move-check/check.spec-node.ts (not *.test.ts: the plugin test kit would load it)
// The git side of the move check, on a throwaway repository: what it reads at the base and at the head.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { changedCode, existsAt, moveCheck, parseArgs, renameRules } from './check.ts'
import { findMoves } from './move.ts'

const repo = mkdtempSync(join(tmpdir(), 'move-check-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')
git('config', 'commit.gpgsign', 'false')
write('src/b.ts', 'export function ping(cfg) {\n  return fetch(cfg.url)\n}\n\nexport function pong() {\n  return 2\n}\n')
write('src/a.ts', 'export function keep() {\n  return 1\n}\n')
git('add', '-A')
git('commit', '-q', '-m', 'base')
const base = git('rev-parse', 'HEAD')
// The usual shape of a move into a new file: git mv, then a small edit, which git reports as a rename.
git('mv', 'src/b.ts', 'src/pool.ts')
write('src/pool.ts', '// The node pool.\nexport function ping(cfg) {\n  return fetch(cfg.url)\n}\n\nexport function pong() {\n  return 2\n}\n')
git('add', '-A')
git('commit', '-q', '-m', 'move')

after(() => rmSync(repo, { recursive: true, force: true }))

test('a file moved with git mv and edited is read at both paths, so its declarations are a move (#6)', () => {
  const code = changedCode(repo, base, 'HEAD')
  assert.deepEqual(Object.keys(code.base).sort(), ['src/b.ts'])
  assert.deepEqual(Object.keys(code.head).sort(), ['src/pool.ts'])
  assert.deepEqual(
    findMoves(code.base, code.head).map(move => [move.name, move.from, move.to, move.result.verdict]),
    [
      ['ping', 'src/b.ts', 'src/pool.ts', 'IDENTICAL'],
      ['pong', 'src/b.ts', 'src/pool.ts', 'IDENTICAL'],
    ],
  )
})

test('a path is known at a commit or not', () => {
  assert.equal(existsAt(repo, base, 'src/b.ts'), true)
  assert.equal(existsAt(repo, base, 'src/pool.ts'), false)
  assert.equal(existsAt(repo, 'HEAD', 'src/pool.ts'), true)
})

// #67: `--rename 'old=new'` split at the first `=`, so a rule holding `=>` or `===` was silently misread.
test('a --rename with one = is old and new; one with more is refused, with what to use instead', () => {
  assert.deepEqual(parseArgs(['--base', 'main', '--rename', 'LIMIT=limit']).renames, [{ from: 'LIMIT', to: 'limit' }])
  assert.throws(
    () => parseArgs(['--base', 'main', '--rename', 'new Promise(r => setTimeout(r, 500))=wait(500)']),
    /more than one `=`.*--rename-from '<old>' --rename-to '<new>'/s,
  )
  assert.throws(() => parseArgs(['--base', 'main', '--rename', 'a===b=c']), /more than one `=`/)
})

test('--rename-from and --rename-to take any code, = included, as one rule', () => {
  const options = parseArgs(['--base', 'main', '--rename-from', 'new Promise(r => setTimeout(r, 500))', '--rename-to', 'wait(500)'])
  assert.deepEqual(options.renames, [{ from: 'new Promise(r => setTimeout(r, 500))', to: 'wait(500)' }])
  assert.throws(() => parseArgs(['--base', 'main', '--rename-to', 'x']), /--rename-to needs a --rename-from before it/)
  assert.throws(() => parseArgs(['--base', 'main', '--rename-from', 'x']), /--rename-from 'x' has no --rename-to after it/)
})

test('pr-check and move-check read rename rules the same way: in order, both forms, among other flags', () => {
  assert.deepEqual(renameRules(['--repo', '.', '--rename', 'A=b', '--base', 'main', '--rename-from', 'x => y', '--rename-to', 'f(x)']), [
    { from: 'A', to: 'b' },
    { from: 'x => y', to: 'f(x)' },
  ])
})

// #64: the issue's own example. bot.js is split into commands.js (its `if` blocks became methods), pick.js and retry.js.
// The check finds pick and retry; the report must say the `if` blocks and LIMIT are not accounted for.
test('the report says which removed lines no move accounts for (#64)', () => {
  const split = mkdtempSync(join(tmpdir(), 'move-check-64-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: split, encoding: 'utf8' }).trim()
  const put = (path: string, text: string) => writeFileSync(join(split, path), text)
  try {
    run('init', '-q')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    run('config', 'commit.gpgsign', 'false')
    put('bot.js', [
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
      '',
      'function pick(list) {',
      '  return list[Math.floor(Math.random() * list.length)];',
      '}',
      '',
      'async function retry(fn) {',
      '  await new Promise(r => setTimeout(r, 500));',
      '  return fn();',
      '}',
      '',
    ].join('\n'))
    run('add', '-A')
    run('commit', '-q', '-m', 'base')
    const start = run('rev-parse', 'HEAD')
    run('rm', '-q', 'bot.js')
    put('commands.js', "function createCommands({ limit }) {\n  return {\n    async ping(i) {\n      const note = 'up to';\n      return i.reply(`pong, ${note} ${limit}`);\n    },\n  };\n}\n")
    put('pick.js', 'function pick(list, random = Math.random) {\n  return list[Math.floor(random() * list.length)];\n}\n')
    put('retry.js', 'const defaultWait = (ms) => new Promise(r => setTimeout(r, ms));\nasync function retry(fn, wait = defaultWait) {\n  await wait(500);\n  return fn();\n}\n')
    run('add', '-A')
    run('commit', '-q', '-m', 'split')

    const result = moveCheck(split, parseArgs(['--base', start]))

    // Part 2 pairs the `ping` block with its method; `roll` has no method, so it stays uncovered with LIMIT.
    assert.deepEqual(result.moves.map(move => move.name).sort(), ['pick', 'ping', 'retry'])
    assert.deepEqual(result.coverage, {
      removed: 18,
      accounted: 11,
      uncovered: [
        { path: 'bot.js', start: 8, end: 12, lines: 5 },
        { path: 'bot.js', start: 1, end: 3, lines: 2 },
      ],
    })
    assert.match(result.text, /Accounted for: 11 of 18 removed lines \(61%\)/)
  } finally {
    rmSync(split, { recursive: true, force: true })
  }
})

test('--fail-on accepts uncovered', () => {
  assert.equal(parseArgs(['--base', 'main', '--fail-on', 'uncovered']).failOn, 'uncovered')
})
