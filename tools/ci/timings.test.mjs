// node --test tools/ci/timings.test.mjs
// The test-time report CI writes after `claude plugin test .`, on output whose numbers are known.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRun, renderTimings } from './timings.mjs'

const OUTPUT = [
  'tests\\catch.test.tsx:',
  '(pass) catch > first [1385.20ms]',
  '(pass) catch > second [40.00ms]',
  '(fail) catch > third [5012.00ms]',
  '  Error: timed out after 5000 ms',
  '',
  'tests/stats.test.ts:',
  '(pass) stats > a [2.00ms]',
  '(pass) stats > b [3.00ms]',
  '',
  ' 4 pass',
  ' 1 fail',
  'Ran 5 tests across 2 files. [9.50s]',
].join('\r\n')

test('reads each file, each test and its time, the failures and the run total', () => {
  const run = parseRun(OUTPUT)
  assert.equal(run.totalMs, 9500)
  assert.deepEqual(run.files.map(file => [file.name, file.tests.length, Math.round(file.ms)]), [
    ['catch.test.tsx', 3, 6437],
    ['stats.test.ts', 2, 5],
  ])
  assert.equal(run.files[0].tests[2].failed, true)
  assert.equal(run.timeouts, 1)
})

test('the report: the totals, the slowest files, every test over the threshold, and a warning for a timeout', () => {
  const text = renderTimings(parseRun(OUTPUT), { slowMs: 1000 })
  assert.match(text, /^## Test times/m)
  assert.match(text, /5 tests in 2 files, 9\.5 s\. Slowest test 5\.0 s; 2 over 1\.0 s\./)
  assert.match(text, /\| catch\.test\.tsx \| 3 \| 6\.4 s \| 5\.0 s \|/)
  assert.match(text, /- 5\.0 s catch > third \(failed\)/)
  assert.match(text, /- 1\.4 s catch > first/)
  assert.doesNotMatch(text, /stats > a/)
  assert.match(text, /\*\*1 test timed out\.\*\* A timeout is a time problem, not an assertion: compare with the slowest tests above\./)
})

test('a run with nothing slow says so plainly', () => {
  const text = renderTimings(parseRun('tests/a.test.ts:\n(pass) a [1.00ms]\nRan 1 tests across 1 files. [0.10s]\n'), { slowMs: 1000 })
  assert.match(text, /No test over 1\.0 s\./)
  assert.doesNotMatch(text, /timed out/)
})
