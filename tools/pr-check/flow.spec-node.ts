// npx tsx --test tools/pr-check/flow.spec-node.ts (not *.test.ts: the plugin test kit would load it)
// The pull-request check end to end on a throwaway repository: which rows it gives, from git as it is.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { checkPullRequest } from './check'

const repo = mkdtempSync(join(tmpdir(), 'pr-check-')).replace(/\\/g, '/')
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

git('init', '-q', '-b', 'main')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'test')
git('config', 'commit.gpgsign', 'false')
write('src/a.js', 'function f() {\n  return 1\n}\nmodule.exports = { f }\n')
write('src/b.js', 'function g() {\n  return 2\n}\nmodule.exports = { g }\n')
write('src/c.js', 'function h() {\n  return 3\n}\nfunction k() {\n  return 4\n}\nmodule.exports = { h, k }\n')
// A folder with a layout of its own, tests beside the source.
write('dope-tdd.json', '{ "layouts": { "web": "colocated" } }\n')
write('web/src/lib/x.js', 'function x() {\n  return 5\n}\nmodule.exports = { x }\n')
git('add', '-A')
git('commit', '-q', '-m', 'base')
git('checkout', '-q', '-b', 'pr')
// An existing file whose own code changed and which also received g from b.js.
write('src/a.js', 'function f() {\n  return 10\n}\nfunction g() {\n  return 2\n}\nmodule.exports = { f, g }\n')
write('src/b.js', 'module.exports = {}\n')
// A file moved with git mv and given a header: git calls it a rename.
git('mv', 'src/c.js', 'src/pool.js')
write('src/pool.js', '// the pool\nfunction h() {\n  return 3\n}\nfunction k() {\n  return 4\n}\nmodule.exports = { h, k }\n')
write('web/src/lib/x.js', 'function x() {\n  return 6\n}\nmodule.exports = { x }\n')
git('add', '-A')
git('commit', '-q', '-m', 'pr')

after(() => rmSync(repo, { recursive: true, force: true }))

test('an existing file that received moved code is checked as itself, never MOVED; the move is a note (#1)', async () => {
  const { rows } = await checkPullRequest(repo, 'main', { timeoutMs: 20_000 })
  const a = rows.find(row => row.source === 'src/a.js')
  assert.notEqual(a?.verdict, 'MOVED')
  assert.equal(a?.verdict, 'UNTESTED')
  assert.match(a?.note ?? '', /also received moved code from src\/b\.js: `g` identical/)
})

test('a file moved with git mv and edited is MOVED (#6)', async () => {
  const { rows } = await checkPullRequest(repo, 'main', { timeoutMs: 20_000 })
  const pool = rows.find(row => row.source === 'src/pool.js')
  assert.equal(pool?.verdict, 'MOVED')
  assert.match(pool?.note ?? '', /moved from src\/c\.js: `h` identical, `k` identical/)
})

test('a module in a folder with a layout of its own is named in the table by its source path (review #5)', async () => {
  const { rows } = await checkPullRequest(repo, 'main', { timeoutMs: 20_000 })
  const web = rows.find(row => row.source === 'web/src/lib/x.js')
  assert.equal(web?.module, 'web/src/lib/x')
})
