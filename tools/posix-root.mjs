#!/usr/bin/env node
// Runs the plugin's tests a second time with every fixture path under a POSIX root (/fx/work/throughline) instead of
// a Windows drive (C:/work/throughline). The suite is written against one fixture root, and a path bug that only shows
// on macOS or Linux (a drive letter assumed, a case folded, a "C:/" left in a test) hides behind it.
//
// The kit gives tests no environment, so the root cannot be a variable: the plugin is copied to a temporary folder,
// the one FIXTURE_DRIVE line in tests/engine.tsx is rewritten, and `claude plugin test` runs on the copy.
//
// Usage: node tools/posix-root.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const DRIVE_LINE = /^export const FIXTURE_DRIVE = '[^']*'$/m
const POSIX_DRIVE = "export const FIXTURE_DRIVE = '/fx/'"
const SKIPPED = new Set(['.git', 'node_modules'])

const copy = mkdtempSync(join(tmpdir(), 'dope-tdd-posix-'))
let status = 1
try {
  cpSync(PLUGIN, copy, { recursive: true, filter: source => !SKIPPED.has(basename(source)) })
  const engine = join(copy, 'tests', 'engine.tsx')
  const text = readFileSync(engine, 'utf8')
  if (!DRIVE_LINE.test(text)) {
    throw new Error(`tests/engine.tsx has no line matching ${DRIVE_LINE}; update tools/posix-root.mjs with it`)
  }
  writeFileSync(engine, text.replace(DRIVE_LINE, POSIX_DRIVE))
  console.log(`dope-tdd: running the tests with the fixture root under /fx/ (copy in ${copy})`)
  // `claude` is a .cmd shim on Windows, which only a shell can start.
  const run = spawnSync('claude', ['plugin', 'test', copy], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (run.error !== undefined) {
    throw run.error
  }
  status = run.status ?? 1
} catch (error) {
  console.error(`dope-tdd: the POSIX-root pass could not run: ${error instanceof Error ? error.message : String(error)}`)
  status = 1
} finally {
  rmSync(copy, { recursive: true, force: true })
}
process.exit(status)
