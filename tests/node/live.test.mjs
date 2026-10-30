// The pure parts of the live suite (tools/live): the stream-json reader, the check helpers, and each scenario's checks.
// The live runs cost model turns, so these pin what a run is judged on without one. Every scenario's checks must pass
// on the stream the real run gave and fail on the stream a regression would give: a check that cannot fail proves
// nothing. Node only: the streams are built here, so no run and no local path is needed.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildOf, check, dopePlugin, formatResult, isRefusal, isUnder, samePath, tddReport } from '../../tools/live/checks.mjs'
import { claudeArgs, OFF_SETTINGS, parseArgs } from '../../tools/live/run.mjs'
import { scenarios } from '../../tools/live/scenarios.mjs'
import { describeRun, readRun, userMessages } from '../../tools/live/stream.mjs'

const REFUSAL = '<tool_use_error>dope-tdd: write the failing test first. Touch tests/calc.test.js, or run it and see it fail, before editing src/calc.\nUnblock by one of:\n(1) tests/calc.test.js exists: add or tighten one assertion for what you are about to change, and see it fail: node --test tests/calc.test.js</tool_use_error>'
const UPDATED = file => `The file ${file} has been updated successfully.`

const CHECKOUT = 'C:\\work\\dope-tdd'
const SHA = 'ed5625b0123456789abcdef0123456789abcdef0'
const ROOT = 'C:\\tmp\\dope-tdd-live-x'
const PROBE = `${ROOT}\\probe`

const init = over => ({
  type: 'system',
  subtype: 'init',
  cwd: PROBE,
  session_id: 's1',
  claude_code_version: '2.1.312',
  plugins: [{ name: 'dope-tdd', path: CHECKOUT, source: 'dope-tdd@inline', version: '0.2.13' }],
  slash_commands: ['dope-tdd:pin', 'tdd'],
  ...over,
})
const use = (id, name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } })
const answer = (id, content, error = false, parent = null) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(error ? { is_error: true } : {}) }] },
})
const end = (result, command = false) => ({ type: 'result', subtype: 'success', result, ...(command ? { local_command: 'custom' } : {}) })
const stream = events => events.map(e => JSON.stringify(e)).join('\r\n') + '\r\n'

const report = (extra = '') => `dope-tdd: version 0.2.13 · #248 · ed5625b · 2026-10-29\nguard: ON\nmode: enforce\nrecent events: newest first\n${extra}`

// --- stream.mjs

test('readRun pairs each tool call with its result, and keeps which subagent made it', () => {
  const run = readRun(
    stream([
      init(),
      use('t1', 'Agent', { isolation: 'worktree', prompt: 'p' }),
      use('t2', 'Edit', { file_path: 'a.js' }, 't1'),
      answer('t2', REFUSAL, true, 't1'),
      answer('t1', [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]),
      end('done'),
    ]),
  )
  assert.equal(run.calls.length, 2)
  assert.deepEqual(run.calls[0], { id: 't1', name: 'Agent', input: { isolation: 'worktree', prompt: 'p' }, parent: null, result: { text: 'one\ntwo', error: false } })
  assert.deepEqual(run.calls[1], { id: 't2', name: 'Edit', input: { file_path: 'a.js' }, parent: 't1', result: { text: REFUSAL, error: true } })
})

test('readRun keeps the init facts and every turn, marking slash command output', () => {
  const run = readRun(stream([init(), end('the edit went through'), init(), end(report(), true)]))
  assert.equal(run.inits.length, 2)
  assert.deepEqual(run.inits[0], {
    cwd: PROBE,
    sessionId: 's1',
    claudeVersion: '2.1.312',
    plugins: [{ name: 'dope-tdd', path: CHECKOUT, source: 'dope-tdd@inline', version: '0.2.13' }],
    commands: ['dope-tdd:pin', 'tdd'],
  })
  assert.deepEqual(run.turns, [
    { text: 'the edit went through', command: false },
    { text: report(), command: true },
  ])
})

test('readRun skips lines that are not JSON and calls that never got a result', () => {
  const run = readRun(`not json\n${JSON.stringify(use('t1', 'Read', {}))}\n\n{"type":"rate_limit_event"}\n`)
  assert.deepEqual(run.calls, [{ id: 't1', name: 'Read', input: {}, parent: null, result: null }])
  assert.deepEqual(run.inits, [])
  assert.deepEqual(run.turns, [])
})

