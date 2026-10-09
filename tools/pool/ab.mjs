#!/usr/bin/env node
// The A/B launcher: one task, two fresh headless agents in two throwaway
// worktrees of the same repository, one with Dope TDD observing, one with it
// enforcing. Writes both receipts side by side, and one ledger line per run,
// so every experiment's cost and finding is on record.
//
//   node tools/pool/ab.mjs --repo C:/path/to/clone --task task.txt \
//     --allow "Bash(npx vitest*)" [--allow ...] [--setup "npm ci"] \
//     [--config '{"layout":"flat"}'] [--model claude-sonnet-5-5] [--max-turns 40]
//     [--modes observe,enforce] [--ref upstream/main] [--keep]
//
// Nothing is committed or pushed. Worktrees are removed afterwards unless
// --keep is given. The ledger and reports live outside every repository, in
// ~/.dope-tdd/pool, because task text names private code.

import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = { ref: 'HEAD', allow: [], modes: ['observe', 'enforce'], model: 'claude-sonnet-5-5', maxTurns: 40, keep: false, config: '{}' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const next = () => argv[++i]
    if (key === '--repo') args.repo = resolve(next())
    else if (key === '--task') args.task = resolve(next())
    else if (key === '--allow') args.allow.push(next())
    else if (key === '--setup') args.setup = next()
    else if (key === '--config') args.config = next()
    else if (key === '--model') args.model = next()
    else if (key === '--max-turns') args.maxTurns = Number(next())
    else if (key === '--modes') args.modes = next().split(',')
    else if (key === '--ref') args.ref = next()
    else if (key === '--keep') args.keep = true
    else throw new Error(`unknown argument ${key}`)
  }
  if (!args.repo || !args.task) throw new Error('--repo and --task are required')
  return args
}

const RECEIPT_ASK = `

When you are done, call the mcp__dope-tdd__status tool and print its full output verbatim under the heading RECORD, then in four sentences say what you changed, how you know it works, and anything about the tooling that got in your way.`

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
}

/** The receipt block the agent printed, and the counts in it. */
export function readReceipt(text) {
  const block = /```\w*\s*\n(dope-tdd\r?\n[\s\S]*?)\n```/.exec(text ?? '')?.[1] ?? null
  const number = (pattern) => {
    const match = block === null ? null : pattern.exec(block)
    return match === null ? null : Number(match[1])
  }
  return {
    block,
    blocked: number(/blocked (\d+)/),
    unguarded: number(/unguarded (\d+)/),
    caught: number(/caught (\d+)/),
    missed: number(/missed (\d+)/),
    proven: number(/proven (\d+)/),
    workarounds: block === null ? null : (number(/workarounds: (\d+)/) ?? 0),
    testFirst: /test-first: (\d+\/\d+)/.exec(block ?? '')?.[1] ?? null,
  }
}

