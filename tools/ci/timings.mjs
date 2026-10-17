// The test-time report: where `claude plugin test .` spends its time, written to the CI job summary on every run so a
// slow test shows up in the pull request that made it slow, not weeks later as a flaky timeout.
//
//   claude plugin test . | tee test-output.txt
//   node tools/ci/timings.mjs test-output.txt [--slow-ms 1000]
//
// Each live test pays for the kit loading the whole hooks module again (about 120 ms on a fast machine); a file whose
// tests creep towards the kit's timeout is the signal to look at.

import { appendFileSync, readFileSync } from 'node:fs'

const FILE = /^(?:tests[\\/])?(\S+\.test\.tsx?):$/
const TEST = /^\((pass|fail)\) (.+) \[([\d.]+)ms\]$/
const TOTAL = /^Ran \d+ tests? across \d+ files?\. \[([\d.]+)s\]$/
const TIMED_OUT = /timed out after \d+ ms/

/** The files, their tests with times, the timeouts and the run's total, from the kit's output. */
export function parseRun(output) {
  const files = []
  let timeouts = 0
  let totalMs = null
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const file = FILE.exec(line)
    if (file !== null) {
      files.push({ name: file[1], tests: [], ms: 0 })
      continue
    }
    const test = TEST.exec(line)
    if (test !== null && files.length > 0) {
      const current = files[files.length - 1]
      const ms = Number(test[3])
      current.tests.push({ name: test[2], ms, failed: test[1] === 'fail' })
      current.ms += ms
      continue
    }
    if (TIMED_OUT.test(line)) timeouts++
    const total = TOTAL.exec(line.trim())
    if (total !== null) totalMs = Number(total[1]) * 1000
  }
  return { files, timeouts, totalMs }
}

const seconds = ms => `${(ms / 1000).toFixed(1)} s`

/** The report: totals, the slowest files, each test over `slowMs`, and a warning when any test timed out. */
export function renderTimings(run, { slowMs = 1000 } = {}) {
  const tests = run.files.flatMap(file => file.tests)
  const slowest = tests.reduce((max, test) => Math.max(max, test.ms), 0)
  const slow = tests.filter(test => test.ms > slowMs).sort((a, b) => b.ms - a.ms)
  const total = run.totalMs === null ? '' : `, ${seconds(run.totalMs)}`
  const lines = [
    '## Test times',
    '',
    `${tests.length} tests in ${run.files.length} files${total}. Slowest test ${seconds(slowest)}; ${slow.length} over ${seconds(slowMs)}.`,
    '',
    '| File | Tests | Total | Slowest |',
    '| --- | --- | --- | --- |',
    ...[...run.files]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10)
      .map(file => `| ${file.name} | ${file.tests.length} | ${seconds(file.ms)} | ${seconds(file.tests.reduce((max, test) => Math.max(max, test.ms), 0))} |`),
    '',
    ...(slow.length === 0
      ? [`No test over ${seconds(slowMs)}.`]
      : [`Tests over ${seconds(slowMs)}:`, '', ...slow.slice(0, 20).map(test => `- ${seconds(test.ms)} ${test.name}${test.failed ? ' (failed)' : ''}`)]),
    ...(run.timeouts === 0
      ? []
      : ['', `**${run.timeouts} test${run.timeouts === 1 ? '' : 's'} timed out.** A timeout is a time problem, not an assertion: compare with the slowest tests above.`]),
    '',
  ]
  return lines.join('\n')
}

if (process.argv[1] !== undefined && /timings\.mjs$/.test(process.argv[1])) {
  const [path, ...rest] = process.argv.slice(2)
  const at = rest.indexOf('--slow-ms')
  const slowMs = at === -1 ? 1000 : Number(rest[at + 1])
  const text = renderTimings(parseRun(readFileSync(path, 'utf8')), { slowMs })
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
