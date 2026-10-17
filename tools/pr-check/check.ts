// The pull-request check: Dope TDD's catch check, run on a pull request instead of inside an agent's session, so it
// covers any agent (Claude Code or not), local or cloud, and any person. For each source file the pull request
// changes, it finds that module's test, runs it on the pull request as it stands, puts back the base's version of
// the source, runs the test again and expects it to fail, then restores the file:
//   CAUGHT     the test fails without the change: it checks what the pull request changed
//   MISSED     the test passes without the change: nothing checks it
//   UNTESTED   no test for that module was found
//   UNVERIFIED it could not tell, and says why
//   MOVED      a new file whose code came from another file unchanged, by the move check (identical, renamed or
//              with new parameters); its own new code is named as not checked. Never a failure.
// Tests that already fail on the pull request are judged by name: only a test failing beyond them counts.
//
//   npx tsx tools/pr-check/check.ts --base origin/main [--repo .] [--fail-on missed|untested|never]
//
// The repository must be checked out at the pull request's head with a clean working tree; the project's
// dependencies must be installed. The same rules as the plugin: dope-tdd.json, the stack's layouts and runners.

import { spawnSync, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { catchOutcome, runnerArgv } from '../../hooks/catchCheck'
import type { RunFailure, RunResult } from '../../hooks/catchCheck'
import { CONFIG_FILE, parseConfig, policyFor } from '../../hooks/config'
import type { GuardConfig } from '../../hooks/config'
import { findRunner } from '../../hooks/findRunner'
import { importCandidates } from '../../hooks/imports'
import { classifyPath, relativePath, testFileFor } from '../../hooks/mirror'
import { failedTestsIn } from '../../hooks/runners'
import { declarations, findMoves } from '../move-check/move'
import type { Move, Rename } from '../move-check/move'
import { detectStackFrom, stackOf } from '../../hooks/stacks'

type Verdict = 'CAUGHT' | 'MISSED' | 'MOVED' | 'UNTESTED' | 'UNVERIFIED'
type Row = { module: string; source: string; test: string | null; verdict: Verdict; note: string }

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

function run(argv: string[], cwd: string, timeoutMs: number): RunResult | RunFailure {
  const [program, ...rest] = argv
  if (program === undefined) return { failedToStart: 'no command' }
  const result = spawnSync(program, rest, { cwd, env: { ...process.env, CI: '1' }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(program) })
  if (result.error !== undefined) return /ETIMEDOUT/.test(String(result.error)) ? 'timeout' : { failedToStart: result.error.message }
  if (result.status === null) return 'timeout'
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status }
}

/** The test for a module: a test the pull request changed for it, one that imports it, or its paired test file. */
function testFor(root: string, config: GuardConfig, module: string, changedTests: readonly string[]): string | null {
  for (const test of changedTests) {
    const target = classifyPath(root, `${root}/${test}`, config)
    if (target.kind === 'test' && target.module === module) return test
  }
  for (const test of changedTests) {
    const text = readFileSync(`${root}/${test}`, 'utf8')
    for (const candidate of importCandidates(test, text, config.stack)) {
      const target = classifyPath(root, `${root}/${candidate}`, config)
      if (target.kind === 'source' && target.module === module && existsSync(`${root}/${candidate}`)) return test
    }
  }
  for (const ext of stackOf(config.stack).exts) {
    const paired = testFileFor(config, module, ext)
    if (existsSync(`${root}/${paired}`)) return paired
  }
  return null
}

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/**
 * What the move check says about a source file the pull request added (#40): MOVED when code moved into it from
 * another file and none of it differs, naming the new code beside it; a note on the difference when some does; null
 * when nothing moved into it.
 */