/** The claude executable. On Windows the npm shim is a .cmd that cmd.exe would re-split, so run the .exe it points at. */
function claudeBinary() {
  if (process.platform !== 'win32') return 'claude'
  const shim = execFileSync('where', ['claude.cmd'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  const exe = join(dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return existsSync(exe) ? exe : shim
}

function runAgent(cwd, prompt, args) {
  return new Promise(done => {
    const tools = ['Read', 'Grep', 'Glob', 'Edit', 'Write', ...args.allow, 'mcp__dope-tdd__status'].join(',')
    // The prompt goes in on stdin, so no shell ever splits it.
    const child = spawn(claudeBinary(), ['-p', '--model', args.model, '--allowedTools', tools, '--max-turns', String(args.maxTurns), '--output-format', 'json'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end(prompt)
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.stderr.on('data', chunk => (err += chunk))
    child.on('close', code => {
      try {
        done({ code, json: JSON.parse(out), stderr: err })
      } catch {
        done({ code, json: null, stderr: err || out })
      }
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const task = readFileSync(args.task, 'utf8').trim()
  const repoName = basename(args.repo)
  const id = `${repoName}-${stamp()}`
  const head = git(args.repo, 'rev-parse', '--short', args.ref)
  const poolDir = join(homedir(), '.dope-tdd', 'pool')
  mkdirSync(poolDir, { recursive: true })
  const baseConfig = JSON.parse(args.config)

  const legs = args.modes.map(mode => ({ mode, dir: resolve(args.repo, '..', `${repoName}-ab-${mode}-${stamp()}`) }))
  for (const leg of legs) {
    git(args.repo, 'worktree', 'add', '--detach', leg.dir, args.ref)
    writeFileSync(join(leg.dir, 'dope-tdd.json'), `${JSON.stringify({ ...baseConfig, mode: leg.mode }, null, 2)}\n`)
    const exclude = join(git(leg.dir, 'rev-parse', '--git-common-dir'), 'info', 'exclude')
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (!current.split(/\r?\n/).includes('dope-tdd.json')) appendFileSync(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}dope-tdd.json\n`)
    if (args.setup) execFileSync(args.setup, { cwd: leg.dir, stdio: 'ignore', shell: true })
    console.log(`ready: ${leg.mode} at ${leg.dir}`)
  }

  const started = Date.now()
  const prompt = task.includes('mcp__dope-tdd__status') ? task : task + RECEIPT_ASK
  const results = await Promise.all(legs.map(leg => runAgent(leg.dir, prompt, args).then(run => ({ ...leg, ...run }))))

  const rows = results.map(leg => {
    const json = leg.json ?? {}
    const receipt = readReceipt(json.result)
    const diff = git(leg.dir, 'diff', '--stat')
    const untracked = git(leg.dir, 'ls-files', '--others', '--exclude-standard')
    return { ...leg, receipt, diff, untracked, cost: json.total_cost_usd ?? null, turns: json.num_turns ?? null, ms: json.duration_ms ?? null, denials: (json.permission_denials ?? []).length, summary: json.result ?? leg.stderr }
  })

  for (const row of rows) {
    appendFileSync(
      join(poolDir, 'ledger.jsonl'),
      `${JSON.stringify({
        id,
        at: new Date(started).toISOString(),
        repo: repoName,
        head,
        mode: row.mode,
        model: args.model,
        task: basename(args.task),
        exit: row.code,
        costUsd: row.cost,
        turns: row.turns,
        durationMs: row.ms,
        permissionDenials: row.denials,
        testFirst: row.receipt.testFirst,
        blocked: row.receipt.blocked,
        unguarded: row.receipt.unguarded,
        caught: row.receipt.caught,
        missed: row.receipt.missed,
        proven: row.receipt.proven,
        workarounds: row.receipt.workarounds,
        filesChanged: (row.diff.match(/\n?\s*\S+\s+\|/g) ?? []).length + (row.untracked === '' ? 0 : row.untracked.split('\n').length),
      })}\n`,
    )
  }

  const report = [
    `# A/B ${id}`,
    '',
    `Repo ${repoName} at ${head}, model ${args.model}, task ${basename(args.task)}.`,
    '',
    '| | ' + rows.map(row => row.mode).join(' | ') + ' |',
    '| --- | ' + rows.map(() => '---').join(' | ') + ' |',
    ...[
      ['test-first', row => row.receipt.testFirst ?? '?'],
      ['blocked', row => row.receipt.blocked ?? '?'],
      ['unguarded', row => row.receipt.unguarded ?? '?'],
      ['caught / proven / missed', row => (row.receipt.caught === null ? 'off' : `${row.receipt.caught} / ${row.receipt.proven} / ${row.receipt.missed}`)],
      ['workarounds', row => row.receipt.workarounds ?? 0],
      ['turns', row => row.turns ?? '?'],
      ['cost (USD, list price)', row => (row.cost === null ? '?' : row.cost.toFixed(2))],
      ['minutes', row => (row.ms === null ? '?' : (row.ms / 60000).toFixed(1))],
    ].map(([label, cell]) => `| ${label} | ${rows.map(cell).join(' | ')} |`),
    '',
    ...rows.flatMap(row => [`## ${row.mode}`, '', '```', row.receipt.block ?? '(no receipt printed)', '```', '', '```', row.diff || '(no tracked changes)', row.untracked ? `untracked:\n${row.untracked}` : '', '```', '', row.summary ?? '', '']),
  ].join('\n')
  const reportPath = join(poolDir, `${id}.md`)
  writeFileSync(reportPath, report)
  console.log(report)
  console.log(`\nreport: ${reportPath}\nledger: ${join(poolDir, 'ledger.jsonl')}`)

  if (!args.keep) {
    for (const leg of legs) {
      execFileSync('git', ['worktree', 'remove', '--force', leg.dir], { cwd: args.repo, stdio: 'ignore' })
    }
    console.log('worktrees removed')
  } else {
    console.log(`kept: ${legs.map(leg => leg.dir).join(', ')}`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(String(error?.stack ?? error))
    process.exit(1)
  })
}