test('describeRun prints INIT, TOOL_USE, RESULT and END lines to read a failed run by', () => {
  const lines = describeRun(readRun(stream([init(), use('t1', 'Edit', { file_path: 'a.js' }), answer('t1', REFUSAL, true), end('blocked')])))
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^INIT cwd C:\\tmp\\dope-tdd-live-x\\probe · dope-tdd 0\.2\.13 \(dope-tdd@inline\)$/)
  assert.match(lines[1], /^TOOL_USE Edit \{"file_path":"a\.js"\}$/)
  assert.match(lines[2], /^RESULT error <tool_use_error>dope-tdd: write the failing test first/)
  assert.equal(lines[3], 'END blocked')
})

test('describeRun marks a subagent call and says when dope-tdd is not loaded', () => {
  const lines = describeRun(readRun(stream([init({ plugins: [] }), use('t2', 'Edit', {}, 't1')])))
  assert.equal(lines[0], `INIT cwd ${PROBE} · dope-tdd not loaded`)
  assert.equal(lines[1], '  [subagent] TOOL_USE Edit {}')
})

test('userMessages turns prompts into stream-json input, one line each', () => {
  const lines = userMessages(['Read "a"', '/tdd']).trim().split('\n')
  assert.deepEqual(JSON.parse(lines[0]), { type: 'user', message: { role: 'user', content: 'Read "a"' } })
  assert.deepEqual(JSON.parse(lines[1]), { type: 'user', message: { role: 'user', content: '/tdd' } })
})

test('readRun keeps the run cost, which each result reports as a running total', () => {
  const run = readRun(stream([{ ...end('x'), total_cost_usd: 0.21 }, { ...end(report(), true), total_cost_usd: 0.23 }]))
  assert.equal(run.cost, 0.23)
  assert.equal(readRun('').cost, 0)
})

// --- run.mjs: its arguments, and the flags that pick which build of dope-tdd a session loads

test('parseArgs takes the mode, a subset of scenarios and a model', () => {
  assert.deepEqual(parseArgs([]), { mode: 'branch', only: null, model: null })
  assert.deepEqual(parseArgs(['--installed', '--only', 'b,D', '--model', 'sonnet']), { mode: 'installed', only: ['B', 'D'], model: 'sonnet' })
  assert.throws(() => parseArgs(['--only', 'Z']), /unknown scenario Z/)
  assert.throws(() => parseArgs(['--fast']), /unknown option --fast/)
  assert.throws(() => parseArgs(['--model']), /--model needs a value/)
})

test('claudeArgs: branch loads the checkout and turns the installed copy off; installed adds neither; off only turns it off', () => {
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Edit', 'Agent', '--max-turns', '10']
  const opts = { checkout: CHECKOUT, settings: 'S.json', model: null }
  assert.deepEqual(claudeArgs({ ...opts, mode: 'branch', plugin: 'on' }), [...base, '--settings', 'S.json', '--plugin-dir', CHECKOUT])
  assert.deepEqual(claudeArgs({ ...opts, mode: 'installed', plugin: 'on' }), base)
  assert.deepEqual(claudeArgs({ ...opts, mode: 'branch', plugin: 'off' }), [...base, '--settings', 'S.json'])
  assert.deepEqual(claudeArgs({ ...opts, mode: 'installed', plugin: 'off' }), [...base, '--settings', 'S.json'])
  assert.deepEqual(claudeArgs({ ...opts, mode: 'installed', plugin: 'on', model: 'sonnet' }), [...base, '--model', 'sonnet'])
  assert.deepEqual(JSON.parse(OFF_SETTINGS), { enabledPlugins: { 'dope-tdd@dope-tdd': false } })
})

// --- checks.mjs

test('samePath and isUnder ignore which way the slashes lean', () => {
  assert.ok(samePath('C:\\a\\b\\calc.js', 'C:/a/b/calc.js'))
  assert.ok(samePath('C:\\a\\b\\', 'C:/a/b'))
  assert.ok(!samePath('C:/a/b/calc.js', 'C:/a/b/calc.ts'))
  assert.ok(isUnder('C:\\a\\b\\.claude\\worktrees\\agent-1\\src\\calc.js', 'C:/a/b/.claude/worktrees'))
  assert.ok(!isUnder('C:/a/bc/x.js', 'C:/a/b'), 'a sibling with a longer name is not under it')
  assert.ok(!isUnder('C:/a/b', 'C:/a/b'), 'a folder is not under itself')
})

test('isRefusal knows dope-tdd refusing an edit from an edit that went through', () => {
  assert.ok(isRefusal({ text: REFUSAL, error: true }))
  assert.ok(!isRefusal({ text: UPDATED('a.js'), error: false }))
  assert.ok(!isRefusal({ text: '<tool_use_error>File has not been read yet.</tool_use_error>', error: true }), 'another tool error is not dope-tdd')
  assert.ok(!isRefusal(null))
})