export function movedRow(moves: readonly Move[], target: string, targetText: string): { verdict: 'MOVED'; note: string } | { note: string } | null {
  const into = moves.filter(move => move.to === target)
  if (into.length === 0) return null
  const differs = into.filter(move => move.result.verdict === 'DIFFERS')
  if (differs.length > 0) {
    return { note: `moved code differs: ${differs.map(move => `\`${move.name}\` ${move.result.verdict === 'DIFFERS' ? move.result.difference : ''}`).join('; ')}` }
  }
  const renamed = (renames: readonly Rename[]) => renames.map(rename => `\`${rename.from}\` → \`${rename.to}\`${rename.explicit === true ? ' (given)' : ''}`).join(', ')
  const each = into.map(move => {
    const result = move.result
    if (result.verdict === 'RENAMED') return `\`${move.name}\` renamed (${renamed(result.renames)})`
    if (result.verdict === 'SIGNATURE') {
      const body = result.renames.length === 0 ? '' : `; ${renamed(result.renames)}`
      return `\`${move.name}\` with new parameters (\`${result.parameters.before}\` → \`${result.parameters.after}\`${body})`
    }
    return `\`${move.name}\` identical`
  })
  const from = [...new Set(into.map(move => move.from))].join(', ')
  const moved = new Set(into.map(move => move.name))
  const added = declarations(targetText).filter(decl => !moved.has(decl.name)).map(decl => `\`${decl.name}\``)
  return { verdict: 'MOVED', note: `moved from ${from}: ${each.join(', ')}${added.length === 0 ? '' : `; new here, not checked: ${added.join(', ')}`}` }
}

async function checkModule(root: string, config: GuardConfig, base: string, source: string, module: string, test: string | null, timeoutMs: number, moves: readonly Move[]): Promise<Row> {
  const moved = existsSync(`${root}/${source}`) ? movedRow(moves, source, readFileSync(`${root}/${source}`, 'utf8')) : null
  if (moved !== null && 'verdict' in moved) return { module, source, test, verdict: 'MOVED', note: moved.note }
  const checked = await catchCheckModule(root, config, base, source, module, test, timeoutMs)
  return moved === null ? checked : { ...checked, note: `${checked.note}; ${moved.note}` }
}

