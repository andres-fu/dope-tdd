#!/usr/bin/env node
// `npm run live`: real headless Claude Code sessions against throwaway probe repos, checked against what dope-tdd must
// do (tools/live/scenarios.mjs). No fake engine can show how Claude Code itself loads the plugin, picks a project root,
// or places a subagent's worktree; these runs can. Each one spends model turns, so this is not part of `npm run check`
// or CI: run it before a release, and after touching roots, worktrees, the shell gate or config loading (CONTRIBUTING).
//
// The scenarios run at the same time, each in its own probe under the OS temp folder, removed afterwards with any
// worktree a subagent left, dope-tdd's session records of those sessions and Claude Code's transcripts of them. A
// failed scenario prints what the session did and keeps its stream-json transcript to read.
//
// Usage: npm run live [-- --installed] [-- --only A,D] [-- --model <name>]
//   default      the build in this checkout, by --plugin-dir, with the installed dope-tdd turned off
//   --installed  the dope-tdd Claude Code has installed
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { formatResult } from './checks.mjs'
import { cleanup, dropSessionRecords, dropTranscripts, makeRoot, readCalc } from './probe.mjs'
import { dirOf, scenarios } from './scenarios.mjs'
import { describeRun, readRun, userMessages } from './stream.mjs'

const CHECKOUT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
// A run that hangs (a prompt the model will not finish) is cut off; a real one takes one to two minutes.
const TIMEOUT_MS = 400_000

/** Settings that turn the marketplace install of dope-tdd off, for a session that must not load it. */
export const OFF_SETTINGS = JSON.stringify({ enabledPlugins: { 'dope-tdd@dope-tdd': false } })

export function parseArgs(argv) {
  const options = { mode: 'branch', only: null, model: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--installed') {
      options.mode = 'installed'
    } else if (arg === '--only' || arg === '--model') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      if (arg === '--model') {
        options.model = value
      } else {
        options.only = value.split(',').map(id => id.trim().toUpperCase())
        for (const id of options.only) {
          if (!scenarios.some(s => s.id === id)) throw new Error(`unknown scenario ${id}; the scenarios are ${scenarios.map(s => s.id).join(', ')}`)
        }
      }
    } else {
      throw new Error(`unknown option ${arg}; the options are --installed, --only <ids> and --model <name>`)
    }
  }
  return options
}

/**
 * The flags for one session. Branch mode loads this checkout by --plugin-dir and turns the installed copy off, so the
 * two cannot both answer; installed mode adds neither. A scenario with the plugin off only turns the installed copy off.
 */
export function claudeArgs({ mode, plugin, checkout, settings, model, tools = [], maxTurns = 10 }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']
  args.push('--allowedTools', 'Read', 'Edit', 'Agent', ...tools, '--max-turns', String(maxTurns))
  if (plugin === 'off' || mode === 'branch') args.push('--settings', settings)
  if (plugin === 'on' && mode === 'branch') args.push('--plugin-dir', checkout)
  if (model !== null) args.push('--model', model)
  return args
}

// On Windows `claude` is a .cmd shim, which only a shell can start, so it gets one command line with any spaced path
// quoted. The arguments are this file's own flags and paths; the prompts go in on stdin.
const WINDOWS = process.platform === 'win32'
const quote = arg => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)

function runClaude(cwd, args, input) {
  return new Promise(resolve => {
    const stdio = ['pipe', 'pipe', 'pipe']
    const child = WINDOWS ? spawn(['claude', ...args.map(quote)].join(' '), { cwd, shell: true, stdio }) : spawn('claude', args, { cwd, stdio })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      stderr += `\n(stopped after ${TIMEOUT_MS / 1000} s)`
      child.kill()
    }, TIMEOUT_MS)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => { stderr += String(error) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

async function runScenario(scenario, options, checkoutSha, transcripts) {
  const { root, probe } = makeRoot(scenario.setup ?? scenario.cwd)
  try {
    const settings = join(root, 'settings.json')
    writeFileSync(settings, OFF_SETTINGS)
    const ctx = { mode: options.mode, checkout: CHECKOUT, checkoutSha, root, probe, calcBefore: readCalc(probe) }
    const args = claudeArgs({ mode: options.mode, plugin: scenario.plugin, checkout: CHECKOUT, settings, model: options.model, tools: scenario.tools, maxTurns: scenario.maxTurns })
    const { code, stdout, stderr } = await runClaude(dirOf(ctx, scenario.cwd), args, userMessages(scenario.messages(ctx)))
    const run = readRun(stdout)
    ctx.calcAfter = readCalc(probe)
    dropSessionRecords(join(homedir(), '.dope-tdd', 'sessions'), run.inits.map(init => init.sessionId))
    const checks = scenario.check(run, ctx)
    const ok = checks.every(c => c.ok)
    const lines = formatResult(scenario.id, scenario.title, checks)
    if (!ok) {
      const transcript = join(transcripts(), `${scenario.id}.jsonl`)
      writeFileSync(transcript, stdout)
      lines.push(`  claude exited ${code}; what the session did (transcript: ${transcript}):`, ...describeRun(run).map(line => `    ${line}`))
      if (stderr.trim() !== '') lines.push('  stderr:', ...stderr.trim().split('\n').slice(-10).map(line => `    ${line}`))
    }
    return { ok, lines, cost: run.cost }
  } finally {
    cleanup(root)
    dropTranscripts(join(homedir(), '.claude', 'projects'), root)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const chosen = scenarios.filter(s => options.only === null || options.only.includes(s.id))
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CHECKOUT, encoding: 'utf8' }).trim()
  const build = options.mode === 'branch' ? `this checkout at ${checkoutSha.slice(0, 7)}` : 'the installed dope-tdd'
  console.log(`live: ${chosen.length} scenario(s) against ${build}, at the same time; each takes a minute or two and spends model turns`)
  let folder = null
  const transcripts = () => (folder ??= mkdtempSync(join(tmpdir(), 'dope-tdd-live-transcripts-')))
  const results = await Promise.all(
    chosen.map(s =>
      runScenario(s, options, checkoutSha, transcripts).then(result => {
        console.log(result.lines.join('\n'))
        return result
      }),
    ),
  )
  const failed = results.filter(r => !r.ok).length
  const cost = results.reduce((sum, r) => sum + r.cost, 0)
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`live: ${results.length - failed} passed, ${failed} failed · ${seconds} s · $${cost.toFixed(2)} of model use`)
  process.exitCode = failed === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`live: ${error.message}`)
    process.exitCode = 2
  })
}