test('tddReport finds /tdd output, not the model saying it is missing', () => {
  assert.equal(tddReport(readRun(stream([end('done'), end(report('8S AGO: blocked calc'), true)]))), report('8S AGO: blocked calc'))
  assert.equal(tddReport(readRun(stream([end('`/tdd` is not available in this session.')]))), null)
  assert.equal(tddReport(readRun(stream([end('Unknown command: /tdd', true)]))), null)
})

test('buildOf reads the first line of /tdd', () => {
  assert.deepEqual(buildOf(report()), { version: '0.2.13', pr: '248', sha: 'ed5625b', day: '2026-10-29' })
  assert.deepEqual(buildOf('dope-tdd: version 0.2.13 · 1a2b3c4 · 2026-10-30\nguard: ON'), { version: '0.2.13', pr: null, sha: '1a2b3c4', day: '2026-10-30' })
  assert.deepEqual(buildOf('dope-tdd: version 0.2.13\nguard: ON'), { version: '0.2.13', pr: null, sha: null, day: null })
  assert.equal(buildOf('dope-tdd: build unknown'), null)
  assert.equal(buildOf(null), null)
})

test('dopePlugin finds dope-tdd in the first init, or null when it is not loaded', () => {
  assert.equal(dopePlugin(readRun(stream([init()]))).source, 'dope-tdd@inline')
  assert.equal(dopePlugin(readRun(stream([init({ plugins: [{ name: 'other', path: 'x', source: 'o@o', version: '1' }] })]))), null)
  assert.equal(dopePlugin(readRun('')), null)
})

test('formatResult prints one PASS or FAIL line, then each failed check with why', () => {
  assert.deepEqual(formatResult('B', 'untested edit', [check('refused', true)]), ['PASS B: untested edit'])
  assert.deepEqual(formatResult('B', 'untested edit', [check('refused', true), check('names the test', false, 'it named none')]), [
    'FAIL B: untested edit',
    '  ok   refused',
    '  FAIL names the test: it named none',
  ])
})

// --- scenarios.mjs: each one's checks, against the run it expects and the run a regression gives

const byId = id => scenarios.find(s => s.id === id)
const ctxFor = (over = {}) => ({ mode: 'branch', checkout: CHECKOUT, checkoutSha: SHA, root: ROOT, probe: PROBE, calcBefore: 'a + b', calcAfter: 'a + b', ...over })
const failed = checks => checks.filter(c => !c.ok).map(c => c.label)
const CALC = `${PROBE}\\src\\calc.js`
const WORKTREE_CALC = `${PROBE}\\.claude\\worktrees\\agent-a1b2\\src\\calc.js`

test('every scenario has an id, a title, a place to run, messages and checks', () => {
  assert.deepEqual(scenarios.map(s => s.id), ['A', 'B', 'C', 'D', 'E'])
  for (const s of scenarios) {
    assert.ok(['home', 'probe', 'linked'].includes(s.cwd), `${s.id} cwd`)
    assert.ok(['on', 'off'].includes(s.plugin), `${s.id} plugin`)
    const messages = s.messages(ctxFor())
    assert.ok(messages.length >= 1 && messages.every(m => typeof m === 'string' && m !== ''), `${s.id} messages`)
  }
  assert.ok(byId('A').messages(ctxFor()).some(m => m.includes('C:/tmp/dope-tdd-live-x/probe/src/calc.js')), 'A edits the probe by its absolute path')
})

test('A: an edit outside the project goes through, and /tdd says it was outside', () => {
  const A = byId('A')
  const ctx = ctxFor({ calcAfter: 'a + b + 0' })
  const file = 'C:/tmp/dope-tdd-live-x/probe/src/calc.js'
  const run = (edit, event) =>
    stream([init({ cwd: `${ROOT}\\home` }), use('t1', 'Edit', { file_path: file }), edit, end('x'), init({ cwd: `${ROOT}\\home` }), end(report(`8S AGO: ${event}`), true)])
  const outside = `outside this project, not guarded (${file})`
  assert.deepEqual(failed(A.check(readRun(run(answer('t1', UPDATED(file)), outside)), ctx)), [])
  assert.ok(failed(A.check(readRun(run(answer('t1', REFUSAL, true), 'blocked calc')), ctxFor())).length > 0, 'refusing an edit outside the project fails A')
  assert.ok(failed(A.check(readRun(run(answer('t1', UPDATED(file)), 'unguarded calc')), ctx)).length > 0, '/tdd not saying outside fails A')
})

