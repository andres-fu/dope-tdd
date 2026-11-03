// node --test tools/pr-check/flow.spec-node.ts (not *.test.ts: the plugin test kit would load it)
// The pull-request check end to end on a throwaway repository: which rows it gives, from git as it is.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { checkPullRequest } from './check.ts'

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

const repos = [repo]
after(() => repos.forEach(dir => rmSync(dir, { recursive: true, force: true })))

// #319: the check read its config from the pull request it judged, so a pull request could pass by exempting itself.
const DELETED = 'the pull request deletes it'
function repoWith(baseConfig: string | null, prConfig: string | null, prFiles: Readonly<Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pr-check-config-')).replace(/\\/g, '/')
  repos.push(dir)
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const put = (path: string, text: string | null) => {
    if (text === null || text === DELETED) return
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  run('config', 'commit.gpgsign', 'false')
  put('src/a.js', 'function f() {\n  return 1\n}\nmodule.exports = { f }\n')
  put('dope-tdd.json', baseConfig)
  run('add', '-A')
  run('commit', '-q', '-m', 'base')
  run('checkout', '-q', '-b', 'pr')
  put('src/a.js', 'function f() {\n  return 2\n}\nmodule.exports = { f }\n')
  put('dope-tdd.json', prConfig)
  if (prConfig === DELETED) run('rm', '-q', 'dope-tdd.json')
  for (const [path, text] of Object.entries(prFiles)) put(path, text)
  run('add', '-A')
  run('commit', '-q', '-m', 'pr')
  return dir
}

for (const [name, prConfig] of [
  ['adds an exemption', '{ "exempt": ["src/a.js"] }\n'],
  ['turns the check off', '{ "catchCheck": false }\n'],
  ['moves to observe', '{ "mode": "observe" }\n'],
  ['moves the layout away', '{ "layout": { "source": "lib/{module}.{ext}", "test": "t/{module}.test.{ext}" } }\n'],
  ['deletes the file', DELETED],
] as const) {
  test(`a pull request that ${name} is still judged by the base's config, and the report says so (#319)`, async () => {
    const { rows, configNote } = await checkPullRequest(repoWith('{ "mode": "enforce" }\n', prConfig), 'main', { timeoutMs: 20_000 })
    assert.equal(rows.find(row => row.source === 'src/a.js')?.verdict, 'UNTESTED')
    assert.match(configNote ?? '', /changes dope-tdd\.json/)
    assert.match(configNote ?? '', /isn't in force/)
  })
}

test('a marker the pull request adds does not change the stack it is judged as', async () => {
  const { rows } = await checkPullRequest(repoWith('{ "mode": "enforce" }\n', null, { 'pom.xml': '<project/>\n' }), 'main', { timeoutMs: 20_000 })
  assert.equal(rows.find(row => row.source === 'src/a.js')?.verdict, 'UNTESTED')
})

test('a project whose first marker comes in the pull request is judged as that stack, and told so', async () => {
  const { rows, configNote } = await checkPullRequest(repoWith(null, null, { 'pyproject.toml': '[project]\n', 'src/b.py': 'def b():\n    return 1\n' }), 'main', { timeoutMs: 20_000 })
  assert.equal(rows.find(row => row.source === 'src/b.py')?.verdict, 'UNTESTED')
  assert.match(configNote ?? '', /adds pyproject\.toml/)
})

test('an invalid first config says to fix it in this pull request', async () => {
  const { configNote } = await checkPullRequest(repoWith(null, '{ "mode": "Nope" }\n'), 'main', { timeoutMs: 20_000 })
  assert.match(configNote ?? '', /invalid, so the defaults were used\. Fix it in this pull request\./)
  assert.doesNotMatch(configNote ?? '', /judged by that file|base branch/)
})

test('a config that is invalid at the base is said, whatever the pull request does with it', async () => {
  for (const prConfig of [null, '{ "mode": "enforce" }\n']) {
    const { configNote } = await checkPullRequest(repoWith('{ "mode": "Nope" }\n', prConfig), 'main', { timeoutMs: 20_000 })
    assert.match(configNote ?? '', /invalid, so the defaults were used/)
  }
})

test('the report a pull request reads carries that word', () => {
  const dir = repoWith('{ "mode": "enforce" }\n', '{ "mode": "observe" }\n')
  const script = new URL('./check.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const out = execFileSync(process.execPath, [script, '--repo', dir, '--base', 'main', '--fail-on', 'never', '--timeout-ms', '20000'], { encoding: 'utf8' })
  assert.match(out, /\*\*This pull request changes dope-tdd\.json\. It was judged by the base's copy/)
})

test('a project with no config at the base is judged by the one its first pull request adds', async () => {
  const { rows, configNote } = await checkPullRequest(repoWith(null, '{ "exempt": ["src/a.js"] }\n'), 'main', { timeoutMs: 20_000 })
  assert.equal(rows.length, 0)
  assert.match(configNote ?? '', /adds dope-tdd\.json, and it was judged by that file/)
})

test('a pull request that leaves the config alone hears nothing about it', async () => {
  const { configNote } = await checkPullRequest(repoWith('{ "mode": "enforce" }\n', null), 'main', { timeoutMs: 20_000 })
  assert.equal(configNote, null)
})

// #299: git quotes a non-ASCII name, and the quoted text classified as nothing, so the change was skipped in silence.
test('a source file with a non-ASCII name is checked like any other', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-check-name-')).replace(/\\/g, '/')
  after(() => rmSync(dir, { recursive: true, force: true }))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const code = (n: number) => `function f() {\n  return ${n}\n}\nmodule.exports = { f }\n`
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  run('config', 'commit.gpgsign', 'false')
  run('config', 'core.quotePath', 'true')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'café.js'), code(1))
  run('add', '-A')
  run('commit', '-q', '-m', 'base')
  run('checkout', '-q', '-b', 'pr')
  writeFileSync(join(dir, 'src', 'café.js'), code(2))
  run('commit', '-q', '-am', 'pr')
  const { rows } = await checkPullRequest(dir, 'main', { timeoutMs: 20_000 })
  assert.equal(rows.find(row => row.source === 'src/café.js')?.verdict, 'UNTESTED')
})

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
