// node --test tools/check/check.test.mjs
// `npm run check`: the four suites at once, each one's own output kept whole, then one line per suite and a verdict.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SUITES, renderReport, runAll, selectSuites } from './check.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('the four suites CI runs, by name', () => {
  assert.deepEqual(SUITES.map(suite => suite.name), ['validate', 'plugin test', 'node --test', 'posix root'])
})

test('validate is as strict here as in CI, so a warning fails before a push does', () => {
  assert.ok(SUITES.find(suite => suite.name === 'validate').args.includes('--strict'))
})

test('by default skips the POSIX-root pass, which CI runs on every pull request; --all puts it back', () => {
  assert.deepEqual(selectSuites([]).map(suite => suite.name), ['validate', 'plugin test', 'node --test'])
  assert.deepEqual(selectSuites(['--all']).map(suite => suite.name), SUITES.map(suite => suite.name))
})

test('an unknown flag is an error, so a typo never quietly runs less', () => {
  assert.throws(() => selectSuites(['--al']), /unknown option --al/)
})

test('starts every suite before any finishes, and hands each result back in suite order', async () => {
  const started = []
  const finished = []
  const run = async suite => {
    started.push(suite.name)
    await sleep(suite.ms)
    finished.push(suite.name)
    return { code: 0, output: `${suite.name} done\n` }
  }
  const suites = [{ name: 'slow', ms: 40 }, { name: 'fast', ms: 5 }]
  const results = await runAll(suites, { run, now: () => 0 })
  assert.deepEqual(started, ['slow', 'fast'])
  assert.deepEqual(finished, ['fast', 'slow'])
  assert.deepEqual(results.map(result => result.name), ['slow', 'fast'])
})

test('a suite that cannot start is a failure with the reason, not a crash', async () => {
  const run = async () => {
    throw new Error('spawn claude ENOENT')
  }
  const [result] = await runAll([{ name: 'validate' }], { run, now: () => 0 })
  assert.equal(result.code, 1)
  assert.match(result.output, /could not run: spawn claude ENOENT/)
})

test('each result is printed whole as it finishes, so its summary line is never cut', async () => {
  const printed = []
  const output = 'line one\nℹ pass 12\nℹ fail 0\n'
  await runAll([{ name: 'node --test' }], { run: async () => ({ code: 0, output }), now: () => 0, print: text => printed.push(text) })
  assert.equal(printed.length, 1)
  assert.match(printed[0], /^── node --test ──/)
  assert.ok(printed[0].includes(output))
})

test('times each suite', async () => {
  let clock = 0
  const run = async () => {
    clock += 2500
    return { code: 0, output: '' }
  }
  const [result] = await runAll([{ name: 'validate' }], { run, now: () => clock })
  assert.equal(result.ms, 2500)
})

test('the report: one line per suite with its time, and pass only when every suite passed', () => {
  const passed = renderReport([
    { name: 'validate', code: 0, ms: 3200 },
    { name: 'plugin test', code: 0, ms: 35100 },
  ], 36000)
  assert.equal(passed.exitCode, 0)
  assert.match(passed.text, /PASS {2}validate +3\.2 s/)
  assert.match(passed.text, /PASS {2}plugin test +35\.1 s/)
  assert.match(passed.text, /check: PASS, 2 of 2 suites passed in 36\.0 s/)

  const failed = renderReport([
    { name: 'validate', code: 0, ms: 3200 },
    { name: 'posix root', code: 2, ms: 34000 },
  ], 34000)
  assert.equal(failed.exitCode, 1)
  assert.match(failed.text, /FAIL {2}posix root +34\.0 s {2}\(exit 2\)/)
  assert.match(failed.text, /check: FAIL, 1 of 2 suites passed in 34\.0 s; failed: posix root/)
})
