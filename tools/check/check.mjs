#!/usr/bin/env node
// `npm run check`: the suites CI runs, started at the same time, once before a pull request (the POSIX-root pass only
// with --all; see selectSuites). While working, run
// only the one test file being changed (README, Develop); this is the full pass, not the inner loop.
//
// Each suite's output is captured and printed whole when that suite finishes, never interleaved or trimmed, so its own
// summary line ("Ran N tests", "ℹ pass N") is always there to read. Then one line per suite, and a verdict that passes
// only when every suite exited 0.
//
// Usage: npm run check [-- --all]   (or: node tools/check/check.mjs [--all])
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const NODE = process.execPath

export const SUITES = [
  { name: 'validate', command: 'claude', args: ['plugin', 'validate', '.'] },
  { name: 'plugin test', command: 'claude', args: ['plugin', 'test', '.'] },
  {
    name: 'node --test',
    command: NODE,
    args: ['--import', './tests/node/register.mjs', '--test', 'tests/*.test.ts', 'tests/node/*.test.mjs'],
  },
  { name: 'posix root', command: NODE, args: ['tools/posix-root.mjs'], ci: true },
]

/**
 * The suites to run for these arguments. The POSIX-root pass is left to CI by default: it runs the same ~1000 kit
 * tests again, and beside `plugin test` the two compete for the CPU, so it doubles the local wait (about 35 s to 60 s)
 * to catch path bugs a Windows machine cannot produce anyway. CI runs it on every pull request; `--all` runs it here.
 */
export function selectSuites(argv) {
  let all = false
  for (const arg of argv) {
    if (arg === '--all') {
      all = true
    } else {
      throw new Error(`unknown option ${arg}; the only option is --all`)
    }
  }
  return SUITES.filter(suite => all || suite.ci !== true)
}

/** Runs every suite at once; resolves to { name, code, output, ms } per suite, in suite order. */
export async function runAll(suites, { run = runSuite, now = Date.now, print = () => {} } = {}) {
  return Promise.all(suites.map(async suite => {
    const start = now()
    let result
    try {
      result = await run(suite)
    } catch (error) {
      result = { code: 1, output: `dope-tdd: ${suite.name} could not run: ${error instanceof Error ? error.message : String(error)}\n` }
    }
    const done = { name: suite.name, code: result.code, output: result.output, ms: now() - start }
    print(`── ${suite.name} ──\n${done.output}${done.output.endsWith('\n') ? '' : '\n'}`)
    return done
  }))
}

/** One line per suite, then the verdict; exitCode is 0 only when every suite exited 0. */
export function renderReport(results, totalMs) {
  const width = Math.max(...results.map(result => result.name.length))
  const lines = results.map(result => {
    const verdict = result.code === 0 ? 'PASS' : 'FAIL'
    const exit = result.code === 0 ? '' : `  (exit ${result.code})`
    return `${verdict}  ${result.name.padEnd(width)}  ${seconds(result.ms)}${exit}`
  })
  const failed = results.filter(result => result.code !== 0)
  const passedCount = results.length - failed.length
  const tail = failed.length === 0 ? '' : `; failed: ${failed.map(result => result.name).join(', ')}`
  lines.push(`check: ${failed.length === 0 ? 'PASS' : 'FAIL'}, ${passedCount} of ${results.length} suites passed in ${seconds(totalMs)}${tail}`)
  return { text: lines.join('\n'), exitCode: failed.length === 0 ? 0 : 1 }
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`
}

function runSuite(suite) {
  return new Promise((resolve, reject) => {
    // `claude` is a .cmd shim on Windows, which only a shell can start. Node is spawned directly so the globs reach
    // `node --test` unexpanded on every platform, the way CI passes them.
    const shell = suite.command === 'claude' && process.platform === 'win32'
    const child = spawn(suite.command, suite.args, { cwd: PLUGIN, shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, output }))
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  let suites
  try {
    suites = selectSuites(process.argv.slice(2))
  } catch (error) {
    console.error(`dope-tdd: ${error.message}`)
    process.exit(2)
  }
  const start = Date.now()
  console.log(`dope-tdd: running ${suites.map(suite => suite.name).join(', ')} at once`)
  const results = await runAll(suites, { print: text => process.stdout.write(text) })
  const report = renderReport(results, Date.now() - start)
  const skipped = SUITES.filter(suite => !suites.includes(suite)).map(suite => suite.name)
  const note = skipped.length === 0 ? '' : `\nskipped: ${skipped.join(', ')} (CI runs it; npm run check -- --all to run it here)`
  console.log(`\n${report.text}${note}`)
  process.exitCode = report.exitCode
}
