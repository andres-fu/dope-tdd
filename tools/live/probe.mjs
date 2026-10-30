// The throwaway repos the live suite's sessions run in (tools/live/run.mjs), under the OS temp folder.
//
// `<root>/probe` is a tiny guarded repo: dope-tdd.json `{ "layout": "mirror" }`, src/calc.js and its passing test.
// `<root>/home` is a second one, for a session whose edit lands outside its own project (scenario A).
// `<root>/linked` is a `git worktree add` of the probe (scenario D).
// `<probe>/.claude/worktrees/nested` is one under the probe, as the desktop app makes for a session (scenario F).
// A worktree subagent's worktree lands in `<probe>/.claude/worktrees/agent-…` with a branch of its own; cleanup
// removes those too, wherever they landed, so nothing is left on disk.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FILES = {
  'dope-tdd.json': '{ "layout": "mirror" }\n',
  'package.json': '{ "name": "dope-tdd-probe", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n',
  'src/calc.js': 'export function add(a, b) {\n  return a + b\n}\n',
  'tests/calc.test.js':
    "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\n\nimport { add } from '../src/calc.js'\n\ntest('add', () => assert.equal(add(1, 2), 3))\n",
}

const CONFIG = '[user]\n\tname = dope-tdd live\n\temail = live@dope-tdd.invalid\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function makeRepo(dir) {
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  git(dir, 'init', '-q', '-b', 'main')
  // Local settings, so a machine's own git config (autocrlf, signing) cannot change what the probe holds. Written
  // straight to .git/config: a `git config` process each costs about 50 ms on Windows.
  appendFileSync(join(dir, '.git', 'config'), CONFIG)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'probe')
}

/** A fresh root with the probe, plus the folder this scenario's session starts in when that is not the probe. */
export function makeRoot(where) {
  // The long name: Windows can hand back an 8.3 short temp path, and the stream's paths are long ones.
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'dope-tdd-live-'))
  const probe = join(root, 'probe')
  mkdirSync(probe)
  makeRepo(probe)
  if (where === 'home') {
    mkdirSync(join(root, 'home'))
    makeRepo(join(root, 'home'))
  }
  if (where === 'linked') git(probe, 'worktree', 'add', '-q', join(root, 'linked'), '-b', 'linked')
  if (where === 'nested') {
    git(probe, 'worktree', 'add', '-q', join(probe, '.claude', 'worktrees', 'nested'), '-b', 'nested')
    // A real project ignores the folder, so a check built from the main checkout has neither the change nor the test.
    appendFileSync(join(probe, '.git', 'info', 'exclude'), '.claude/\n')
  }
  return { root, probe }
}

export const readCalc = probe => readFileSync(join(probe, 'src', 'calc.js'), 'utf8')

/**
 * Removes every worktree of each repo under root, then root itself; returns the worktrees removed. The repos' branches
 * go with their .git folders. The worktrees are removed one by one because one can sit outside root: Claude Code
 * decides where a subagent's worktree goes, and deleting root alone would leave that folder behind.
 */
export function cleanup(root) {
  const removed = []
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const repo = join(root, name)
    // A linked worktree's .git is a file; only a main checkout owns the worktree list.
    if (!existsSync(join(repo, '.git')) || !statSync(join(repo, '.git')).isDirectory()) continue
    const worktrees = git(repo, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length))
      .slice(1)
    for (const worktree of worktrees) {
      try {
        git(repo, 'worktree', 'remove', '--force', '--force', worktree)
      } catch {
        // Already gone from disk, or locked: its folder is removed below when it is under root.
      }
      removed.push(worktree)
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  return removed
}

/**
 * Drops dope-tdd's session records (`<home>/.dope-tdd/sessions/<day>-<session id>.json`) of these sessions, so probe
 * runs do not count in the person's own stats. Returns the file names removed.
 */
export function dropSessionRecords(dir, sessionIds) {
  if (!existsSync(dir)) return []
  const safe = sessionIds.map(id => id.replace(/[^\w.-]/g, '_'))
  const dropped = readdirSync(dir).filter(name => safe.some(id => name.endsWith(`-${id}.json`)))
  for (const name of dropped) rmSync(join(dir, name), { force: true })
  return dropped
}

/**
 * Drops the transcript folders Claude Code keeps for the probe sessions (`~/.claude/projects/<folder>`, the folder's
 * path with every other character than a letter or digit as `-`), so a run leaves no trace there either. Matched by
 * the root's unique temp name, so no other project's folder can match. Returns the folder names removed.
 */
export function dropTranscripts(projectsDir, root) {
  if (!existsSync(projectsDir)) return []
  const prefix = `${root.replace(/[^a-zA-Z0-9]/g, '-')}-`
  const dropped = readdirSync(projectsDir).filter(name => name.startsWith(prefix))
  for (const name of dropped) rmSync(join(projectsDir, name), { recursive: true, force: true })
  return dropped
}