async function catchCheckModule(root: string, config: GuardConfig, base: string, source: string, module: string, test: string | null, timeoutMs: number): Promise<Row> {
  const row = (verdict: Verdict, note: string): Row => ({ module, source, test, verdict, note })
  if (test === null) return row('UNTESTED', 'no test for this module in the pull request or beside it')
  let before: string
  try {
    before = execFileSync('git', ['show', `${base}:${source}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return row('UNVERIFIED', 'a new file: there is no base version to put back')
  }
  const after = readFileSync(`${root}/${source}`, 'utf8')
  if (before === after) return row('UNVERIFIED', 'unchanged against the base')
  const runner = await findRunner(
    root,
    config.stack,
    `${root}/${test}`,
    path => Promise.resolve(existsSync(path)),
    path => Promise.resolve(existsSync(path) ? readFileSync(path, 'utf8') : null),
  )
  if (runner === null) return row('UNVERIFIED', 'no test runner found')
  const runIn = runner.root !== root && runner.root.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? runner.root : root
  const relativeTest = relativePath(runIn, `${root}/${test}`)
  const godot = config.godot ?? process.env.GODOT_BIN ?? null
  const argv = runnerArgv(runner.root, runner.kind, relativeTest, runner.tool, { godot, ...(runner.launcher === undefined ? {} : { launcher: runner.launcher }) })

  // The pull request as it stands: tests failing here are the known failures, and only a failure beyond them counts.
  const baseline = run(argv, runIn, timeoutMs)
  const known = typeof baseline === 'object' && 'stdout' in baseline ? failedTestsIn(`${baseline.stdout}\n${baseline.stderr}`) : []
  const standing = catchOutcome(baseline, relativeTest, known)
  if (standing.kind !== 'missed') {
    return row('UNVERIFIED', standing.kind === 'unverified' ? `the test does not run cleanly on the pull request: ${standing.reason}` : 'the test is red on the pull request')
  }
  writeFileSync(`${root}/${source}`, before)
  try {
    const outcome = catchOutcome(run(argv, runIn, timeoutMs), relativeTest, known)
    const kept = known.length === 0 ? '' : `; ${known.length} test${known.length === 1 ? ' was' : 's were'} already failing on the pull request and did not count`
    if (outcome.kind === 'caught') return row('CAUGHT', `the test fails without the change${kept}`)
    if (outcome.kind === 'missed') return row('MISSED', `the test still passes without the change${kept}`)
    return row('UNVERIFIED', outcome.kind === 'unverified' ? outcome.reason : outcome.kind)
  } finally {
    writeFileSync(`${root}/${source}`, after)
  }
}

export function report(rows: readonly Row[], base: string): string {
  const count = (verdict: Verdict) => rows.filter(row => row.verdict === verdict).length
  return [
    '## Dope TDD: do the tests catch this change?',
    '',
    rows.length === 0
      ? 'No source file in this pull request is one the project guards.'
      : `${count('CAUGHT')} caught · ${count('MISSED')} missed · ${count('MOVED')} moved · ${count('UNTESTED')} untested · ${count('UNVERIFIED')} unverified, against ${base}.`,
    '',
    ...(rows.length === 0
      ? []
      : ['| Module | Test | Verdict | Why |', '| --- | --- | --- | --- |', ...rows.map(row => `| ${row.module} | ${row.test ?? '—'} | **${row.verdict}** | ${row.note} |`)]),
    '',
    'CAUGHT: with the base version of the source put back, the test fails, so it checks what this pull request changed. MISSED: it still passes, so nothing checks the change. MOVED: a new file whose code came from another file unchanged (the move check), so there was nothing new to test in that code.',
    '',
  ].join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const value = (flag: string) => {
    const at = argv.indexOf(flag)
    return at === -1 ? undefined : argv[at + 1]
  }
  const root = resolve(value('--repo') ?? '.').replace(/\\/g, '/')
  const baseRef = value('--base')
  const failOn = value('--fail-on') ?? 'missed'
  const timeoutMs = Number(value('--timeout-ms') ?? 180_000)
  if (baseRef === undefined) throw new Error('--base is required (the branch the pull request goes into)')
  if (lines(git(root, 'status', '--porcelain', '--untracked-files=no')).length > 0) {
    throw new Error('the working tree has uncommitted changes: check out the pull request head with a clean tree')
  }
  const base = git(root, 'merge-base', baseRef, 'HEAD')
  const changed = lines(git(root, 'diff', '--name-only', '--diff-filter=AMR', base, 'HEAD'))
  const configText = existsSync(`${root}/${CONFIG_FILE}`) ? readFileSync(`${root}/${CONFIG_FILE}`, 'utf8') : null
  const config = parseConfig(configText, detectStackFrom(readdirSync(root)) ?? undefined)
  const tests = changed.filter(path => classifyPath(root, `${root}/${path}`, config).kind === 'test')
  // Moved code, for the new files: every changed code file as it was at the base and as it is now.
  const renames = argv.flatMap((arg, at) => (arg === '--rename' && argv[at + 1] !== undefined ? [argv[at + 1] as string] : [])).map(pair => {
    const split = pair.indexOf('=')
    if (split <= 0) throw new Error(`--rename needs old=new, got ${pair}`)
    return { from: pair.slice(0, split), to: pair.slice(split + 1) }
  })
  const code = lines(git(root, 'diff', '--name-only', base, 'HEAD')).filter(path => CODE.test(path))
  const side = (read: (path: string) => string | null) => Object.fromEntries(code.flatMap(path => ((text => (text === null ? [] : [[path, text] as const]))(read(path)))))
  const atBase = side(path => {
    try {
      return execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  })
  const moves = findMoves(atBase, side(path => (existsSync(`${root}/${path}`) ? readFileSync(`${root}/${path}`, 'utf8') : null)), renames)
  const rows: Row[] = []
  for (const path of changed) {
    const target = classifyPath(root, `${root}/${path}`, config)
    if (target.kind !== 'source' || policyFor(config, path) === 'exempt') continue
    rows.push(await checkModule(root, config, base, path, target.module, testFor(root, config, target.module, tests), timeoutMs, moves))
  }
  const text = report(rows, `${baseRef} (${base.slice(0, 7)})`)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  const failing = rows.some(row => row.verdict === 'MISSED' || (failOn === 'untested' && row.verdict === 'UNTESTED'))
  process.exitCode = failOn !== 'never' && failing ? 1 : 0
}

if (process.argv[1] !== undefined && /check\.ts$/.test(process.argv[1])) {
  main().catch(error => {
    console.error(`dope-tdd pr-check: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  })
}