test('B: an untested edit is refused, names the test, and leaves the file alone', () => {
  const B = byId('B')
  const run = edit => stream([init(), use('t1', 'Edit', { file_path: CALC }), edit, end('x'), init(), end(report('9S AGO: blocked calc'), true)])
  assert.deepEqual(failed(B.check(readRun(run(answer('t1', REFUSAL, true))), ctxFor())), [])
  assert.ok(failed(B.check(readRun(run(answer('t1', UPDATED(CALC)))), ctxFor({ calcAfter: 'a + b + 0' }))).length > 0, 'an edit that went through fails B')
  assert.ok(failed(B.check(readRun(stream([init(), end('I will not')])), ctxFor())).includes('the model called Edit on src/calc.js'), 'no Edit at all fails B, saying so')
})

test('B: in branch mode the build must be the checkout, by path and by sha', () => {
  const B = byId('B')
  const run = (plugin, line = report('9S AGO: blocked calc')) => stream([init({ plugins: [plugin] }), use('t1', 'Edit', { file_path: CALC }), answer('t1', REFUSAL, true), end(line, true)])
  const branch = { name: 'dope-tdd', path: CHECKOUT, source: 'dope-tdd@inline', version: '0.2.13' }
  const installed = { name: 'dope-tdd', path: 'C:\\plugins\\dope-tdd', source: 'dope-tdd@dope-tdd', version: '0.2.11' }
  assert.deepEqual(failed(B.check(readRun(run(branch)), ctxFor())), [])
  assert.ok(failed(B.check(readRun(run(installed)), ctxFor())).length > 0, 'the installed copy in branch mode fails')
  assert.ok(failed(B.check(readRun(run(branch, report().replace('ed5625b', 'fa2a8a2'))), ctxFor())).length > 0, 'another sha in branch mode fails')
  assert.deepEqual(failed(B.check(readRun(run(installed)), ctxFor({ mode: 'installed', checkoutSha: null }))), [], 'installed mode takes the installed copy')
  assert.ok(failed(B.check(readRun(run(branch)), ctxFor({ mode: 'installed', checkoutSha: null }))).length > 0, 'a --plugin-dir copy in installed mode fails')
})

const subagentRun = (cwd, editResult) =>
  stream([
    init({ cwd }),
    use('t1', 'Agent', { isolation: 'worktree', prompt: 'edit' }),
    use('t2', 'Read', { file_path: WORKTREE_CALC }, 't1'),
    answer('t2', '1\texport function add(a, b) {', false, 't1'),
    use('t3', 'Edit', { file_path: WORKTREE_CALC }, 't1'),
    editResult,
    answer('t1', [{ type: 'text', text: 'report' }]),
    end('report'),
  ])

for (const [id, cwd] of [
  ['C', PROBE],
  ['D', `${ROOT}\\linked`],
]) {
  test(`${id}: a worktree subagent's untested edit is refused, in a worktree under the main checkout`, () => {
    const s = byId(id)
    assert.deepEqual(failed(s.check(readRun(subagentRun(cwd, answer('t3', REFUSAL, true, 't1'))), ctxFor())), [])
    assert.ok(failed(s.check(readRun(subagentRun(cwd, answer('t3', UPDATED(WORKTREE_CALC), false, 't1'))), ctxFor())).length > 0, 'the 0.2.11 result fails')
    const underLinked = JSON.stringify(WORKTREE_CALC.replace('\\probe\\', '\\linked\\')).slice(1, -1)
    const elsewhere = subagentRun(cwd, answer('t3', REFUSAL, true, 't1')).replaceAll(JSON.stringify(WORKTREE_CALC).slice(1, -1), underLinked)
    assert.deepEqual(failed(s.check(readRun(elsewhere), ctxFor())), ["its worktree is under the main checkout's .claude/worktrees/agent-…"], 'a worktree under the linked checkout fails')
    const parentEdit = stream([init({ cwd }), use('t3', 'Edit', { file_path: WORKTREE_CALC }), answer('t3', REFUSAL, true), end('x')])
    assert.ok(failed(s.check(readRun(parentEdit), ctxFor())).length > 0, 'an edit by the main session, not a subagent, fails')
  })
}

test('E: with the plugin off the edit goes through and /tdd is not there', () => {
  const E = byId('E')
  const off = { plugins: [], slash_commands: ['pdf'] }
  const good = stream([init(off), use('t1', 'Edit', { file_path: CALC }), answer('t1', UPDATED(CALC)), end('x'), init(off), end('`/tdd` is not available')])
  assert.equal(E.plugin, 'off')
  assert.deepEqual(failed(E.check(readRun(good), ctxFor({ calcAfter: 'a + b + 0' }))), [])
  const on = stream([init(), use('t1', 'Edit', { file_path: CALC }), answer('t1', REFUSAL, true), end('x'), init(), end(report(), true)])
  assert.ok(failed(E.check(readRun(on), ctxFor())).length >= 3, 'a loaded plugin fails E on the plugin list, the edit and /tdd')
})
