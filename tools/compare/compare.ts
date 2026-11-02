#!/usr/bin/env node
// `npm run compare`: what a change does to dope-tdd's behaviour, measured against a base. Tests say the code does what
// someone thought of; this says what else moved in what it covers: which files `findSourceWrites` reads from real
// commands, and the briefing, band, /tdd and an Edit of an untested file in fake-engine sessions. The rest of shell
// handling, test runs and the catch check show on neither. Run it before the first review of a change it can see.
//
//   npm run compare                        real commands from your own session logs, through both builds (seconds)
//   npm run compare -- --sessions          also about 16,000 fake-engine sessions on both builds (about 17 minutes)
//   npm run compare -- --base <ref>        against that ref, origin/release by default, as it stands: this doesn't fetch
//   npm run compare -- --transcripts <dir> session logs from there, ~/.claude/projects by default
//
// The commands are read where they are and never saved. The report prints them: read it locally, and do not paste it
// anywhere public without reading it first. It exits non-zero when it proved less than it should (report.ts, problemsIn),
// never for a difference: whether a difference is right is for the person reading it. Both builds are throwaway copies,
// removed afterwards, on Ctrl-C too.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { shellCalls, transcriptFiles } from '../replay/replay.ts'
import { ALL } from './plan.ts'
import { compareReadings, compareSessions, formatReadings, formatSessions, parseArgs, problemsIn, readSessions, sameFiles } from './report.ts'
import type { Compared, Reader, Session } from './report.ts'

const CHECKOUT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const BUILD = ['hooks', 'types', 'package.json', 'tsconfig.json', 'dope-tdd.json', '.claude-plugin']
// Read from the project's root and from a folder inside it, since a relative path lands differently from each.
const FOLDERS = ['/r', '/r/src/app']
// The kit cuts a test file off at ten minutes, so the sessions run as batches of small files.
const BATCHES = 4
const FILES_PER_BATCH = 10

function exportBase(ref: string, dir: string): void {
  const archive = execFileSync('git', ['-C', CHECKOUT, 'archive', ref, ...BUILD], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', dir], { input: archive })
}

function copyCheckout(dir: string): void {
  for (const path of BUILD) {
    cpSync(join(CHECKOUT, path), join(dir, path), { recursive: true })
  }
}

function hooksIn(build: string): Map<string, string> {
  const hooks = join(build, 'hooks')
  // Source only: a stray file git doesn't track, such as .DS_Store, must not make one build look different from itself.
  const files = readdirSync(hooks, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
  return new Map(
    files.map(entry => {
      const path = join(entry.parentPath, entry.name)
      return [relative(hooks, path), readFileSync(path, 'utf8')]
    }),
  )
}

async function readerIn(build: string): Promise<Reader> {
  const module = (await import(pathToFileURL(join(build, 'hooks', 'bashWrites.ts')).href)) as { findSourceWrites: Reader }
  return module.findSourceWrites
}

function commandsIn(dir: string): string[] {
  return transcriptFiles(dir).flatMap(file => shellCalls(readFileSync(file, 'utf8').split('\n'), file).map(call => call.command))
}

function addHarness(build: string): void {
  mkdirSync(join(build, 'tests'), { recursive: true })
  cpSync(join(CHECKOUT, 'tests', 'engine.tsx'), join(build, 'tests', 'engine.tsx'))
  cpSync(join(CHECKOUT, 'tests', 'fixtures'), join(build, 'tests', 'fixtures'), { recursive: true })
  cpSync(join(CHECKOUT, 'tools', 'compare', 'session.tsx'), join(build, 'tests', 'session.tsx'))
  cpSync(join(CHECKOUT, 'tools', 'compare', 'plan.ts'), join(build, 'tests', 'plan.ts'))
}

function writeBatch(build: string, batch: number): void {
  for (let file = 0; file < FILES_PER_BATCH; file++) {
    const shard = batch * FILES_PER_BATCH + file
    const test = [
      "import { describe } from 'claude-code/testing'",
      "import { ALL } from './plan'",
      "import { playSession } from './session'",
      `describe('sessions ${shard}', () => { ALL.filter((_, i) => i % ${BATCHES * FILES_PER_BATCH} === ${shard}).forEach(playSession) })`,
      '',
    ].join('\n')
    writeFileSync(join(build, 'tests', `s${file}.test.tsx`), test)
  }
}

function runKit(build: string): Promise<{ output: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // Windows starts `claude` through its .cmd shim, which needs a shell (tools/check/check.mjs).
    const kit = spawn('claude', ['plugin', 'test', '.'], { cwd: build, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    // Each stream decoded on its own, so a character split between chunks stays whole and one stream never lands inside
    // a line of the other. The kit prints a test's console output on stderr.
    let out = ''
    let err = ''
    kit.stdout.setEncoding('utf8').on('data', chunk => (out += chunk))
    kit.stderr.setEncoding('utf8').on('data', chunk => (err += chunk))
    kit.on('error', reject)
    kit.on('close', code => resolve({ output: `${out}\n${err}`, code }))
  })
}

async function playAll(name: string, build: string, batch: number, seen: Map<string, Session>, failures: string[]): Promise<void> {
  writeBatch(build, batch)
  const { output, code } = await runKit(build)
  for (const [key, session] of readSessions(output)) {
    seen.set(key, session)
  }
  if (code !== 0) {
    failures.push(`${name}, batch ${batch + 1}: the test kit exited ${code}`)
  }
}

async function compareBuilds(base: string, head: string, failures: string[]): Promise<Compared> {
  addHarness(base)
  addHarness(head)
  const before = new Map<string, Session>()
  const after = new Map<string, Session>()
  for (let batch = 0; batch < BATCHES; batch++) {
    console.log(`sessions: batch ${batch + 1} of ${BATCHES}`)
    await Promise.all([playAll('base', base, batch, before, failures), playAll('head', head, batch, after, failures)])
  }
  return compareSessions([...before.values()], [...after.values()], ALL.map(({ key }) => key))
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'dope-tdd-compare-'))
  const removeWork = () => rmSync(work, { recursive: true, force: true })
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.once(signal, () => {
      removeWork()
      process.exit(code)
    })
  }
  try {
    const base = join(work, 'base')
    const head = join(work, 'head')
    mkdirSync(base)
    mkdirSync(head)
    exportBase(options.base, base)
    copyCheckout(head)
    const sha = execFileSync('git', ['-C', CHECKOUT, 'rev-parse', '--short', options.base], { encoding: 'utf8' }).trim()
    console.log(`compare: this checkout against ${options.base} (${sha})`)

    const readings = compareReadings(commandsIn(options.transcripts ?? join(homedir(), '.claude', 'projects')), await readerIn(base), await readerIn(head), FOLDERS)
    console.log(formatReadings(readings))

    const kitFailures: string[] = []
    const compared = options.sessions ? await compareBuilds(base, head, kitFailures) : undefined
    if (compared !== undefined) console.log(formatSessions(compared))

    const problems = problemsIn({ readings, sameBuild: sameFiles(hooksIn(base), hooksIn(head)), kitFailures, compared })
    for (const problem of problems) console.log(`INCOMPLETE: ${problem}`)
    return problems.length === 0 ? 0 : 1
  } finally {
    removeWork()
  }
}

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '.')) {
  process.exitCode = await main()
}
