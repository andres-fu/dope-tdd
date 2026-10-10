import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { BeforeState, CatchOutcome, TddStats } from '../types'
import { findSourceWrites } from './bashWrites'
import { briefingText } from './briefing'
import { importCandidates } from './imports'
import { changedLines } from './changedLines'
import { catchOutcome, runFailure, runnerArgv, timeBudgetMs } from './catchCheck'
import type { RunnerKind } from './catchCheck'
import { CONFIG_FILE, describeConfigChange, isLoosening, parseConfig, policyFor } from './config'
import type { GuardConfig } from './config'
import {
  assertionsRemovedAdvice,
  commentedOutAdvice,
  configChangedAdvice,
  hollowAdvice,
  importAdvice,
  hollowTouchAdvice,
  redUnlockAdvice,
  inheritedAdvice,
  runAdvice,
  skippedAdvice,
  touchAdvice,
  unguardedAdvice,
  unreadRunAdvice,
} from './advice'
import { drawBand, drawTestPane } from './draw'
import { changedPaths, isRevertCommand, parseNumstat } from './gitChanges'
import type { SourceSnapshot } from './gitChanges'
import { classifyPath, isInsideRoot, relativePath, sourcePathFor, testPathFor, watchedDirs } from './mirror'
import { failedFilesIn, failedTestsIn, fallbackTool, isPureTestRun, isTestRun, namedTestFile, readRun, runnerNamed, runnersFor, testRunLocation, workspaceTarget } from './runners'
import { isTruncated, neverRan, runnerDidNotStart } from './runOutcome'
import { guideKey, guidePath, guideSection } from './fieldGuide'
import { sessionLogPath, sessionRecord } from './sessionLog'
import { ELSEWHERE, cwdAfter, isPureRead } from './shell'
import { detectStackFrom, stackOf } from './stacks'
import type { StackName } from './stacks'
import { formatSetup, inferLayout, isCodeFile, suggestedConfig } from './setup'
import type { Survey } from './setup'
import {
  INITIAL_STATS,
  acquireCheck,
  expireCurrent,
  isChecking,
  markReminded,
  moduleState,
  normalizeStats,
  otherOpenModules,
  recordBlocked,
  recordCatch,
  recordChange,
  recordConfigChange,
  recordRun,
  closeCyclesForTest,
  recordImportUnlock,
  recordRedFor,
  recordKnownFailures,
  recordRedNames,
  recordRedUnlock,
  recordRunTarget,
  recordSourceEdit,
  recordTestChanged,
  recordTestTouch,
  recordUnreadRun,
  recordWorkaround,
  releaseCheck,
  resetStats,
  seedUnlocks,
  togglePause,
} from './stats'
import { formatGlossary, formatStatus } from './summary'
import { freshUnlocks, hasAssertion, legacyUnlockKey, storeRoot, unlockKey } from './unlocks'
import { CHECK_LOCK_TTL_MS } from './stats'
import { commentedOutLines, testEditSignals } from './workarounds'

const MINUTE = 60_000
const TEST_PANE = 'dope-tdd-test'
const STATUS_TOOL = /^mcp__dope-tdd__status$/
const MAX_SOURCE_CHARS = 10_000
const JOURNAL_PREFIX = 'catch-journal:'
/** Where a change left alone after a check is kept, next to its source, named in the toast. */
const KEPT_SUFFIX = '.dope-tdd.kept'
const SURVEY_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', '.next', '.cache', 'target', 'vendor'])
const SURVEY_DEPTH = 6
const SURVEY_CAP = 5_000

const stats = atom({ plugin: 'dope-tdd', key: 'stats' } as const, INITIAL_STATS)
const tick = atom({ plugin: 'dope-tdd', key: 'tick' } as const, 0)
/** Where each of the agent's shells is: Claude Code keeps it between calls, and resets it to the root when a cd leaves the project. */
const bashCwd = atom({ plugin: 'dope-tdd', key: 'bash-cwd' } as const, '')
const powershellCwd = atom({ plugin: 'dope-tdd', key: 'powershell-cwd' } as const, '')
type ShellName = 'bash' | 'powershell'

function readCwd($: EngineInterface, shell: ShellName): Promise<string> {
  return shell === 'bash' ? read($, bashCwd) : read($, powershellCwd)
}

async function writeCwd($: EngineInterface, shell: ShellName, cwd: string): Promise<void> {
  if (shell === 'bash') {
    await update($, bashCwd, () => cwd)
  } else {
    await update($, powershellCwd, () => cwd)
  }
}

/** The config as the tool hooks last read it; renders reuse it instead of reading the file on every redraw. */
let cachedConfig: { root: string; config: GuardConfig } | null = null
/** The stack each root's files pointed at when first listed; `/tdd setup` looks again. */
const detectedStacks = new Map<string, StackName | undefined>()
/** Roots whose interrupted-check journals were looked at since this module loaded (a hot reload starts over). */
const repairedRoots = new Set<string>()
let guardFailureToasted = false

type FileRead = { kind: 'text'; text: string } | { kind: BeforeState }

function succeeded(result: ToolCallResult): boolean {
  return result.deny === undefined && result.isError !== true
}

function withContext(result: ToolCallResult, lines: string[]): ToolCallResult {
  return lines.length === 0 || result.deny !== undefined
    ? result
    : { ...result, context: [...(result.context ?? []), ...lines] }
}

function hasActivity(s: TddStats): boolean {
  return s.events.length > 0 || s.paused || s.current !== null
}

function change($: EngineInterface, fn: (s: TddStats) => TddStats): Promise<TddStats> {
  return update($, stats, stored => fn(normalizeStats(stored)))
}

async function readStats($: EngineInterface): Promise<TddStats> {
  return normalizeStats(await read($, stats))
}

async function rememberUnlock($: EngineInterface, root: string, module: string, testPath: string, nowMs: number): Promise<void> {
  const key = unlockKey(root)
  const stored = freshUnlocks(await $.store.get(key), nowMs)
  await $.store.set(key, { ...stored, [module]: { testPath, atMs: nowMs } })
}

/** The stack the root's own files say the project is, when dope-tdd.json does not name one. */
async function detectStack($: EngineInterface, root: string): Promise<StackName | undefined> {
  if (detectedStacks.has(root)) {
    return detectedStacks.get(root)
  }
  let detected: StackName | undefined
  try {
    detected = detectStackFrom((await $.fs.list(root)).map(entry => entry.name)) ?? undefined
  } catch {
    detected = undefined
  }
  detectedStacks.set(root, detected)
  return detected
}

/** GODOT_BIN, the variable gdUnit4's own wrapper reads, when the config does not name the binary. */
async function godotFromEnv($: EngineInterface): Promise<string | null> {
  try {
    const value = await $.env.get('GODOT_BIN')
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

async function loadConfig($: EngineInterface, root: string): Promise<GuardConfig> {
  const config = parseConfig(await readWhole($, `${root}/${CONFIG_FILE}`), await detectStack($, root))
  cachedConfig = { root, config }
  return config
}

async function configForRender($: EngineInterface, root: string): Promise<GuardConfig> {
  return cachedConfig?.root === root ? cachedConfig.config : loadConfig($, root)
}

function tell(quiet: boolean, result: ToolCallResult, lines: string[]): ToolCallResult {
  return quiet ? result : withContext(result, lines)
}

function absolutePath(root: string, path: string): string {
  return /^([A-Za-z]:|[\\/])/.test(path) ? path : `${root}/${path}`
}

function checkingMessage(module: string): string {
  return `dope-tdd is verifying that the test for ${module} catches the change; retry in a moment.`
}

async function readWhole($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

/** Tells a file that is not there from one that is there but cannot be read (too large, locked): only the first is a new file. */
/**
 * The folder of the package a workspace run names: a path from where the shell is, or a name matched against each
 * package's package.json name, then its folder name, among the `roots` (a trailing `/*` is listed). Null when none.
 */
async function packageDirFor($: EngineInterface, root: string, start: string, config: GuardConfig, target: string): Promise<string | null> {
  if (/^\.{1,2}\//.test(target) || (target.includes('/') && !target.startsWith('@'))) {
    const dir = /^\.{1,2}\//.test(target) ? `${start}/${target.replace(/^\.\//, '')}` : `${root}/${target}`
    return isInsideRoot(root, dir) && (await $.fs.exists(`${dir}/package.json`)) ? dir.replace(/\/$/, '') : null
  }
  const dirs: string[] = []
  for (const entry of config.roots) {
    if (entry.endsWith('/*')) {
      const parent = entry.slice(0, -2)
      try {
        for (const item of await $.fs.list(`${root}/${parent}`)) {
          if (item.kind === 'dir') {
            dirs.push(`${parent}/${item.name}`)
          }
        }
      } catch {
        // A roots glob with nothing behind it names no package.
      }
    } else if (!entry.includes('*')) {
      dirs.push(entry)
    }
  }
  for (const dir of dirs) {
    const manifest = await readWhole($, `${root}/${dir}/package.json`)
    const name = manifest === null ? null : (/"name"\s*:\s*"([^"]+)"/.exec(manifest)?.[1] ?? null)
    if (name === target) {
      return `${root}/${dir}`
    }
  }
  const bare = target.replace(/^@[^/]+\//, '')
  const byFolder = dirs.find(dir => dir.split('/').pop() === bare)
  return byFolder === undefined ? null : `${root}/${byFolder}`
}

async function readFile($: EngineInterface, path: string): Promise<FileRead> {
  try {
    return { kind: 'text', text: await $.fs.read(path) }
  } catch {
    try {
      return { kind: (await $.fs.exists(path)) ? 'unreadable' : 'missing' }
    } catch {
      return { kind: 'unreadable' }
    }
  }
}

function parentDir(dir: string): string | null {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const cut = trimmed.replace(/[\\/][^\\/]*$/, '')
  return cut === trimmed || cut === '' ? null : cut
}

type Runner = { kind: RunnerKind; root: string; tool: string; launcher?: readonly string[] }

/** Walks up from the project root, because a monorepo hoists the runner into a parent directory; only the stack's own runners are looked for. */
async function detectRunner($: EngineInterface, root: string, config: GuardConfig, testPath: string): Promise<Runner | null> {
  const candidates = runnersFor(config.stack, testPath)
  // First a runner installed in the test's own package (a monorepo that does not hoist): from the test's folder up to the root.
  const top = root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  for (let dir: string | null = parentDir(testPath.replace(/\\/g, '/')); dir !== null && dir.toLowerCase() !== top && isInsideRoot(root, dir); dir = parentDir(dir)) {
    for (const runner of candidates) {
      for (const candidate of runner.tools) {
        if (await $.fs.exists(`${dir}/${candidate}`)) {
          return { kind: runner.kind, root: dir, tool: `${dir}/${candidate}` }
        }
      }
    }
  }
  for (let dir: string | null = root; dir !== null; dir = parentDir(dir)) {
    for (const runner of candidates) {
      if (runner.markers.length === 0) {
        return { kind: runner.kind, root, tool: fallbackTool(runner, root) }
      }
      for (const marker of runner.markers) {
        if (await $.fs.exists(`${dir}/${marker}`)) {
          for (const candidate of runner.tools) {
            if (await $.fs.exists(`${dir}/${candidate}`)) {
              return { kind: runner.kind, root: dir, tool: `${dir}/${candidate}` }
            }
          }
          // No program in the repo: a lockfile may name the launcher that knows where the environment lives.
          for (const launcher of runner.launchers ?? []) {
            if (await $.fs.exists(`${dir}/${launcher.marker}`)) {
              return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root), launcher: launcher.argv }
            }
          }
          return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root) }
        }
      }
    }
  }
  return null
}

type JournalFile = { path: string; before: string; after: string }

function isJournalFile(value: unknown): value is JournalFile {
  const file = value as Partial<JournalFile> | null
  return typeof file === 'object' && file !== null && typeof file.path === 'string' && typeof file.before === 'string' && typeof file.after === 'string'
}

function journalFiles(value: unknown): JournalFile[] | null {
  const journal = value as { files?: unknown } | null
  return typeof journal === 'object' && journal !== null && Array.isArray(journal.files) ? journal.files.filter(isJournalFile) : null
}

/**
 * One catch-check lock per checkout, across every session on the machine.
 * The store is shared but its get-then-set is not atomic (the mods docs say
 * so), so the lock itself is a git ref updated by compare-and-swap: creating
 * it succeeds for exactly one session, an expired one is taken over only by
 * naming its exact old value, and a session can release only its own.
 * refs/worktree/ refs are per checkout, which is the right scope: two
 * worktrees of one repository revert different files. The store keeps a copy
 * so every guard can see the lock without starting git on each tool call.
 */
const SHARED_LOCK_REF = 'refs/worktree/dope-tdd-check'
let sharedLockUnavailableSaid = false
/** Module and test pairs whose baseline (the check's own command, nothing reverted) was green in this load. */
const baselined = new Set<string>()
/** Each root's upstream (else origin) remote URL, or null, read once for the field guide. */
const remotesByRoot = new Map<string, string | null>()

type SharedLock = { kind: 'acquired'; sha: string } | { kind: 'busy'; module: string } | { kind: 'unavailable' }

function sharedLockKey(root: string): string {
  return `check-lock:${storeRoot(root)}`
}

async function gitQuiet($: EngineInterface, root: string, args: string[], stdin?: string): Promise<{ exitCode: number; stdout: string } | null> {
  try {
    const run = await $.process.run(['git', ...args], stdin === undefined ? { cwd: root } : { cwd: root, stdin })
    return { exitCode: run.exitCode, stdout: run.stdout }
  } catch {
    return null
  }
}

function parseLock(text: string | undefined): { module: string; sinceMs: number } | null {
  try {
    const value = JSON.parse(text ?? '') as { module?: unknown; sinceMs?: unknown }
    return typeof value.module === 'string' && typeof value.sinceMs === 'number' ? { module: value.module, sinceMs: value.sinceMs } : null
  } catch {
    return null
  }
}

async function acquireSharedLock($: EngineInterface, root: string, module: string, nowMs: number): Promise<SharedLock> {
  const hashed = await gitQuiet($, root, ['hash-object', '-w', '--stdin'], JSON.stringify({ module, sinceMs: nowMs }))
  if (hashed === null || hashed.exitCode !== 0) {
    return { kind: 'unavailable' }
  }
  const sha = hashed.stdout.trim()
  const create = async () => (await gitQuiet($, root, ['update-ref', SHARED_LOCK_REF, sha, '']))?.exitCode === 0
  const held = async (): Promise<SharedLock> => {
    try {
      await $.store.set(sharedLockKey(root), { module, sinceMs: nowMs, sha })
    } catch (error) {
      $.ui.log(`dope-tdd: could not record the check lock in the store: ${String(error)}`)
    }
    return { kind: 'acquired', sha }
  }
  if (await create()) {
    return held()
  }
  const current = await gitQuiet($, root, ['rev-parse', '-q', '--verify', SHARED_LOCK_REF])
  if (current === null || current.exitCode !== 0) {
    // Released between our attempt and our read: one more try, then give way.
    return (await create()) ? held() : { kind: 'busy', module: 'another module' }
  }
  const oldSha = current.stdout.trim()
  const lock = parseLock((await gitQuiet($, root, ['cat-file', '-p', oldSha]))?.stdout)
  if (lock !== null && nowMs - lock.sinceMs < CHECK_LOCK_TTL_MS) {
    return { kind: 'busy', module: lock.module }
  }
  // Expired (a check that died) or unreadable: take it over only if it is still the one we read.
  const taken = (await gitQuiet($, root, ['update-ref', SHARED_LOCK_REF, sha, oldSha]))?.exitCode === 0
  return taken ? held() : { kind: 'busy', module: lock?.module ?? 'another module' }
}

async function releaseSharedLock($: EngineInterface, root: string, sha: string): Promise<void> {
  await gitQuiet($, root, ['update-ref', '-d', SHARED_LOCK_REF, sha])
  try {
    const mirror = (await $.store.get(sharedLockKey(root))) as { sha?: unknown } | undefined
    if (mirror?.sha === sha) {
      await $.store.delete(sharedLockKey(root))
    }
  } catch (error) {
    $.ui.log(`dope-tdd: could not clear the check lock in the store: ${String(error)}`)
  }
}

/** The module a check in any session has reverted right now, from the store's copy of the lock, or null. */
async function checkInFlight($: EngineInterface, root: string, nowMs: number): Promise<string | null> {
  try {
    const lock = parseLock(JSON.stringify((await $.store.get(sharedLockKey(root))) ?? null))
    return lock !== null && nowMs - lock.sinceMs < CHECK_LOCK_TTL_MS ? lock.module : null
  } catch {
    return null
  }
}

function journalKeyFor(root: string, module: string): string {
  return `${JOURNAL_PREFIX}${storeRoot(root)}:${module}`
}

async function journalKeys($: EngineInterface, root: string): Promise<string[]> {
  try {
    const all = await $.store.keys()
    // Both spellings: a journal an earlier build wrote under the raw root is a reverted file on disk until it is read.
    const prefixes = [...new Set([`${JOURNAL_PREFIX}${storeRoot(root)}`, `${JOURNAL_PREFIX}${root}`])]
    return all.filter(key => prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}:`)))
  } catch (error) {
    $.ui.log(`dope-tdd: could not list the store: ${String(error)}`)
    return []
  }
}

async function forget($: EngineInterface, key: string): Promise<void> {
  try {
    await $.store.delete(key)
  } catch (error) {
    $.ui.log(`dope-tdd: could not clear ${key}: ${String(error)}`)
  }
}

/**
 * A change that will not be written back is kept, so no text is ever only in the log: under
 * `~/.dope-tdd/kept/<repo>/<path>`, outside the repository where `git add -A` would take it; next to its
 * file only when there is no home folder to name.
 */
async function keepAside($: EngineInterface, root: string, path: string, text: string): Promise<string | null> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const repo = root.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? 'repo'
  const kept = home === undefined || home === '' ? `${path}${KEPT_SUFFIX}` : `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/kept/${repo}/${relativePath(root, path)}`
  try {
    await $.fs.write(kept, text)
    return kept
  } catch (error) {
    $.ui.log(`dope-tdd: could not write ${kept}: ${String(error)}`)
    return null
  }
}

/**
 * A journal left behind means a check died between revert and restore. A file
 * still at `before` gets `after` back; a file that moved since is left alone
 * and its `after` text is kept beside it, because the hand that moved it knew
 * more than the journal does.
 */
async function repairInterruptedCheck($: EngineInterface, root: string): Promise<void> {
  const restored: string[] = []
  const left: string[] = []
  for (const key of await journalKeys($, root)) {
    const files = journalFiles(await $.store.get(key)) ?? []
    for (const file of files) {
      const onDisk = await readWhole($, file.path)
      if (onDisk === file.after) {
        continue
      }
      if (onDisk !== file.before) {
        left.push((await keepAside($, root, file.path, file.after)) ?? file.path)
        continue
      }
      try {
        await $.fs.write(file.path, file.after)
        restored.push(file.path)
      } catch {
        left.push((await keepAside($, root, file.path, file.after)) ?? file.path)
      }
    }
    await forget($, key)
  }
  if (restored.length > 0) {
    $.ui.toast(`dope-tdd restored ${restored.length} file(s) after an interrupted check`)
  }
  if (left.length > 0) {
    $.ui.toast(`dope-tdd left ${left.length} file(s) alone after an interrupted check; each change is kept, see the log`)
    $.ui.log(`dope-tdd: not restored, they no longer match the interrupted check; kept as: ${left.join(', ')}`)
  }
}

/** Runs the repair once per root per process load, and never while a check is in flight. */
async function ensureRepaired($: EngineInterface, root: string, nowMs: number): Promise<void> {
  // Never while a check is in flight, in this session or another: its journal is live, and its file is reverted on purpose.
  if (repairedRoots.has(root) || isChecking(await readStats($), nowMs) || (await checkInFlight($, root, nowMs)) !== null) {
    return
  }
  repairedRoots.add(root)
  await repairInterruptedCheck($, root)
}

/**
 * A guard that fails (throws, overruns its budget, answers a wrong shape) is
 * skipped and its `.catch` handler answers in its place; that handler calls
 * this, then `next(e)`, which replays the guard's own call when it had made
 * one and runs the call through unobserved when it had not. Fail open, on
 * the record. Under re-entry the handler's own `$` calls reject, so the
 * report is best-effort and the call still goes through.
 */
function reportGuardFailure($: EngineInterface, name: string, error: { readonly kind: string; readonly message?: string }): void {
  try {
    const why = error.message === undefined ? error.kind : `${error.kind}: ${error.message}`
    $.ui.log(`dope-tdd: the ${name} guard failed (${why}) and let the call through`)
    if (!guardFailureToasted) {
      guardFailureToasted = true
      $.ui.toast('dope-tdd hit an internal error and let a call through; see the log')
    }
  } catch {
    // Re-entry: nothing to report with, and nothing to hold.
  }
}

/**
 * Proves `module`'s test against this cycle's change to its source: revert,
 * run only that test, restore. Only this module's change is touched; other
 * modules wait for their own green. The lock is taken in one update and
 * released whatever happens; a file that moved while reverted is left alone.
 */
/** Runners that find packages by walking up from the file, so a worktree inside .git still reaches the project's node_modules. */
const ISOLATED_RUNNERS: ReadonlySet<RunnerKind> = new Set<RunnerKind>(['vitest', 'jest', 'ava'])
const CHECK_WORKTREE = '.git/dope-tdd/wt'
/** More changed files than this and copying them costs more than the check is worth: the check runs in place. */
const MAX_COPIED_FILES = 300

type WorktreeCheck = {
  module: string
  path: string
  before: string
  after: string
  runIn: string
  relativeTest: string
  argv: string[]
  greenRunMs: number
  nowMs: number
  known: readonly string[]
}

function listed(answer: { exitCode: number; stdout: string } | null): string[] | null {
  return answer === null || answer.exitCode !== 0 ? null : answer.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/**
 * The catch check in a throwaway worktree inside .git: HEAD, plus the user's uncommitted and untracked files copied in,
 * then the module's old code written there and its test run there. The user's files are never written, so an editor,
 * a watcher or a parallel agent never sees a revert. The test must first pass there as the code stands; anything the
 * worktree cannot reproduce returns null, and the check runs in place instead. The worktree is always removed.
 */
async function checkInWorktree($: EngineInterface, root: string, check: WorktreeCheck): Promise<CatchOutcome | null> {
  const { module, path, before, after, runIn, relativeTest, argv, greenRunMs, nowMs } = check
  const wt = `${root}/${CHECK_WORKTREE}`
  const locked = await change($, state => acquireCheck(state, module, nowMs))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== nowMs) {
    return { kind: 'unverified', reason: 'another check was running' }
  }
  const shared = await acquireSharedLock($, root, module, nowMs)
  if (shared.kind === 'busy') {
    await change($, releaseCheck)
    return { kind: 'unverified', reason: `another session was checking ${shared.module}` }
  }
  const sharedSha = shared.kind === 'acquired' ? shared.sha : null
  try {
    await gitQuiet($, root, ['worktree', 'remove', '--force', wt])
    const added = await gitQuiet($, root, ['worktree', 'add', '--detach', wt, 'HEAD'])
    if (added === null || added.exitCode !== 0) {
      return null
    }
    const dirty = listed(await gitQuiet($, root, ['diff', '--name-only', 'HEAD']))
    const untracked = listed(await gitQuiet($, root, ['ls-files', '--others', '--exclude-standard']))
    const deleted = listed(await gitQuiet($, root, ['diff', '--name-only', '--diff-filter=D', 'HEAD']))
    if (dirty === null || untracked === null || deleted === null) {
      return null
    }
    const gone = new Set(deleted)
    const copies = [...new Set([...dirty, ...untracked])].filter(file => !gone.has(file))
    if (copies.length > MAX_COPIED_FILES) {
      return null
    }
    for (const file of copies) {
      const text = await readWhole($, `${root}/${file}`)
      if (text === null) {
        return null
      }
      await $.fs.write(`${wt}/${file}`, text)
    }
    for (const file of gone) {
      await gitQuiet($, wt, ['rm', '-q', '--', file])
    }
    const inTree = `${wt}/${relativePath(root, path)}`
    const cwd = runIn === root ? wt : `${wt}/${relativePath(root, runIn)}`
    const budget = timeBudgetMs(greenRunMs)
    // The test must pass in the worktree as the code stands, or the worktree is not the user's project.
    const baselineKey = `wt|${storeRoot(root)}|${module}|${relativeTest.toLowerCase()}`
    if (!baselined.has(baselineKey)) {
      await $.fs.write(inTree, after)
      let base: CatchOutcome
      try {
        base = catchOutcome(await $.process.run(argv, { cwd, env: { CI: '1', DOPE_TDD_BASELINE: '1' }, timeoutMs: budget }), relativeTest, check.known)
      } catch (error) {
        base = catchOutcome(runFailure(error))
      }
      if (base.kind !== 'missed') {
        $.ui.log(`dope-tdd: the test is not green in the check worktree (${base.kind === 'unverified' ? base.reason : 'red'}); checking in place`)
        return null
      }
      baselined.add(baselineKey)
    }
    await $.fs.write(inTree, before)
    let outcome: CatchOutcome
    try {
      outcome = catchOutcome(await $.process.run(argv, { cwd, env: { CI: '1' }, timeoutMs: budget }), relativeTest, check.known)
    } catch (error) {
      outcome = catchOutcome(runFailure(error))
    }
    return outcome.kind === 'missed' ? { kind: 'missed', slipped: changedLines(before, after) } : outcome
  } catch (error) {
    $.ui.log(`dope-tdd: the check worktree failed (${String(error)}); checking in place`)
    return null
  } finally {
    await gitQuiet($, root, ['worktree', 'remove', '--force', wt])
    await change($, releaseCheck)
    if (sharedSha !== null) {
      await releaseSharedLock($, root, sharedSha)
    }
  }
}

async function verifyCatch(
  $: EngineInterface,
  root: string,
  config: GuardConfig,
  s: TddStats,
  module: string,
  editedSinceRun: boolean,
  greenRunMs: number,
  nowMs: number,
  /** The module saw red in this cycle and its test was not edited after that red. */
  provedByRed = false,
  /** Tests in its file that were failing before the change: a check where only these fail has caught nothing. */
  known: readonly string[] = [],
): Promise<CatchOutcome | 'unchecked' | 'refactor'> {
  const cycleChange = s.changes[module]
  const testPath = s.unlocked[module]
  if (cycleChange === undefined) {
    // The backstop saw an edit (a patch, a formatter, a copy) that the text capture did not: say so, never stay silent.
    return editedSinceRun && testPath !== undefined ? { kind: 'unverified', reason: 'change not captured' } : 'unchecked'
  }
  if (testPath === undefined) {
    return 'unchecked'
  }
  if (cycleChange.before === cycleChange.after) {
    // Broken on purpose, red, restored byte for byte: the red was the check, so there is nothing left to revert.
    // Never when the test was edited after the red: that green came from the test, and is TEST CHANGED.
    return provedByRed ? { kind: 'proven' } : 'unchecked'
  }
  if (cycleChange.kind === 'refactor') {
    return 'refactor'
  }
  // Observe touches nothing on disk: a module the config only watches (observe mode, or outside the scope) is never reverted.
  const policy = policyFor(config, relativePath(root, cycleChange.path))
  if (policy === 'observe' || policy === 'exempt' || config.catchCheck === false) {
    return 'unchecked'
  }
  if (cycleChange.before === null) {
    return { kind: 'unverified', reason: cycleChange.beforeState === 'unreadable' ? 'could not read the file before the edit' : 'new file' }
  }
  const { path, before, after } = cycleChange
  if ((await readWhole($, path)) !== after) {
    return { kind: 'unverified', reason: 'changed outside' }
  }
  const runner = await detectRunner($, root, config, testPath)
  if (runner === null) {
    return catchOutcome('no-runner')
  }
  const godot = config.godot ?? (await godotFromEnv($))
  // A runner installed inside a package runs from that package, so its own config loads; otherwise from the root.
  const runIn = runner.root !== root && isInsideRoot(root, runner.root) ? runner.root : root
  const relativeTest = relativePath(runIn, testPath)
  const argv = runnerArgv(runner.root, runner.kind, relativeTest, runner.tool, { godot, ...(runner.launcher === undefined ? {} : { launcher: runner.launcher }) })

  // In a git checkout, a Node runner checks in a worktree: the change is undone there, never in the user's files.
  if (ISOLATED_RUNNERS.has(runner.kind) && (await $.fs.exists(`${root}/.git/HEAD`))) {
    const isolated = await checkInWorktree($, root, { module, path, before, after, runIn, relativeTest, argv, greenRunMs, nowMs, known })
    if (isolated !== null) {
      await change($, state => ({ ...state, worktreeChecks: state.worktreeChecks + 1 }))
      return isolated
    }
  }

  // The baseline, once per module and test in a session: the check's own command, on the code as it stands, must be
  // green. Otherwise a red with the change undone could come from the command (cwd, env, config), not from the change.
  const baselineKey = `${storeRoot(root)}|${module}|${relativeTest.toLowerCase()}`
  if (!baselined.has(baselineKey)) {
    let base: CatchOutcome
    try {
      const run = await $.process.run(argv, { cwd: runIn, env: { CI: '1', DOPE_TDD_BASELINE: '1' }, timeoutMs: timeBudgetMs(greenRunMs) })
      base = catchOutcome(run, relativeTest, known)
    } catch (error) {
      base = catchOutcome(runFailure(error))
    }
    if (base.kind !== 'missed') {
      return { kind: 'unverified', reason: base.kind === 'unverified' ? `baseline: ${base.reason}` : "the test is red under the check's own command before anything is reverted" }
    }
    baselined.add(baselineKey)
  }

  // The lock first, then the journal: a check that loses the lock never touches another check's journal.
  const locked = await change($, state => acquireCheck(state, module, nowMs))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== nowMs) {
    return { kind: 'unverified', reason: 'another check was running' }
  }
  const shared = await acquireSharedLock($, root, module, nowMs)
  if (shared.kind === 'busy') {
    await change($, releaseCheck)
    return { kind: 'unverified', reason: `another session was checking ${shared.module}` }
  }
  if (shared.kind === 'unavailable' && !sharedLockUnavailableSaid) {
    sharedLockUnavailableSaid = true
    $.ui.log('dope-tdd: not a git checkout, so the catch-check lock covers this session only')
  }
  const sharedSha = shared.kind === 'acquired' ? shared.sha : null
  const releaseAll = async () => {
    await change($, releaseCheck)
    if (sharedSha !== null) {
      await releaseSharedLock($, root, sharedSha)
    }
  }
  const journalKey = journalKeyFor(root, module)
  try {
    await $.store.set(journalKey, { files: [{ path, before, after }] })
  } catch (error) {
    await releaseAll()
    $.ui.log(`dope-tdd: could not journal the catch check for ${path}: ${String(error)}`)
    return { kind: 'unverified', reason: 'could not journal the revert' }
  }

  let outcome: CatchOutcome = { kind: 'unverified', reason: 'revert failed' }
  let reverted = false
  let movedWhileReverted = false
  try {
    await $.fs.write(path, before)
    reverted = true
    try {
      const run = await $.process.run(argv, {
        cwd: runIn,
        env: { CI: '1' },
        timeoutMs: timeBudgetMs(greenRunMs),
      })
      outcome = catchOutcome(run, relativeTest, known)
      if (outcome.kind === 'missed') {
        // What the test did not notice: the agent needs the lines, not just the verdict, to write the assertion.
        outcome = { kind: 'missed', slipped: changedLines(before, after) }
      }
    } catch (error) {
      outcome = catchOutcome(runFailure(error))
    }
  } catch (error) {
    $.ui.log(`dope-tdd: could not revert ${path} for the catch check: ${String(error)}`)
  } finally {
    if (reverted) {
      const onDisk = await readWhole($, path)
      if (onDisk === before) {
        try {
          await $.fs.write(path, after)
        } catch (error) {
          $.ui.log(`dope-tdd: could not restore ${path}: ${String(error)}`)
        }
      } else if (onDisk !== after) {
        movedWhileReverted = true
      }
    }
    await releaseAll()
  }

  if (movedWhileReverted) {
    const kept = await keepAside($, root, path, after)
    const where = kept === null ? 'see the log' : `your change is in ${kept.startsWith(root) ? relativePath(root, kept) : kept}`
    $.ui.toast(`dope-tdd: ${relativePath(root, path)} changed during the catch check and was left as is; ${where}`)
    $.ui.log(`dope-tdd: ${path} changed while reverted; the text after your change: ${kept ?? `(could not be written) ${after}`}`)
    await forget($, journalKey)
    return { kind: 'unverified', reason: 'changed during check' }
  }
  if ((await readWhole($, path)) !== after) {
    $.ui.toast('dope-tdd could not restore a source file after the catch check; see /tdd')
    $.ui.log(`dope-tdd: restore failed for ${path}; journal kept under ${journalKey}`)
    return { kind: 'unverified', reason: 'restore failed' }
  }
  await forget($, journalKey)
  return outcome
}

function lockedMessage(config: GuardConfig, module: string): string {
  const guess = config.layoutGuessed === true ? ' That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.' : ''
  return `dope-tdd: write the failing test first. Touch ${testPathFor(config, module)}, or run it and see it fail, before editing ${sourcePathFor(config, module)}.${guess}`
}

function sourceModuleOf(root: string, path: string, config: GuardConfig): string | null {
  const target = classifyPath(root, absolutePath(root, path), config)
  return target.kind === 'source' ? target.module : null
}

/** Every code file and every directory with a package.json, for /tdd setup; bounded so a huge tree stays cheap. */
async function surveyProject($: EngineInterface, root: string): Promise<Survey> {
  const files: string[] = []
  const packageDirs: string[] = []
  const rootEntries: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SURVEY_DEPTH || files.length >= SURVEY_CAP) {
      return
    }
    let entries: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      entries = await $.fs.list(dir === '' ? root : `${root}/${dir}`)
    } catch {
      return
    }
    for (const entry of entries) {
      const relative = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (dir === '') {
        rootEntries.push(entry.name)
      }
      if (entry.kind === 'dir') {
        if (!SURVEY_SKIP.has(entry.name) && !entry.name.startsWith('.')) {
          await walk(relative, depth + 1)
        }
      } else if (entry.kind === 'file') {
        if (entry.name === 'package.json') {
          packageDirs.push(dir)
        } else if (isCodeFile(relative)) {
          files.push(relative)
        }
      }
    }
  }
  await walk('', 0)
  return { files, packageDirs, rootEntries }
}

function parsedJson(text: string | null): Record<string, unknown> {
  try {
    const raw: unknown = text === null ? {} : JSON.parse(text)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** `/tdd setup` shows what the project looks like and the config that fits; `/tdd setup write` saves it. */
async function setupText($: EngineInterface, root: string, write: boolean, nowMs: number): Promise<string> {
  detectedStacks.delete(root)
  const survey = await surveyProject($, root)
  const configPath = `${root}/${CONFIG_FILE}`
  const existing = await readWhole($, configPath)
  const current = parseConfig(existing, await detectStack($, root))
  const inferred = inferLayout(survey, current.stackSource === 'config' ? current.stack : undefined)
  const text = formatSetup(current, inferred, survey, existing !== null)
  if (!write) {
    return text
  }
  const { layout: _layout, roots: _roots, stack: _stack, ...kept } = parsedJson(existing)
  const merged = { ...kept, ...suggestedConfig(current, inferred) }
  await $.fs.write(configPath, `${JSON.stringify(merged, null, 2)}\n`)
  const after = await loadConfig($, root)
  const detail = describeConfigChange(current, after) ?? 'no change'
  await change($, s => recordConfigChange(s, `setup: ${detail}`, false, nowMs))
  $.ui.toast(`dope-tdd: ${CONFIG_FILE} written (${detail})`)
  return `${text}\nwritten: ${CONFIG_FILE} (${detail})`
}

function beforeText(file: FileRead): string | null {
  return file.kind === 'text' ? file.text : null
}

function beforeState(file: FileRead): BeforeState | undefined {
  return file.kind === 'text' ? undefined : file.kind
}

/** Code commented out by an edit is recorded and said; the count is the detail. */
async function noteCommentedOut(
  $: EngineInterface,
  root: string,
  module: string,
  path: string,
  before: string | null,
  after: string,
  nowMs: number,
): Promise<string[]> {
  const lines = before === null ? 0 : commentedOutLines(before, after)
  if (lines === 0) {
    return []
  }
  await change($, s => recordWorkaround(s, 'commented-out', module, `${lines} line${lines === 1 ? '' : 's'}`, nowMs))
  return [commentedOutAdvice(relativePath(root, path), lines)]
}

/** Skip/only markers added or assertions lost in a test edit are recorded and said. */
async function noteTestEdit(
  $: EngineInterface,
  root: string,
  module: string,
  path: string,
  before: string | null,
  after: string | null,
  nowMs: number,
): Promise<string[]> {
  if (before === null || after === null) {
    return []
  }
  const lines: string[] = []
  for (const signal of testEditSignals(before, after)) {
    if (signal.kind === 'skipped') {
      await change($, s => recordWorkaround(s, 'skipped', module, `+${signal.added}`, nowMs))
      lines.push(skippedAdvice(relativePath(root, path), signal.added))
    } else {
      await change($, s => recordWorkaround(s, 'assertion-removed', module, `${signal.before} → ${signal.after}`, nowMs))
      lines.push(assertionsRemovedAdvice(relativePath(root, path), signal.before, signal.after))
    }
  }
  return lines
}

async function guardFileWrite(
  $: EngineInterface,
  tool: 'Edit' | 'Write',
  filePath: string,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  await ensureRepaired($, root, await $.clock.now())
  const config = await loadConfig($, root)
  const target = classifyPath(root, filePath, config)
  const isConfig = relativePath(root, filePath) === CONFIG_FILE
  const current = await readStats($)
  const quiet = config.mode === 'observe'
  const policy = target.kind === 'source' ? policyFor(config, relativePath(root, filePath)) : null
  if (policy === 'exempt') {
    return proceed()
  }
  const isLocked = target.kind === 'source' && current.unlocked[target.module] === undefined

  if (isLocked && policy === 'enforce' && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => recordBlocked(s, target.module, nowMs))
    return { deny: lockedMessage(config, target.module) }
  }

  const before = target.kind !== 'other' && !current.paused ? await readFile($, filePath) : undefined
  if (target.kind !== 'other') {
    // Read again right before the write: a check that started since must not have this file reverted under the edit.
    const latest = await readStats($)
    const nowMs = await $.clock.now()
    if (isChecking(latest, nowMs)) {
      return { deny: checkingMessage(latest.checking?.module ?? target.module) }
    }
    const elsewhere = await checkInFlight($, root, nowMs)
    if (elsewhere !== null) {
      return { deny: checkingMessage(elsewhere) }
    }
  }
  const result = await proceed()
  if (!succeeded(result)) {
    return result
  }

  const nowMs = await $.clock.now()
  if (isConfig) {
    const after = await loadConfig($, root)
    const detail = describeConfigChange(config, after)
    if (detail === null) {
      return result
    }
    await change($, s => recordConfigChange(s, detail, isLoosening(config, after), nowMs))
    $.ui.toast(`dope-tdd: ${CONFIG_FILE} changed: ${detail}`)
    return withContext(result, [configChangedAdvice(detail)])
  }
  if (target.kind === 'source') {
    const inheritedAt = current.reminded.includes(target.module) ? undefined : current.inherited[target.module]
    const after = before === undefined ? null : await readWhole($, filePath)
    // A file that could not be read before the edit is still a change to account for, with that reason.
    const captured =
      before === undefined
        ? null
        : after !== null
          ? { before: beforeText(before), after, state: beforeState(before) }
          : before.kind === 'unreadable'
            ? { before: null, after: '', state: 'unreadable' as const }
            : null
    const edited = await change($, s => {
      const recorded = markReminded(recordSourceEdit(s, target.module, !isLocked, nowMs), target.module)
      return captured === null ? recorded : recordChange(recorded, target.module, filePath, captured.before, captured.after, captured.state)
    })
    if (edited.paused) {
      return result
    }
    const commented = before === undefined || after === null ? [] : await noteCommentedOut($, root, target.module, filePath, beforeText(before), after, nowMs)
    const sourcePath = sourcePathFor(config, target.module)
    if (isLocked) {
      const warned = policy === 'warn' ? [unguardedAdvice(target.module, sourcePath, testPathFor(config, target.module))] : []
      return tell(quiet, result, [...warned, ...commented])
    }
    const testPath = edited.unlocked[target.module]
    const inherited =
      inheritedAt === undefined || testPath === undefined
        ? []
        : [inheritedAdvice(target.module, relativePath(root, testPath), nowMs - inheritedAt, sourcePath)]
    return tell(quiet, result, [...inherited, ...commented])
  }
  if (target.kind === 'test') {
    const touched = await change($, s => recordTestTouch(s, { module: target.module, testPath: filePath }, nowMs))
    await rememberUnlock($, root, target.module, filePath, nowMs)
    const source = await readWhole($, filePath)
    const hollow = source !== null && !hasAssertion(source) ? [hollowAdvice(relativePath(root, filePath))] : []
    const signals = before === undefined ? [] : await noteTestEdit($, root, target.module, filePath, beforeText(before), source, nowMs)
    // A Write of the same bytes: the touch counts, and so does the fact that it changed nothing. An Edit always changes something.
    const unchanged = tool === 'Write' && before !== undefined && source !== null && beforeText(before) === source
    if (unchanged) {
      await change($, s => recordWorkaround(s, 'hollow-touch', target.module, relativePath(root, filePath), nowMs))
    }
    const resaved = unchanged ? [hollowTouchAdvice(relativePath(root, filePath))] : []
    // A test covers what it imports: slugify.test.ts importing src/lib/io is the test for io too.
    const imported = (await importedModules($, root, config, filePath, source)).filter(module => module !== target.module && touched.unlocked[module] === undefined)
    if (imported.length > 0) {
      await change($, s => imported.reduce((acc, module) => recordImportUnlock(acc, module, filePath), s))
      for (const module of imported) {
        await rememberUnlock($, root, module, filePath, nowMs)
      }
    }
    const importLines = imported.length === 0 ? [] : [importAdvice(relativePath(root, filePath), imported)]
    const command = (await runCommandFor($, root, config, filePath)) ?? undefined
    return touched.paused ? result : tell(quiet, result, [touchAdvice(target.module, sourcePathFor(config, target.module), command), ...importLines, ...hollow, ...signals, ...resaved])
  }
  return result
}

async function runGit($: EngineInterface, root: string, args: string[]): Promise<string | null> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], { cwd: root })
    if (exitCode !== 0) {
      $.ui.log(`dope-tdd: git ${args.join(' ')} exited ${exitCode}: ${stderr.trim()}`)
      return null
    }
    return stdout
  } catch (error) {
    $.ui.log(`dope-tdd: could not run git ${args.join(' ')}: ${String(error)}`)
    return null
  }
}

type ChangedFile = { path: string; module: string }

function changedOfKind(root: string, paths: string[], kind: 'source' | 'test', config: GuardConfig): ChangedFile[] {
  return paths.flatMap(path => {
    const target = classifyPath(root, `${root}/${path}`, config)
    return target.kind === kind ? [{ path, module: target.module }] : []
  })
}

async function snapshotWatched($: EngineInterface, root: string, config: GuardConfig): Promise<SourceSnapshot | null> {
  const dirs = watchedDirs(config)
  const numstat = await runGit($, root, ['diff', '--numstat', '--relative', '--', ...dirs])
  const untracked = await runGit($, root, ['ls-files', '--others', '--exclude-standard', '--', ...dirs])
  if (numstat === null || untracked === null) {
    return null
  }

  const stamped = async (path: string, signature: string) =>
    [path, `${signature}:${(await lastModifiedMs($, `${root}/${path}`)) ?? 'missing'}`] as const
  const tracked = await Promise.all(Object.entries(parseNumstat(numstat)).map(([path, counts]) => stamped(path, counts)))
  const untrackedPaths = untracked.split(/\r?\n/).filter(path => path !== '')
  const untrackedEntries = await Promise.all(untrackedPaths.map(path => stamped(path, 'untracked')))
  return Object.fromEntries([...tracked, ...untrackedEntries])
}

/** The test files the runner named as failed, as modules; empty when the output names none. */
function failedModules(root: string, files: string[], config: GuardConfig): string[] {
  return files.flatMap(file => {
    const target = classifyPath(root, absolutePath(root, file), config)
    return target.kind === 'test' ? [target.module] : []
  })
}

async function guardShell(
  $: EngineInterface,
  command: string,
  proceed: () => Promise<ToolCallResult>,
  shell: ShellName,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  await ensureRepaired($, root, await $.clock.now())
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'
  // The command starts where the last one left the shell, when that is still inside the project.
  const carried = await readCwd($, shell)
  const start = carried !== '' && isInsideRoot(root, carried) ? carried : root

  // Paths come back resolved against the directory their segment runs in; one in another repository classifies as other.
  const writes = findSourceWrites(command, start).map(path => ({
    path: absolutePath(root, path),
    module: sourceModuleOf(root, path, config),
    policy: policyFor(config, relativePath(root, path)),
  }))
  const locked = writes.flatMap(({ module, policy }) =>
    module !== null && policy === 'enforce' && current.unlocked[module] === undefined ? [module] : [],
  )
  if (locked.length > 0 && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => locked.reduce((acc, module) => recordBlocked(acc, module, nowMs), s))
    return { deny: locked.map(module => lockedMessage(config, module)).join('\n') }
  }
  // While a file is reverted on disk, neither a write to source nor a test run may read it.
  if (writes.some(({ module }) => module !== null) || isTestRun(command)) {
    const nowMs = await $.clock.now()
    if (isChecking(current, nowMs)) {
      return { deny: checkingMessage(current.checking?.module ?? 'this module') }
    }
    const elsewhere = await checkInFlight($, root, nowMs)
    if (elsewhere !== null) {
      return { deny: checkingMessage(elsewhere) }
    }
  }

  // A command that only reads, or only runs tests, cannot be the agent writing source: no snapshot around it, no git cost.
  const watched = !isPureRead(command) && !isPureTestRun(command)
  const before = watched ? await snapshotWatched($, root, config) : null
  const expectedWrites = current.paused
    ? []
    : writes.flatMap(({ path, module, policy }) => (module === null || policy === 'exempt' ? [] : [{ path, module }]))
  const textsBefore = await Promise.all(expectedWrites.map(async write => ({ ...write, before: await readFile($, write.path) })))
  const startedMs = await $.clock.now()
  const result = await proceed()
  if (result.deny !== undefined) {
    return result
  }
  const moved = cwdAfter(command, start)
  await writeCwd($, shell, moved !== ELSEWHERE && isInsideRoot(root, moved) ? moved : root)
  const after = before === null ? null : await snapshotWatched($, root, config)
  const nowMs = await $.clock.now()

  const seen = before === null || after === null || isRevertCommand(command) ? [] : changedPaths(before, after)
  // A command that cannot have written source (Claude Code held it read-only, or it is only test runs and filters):
  // what changed while it ran was another editor or session, so it is said and never charged to the agent.
  const cannotWrite = result.isReadOnly === true || isPureTestRun(command)
  const changed = cannotWrite ? [] : seen
  const bystanders = cannotWrite ? changedOfKind(root, seen, 'source', config).map(({ path }) => path) : []
  if (bystanders.length > 0) {
    $.ui.log(`dope-tdd: changed during a command that cannot write them, not counted: ${bystanders.join(', ')}`)
  }
  const touchedTests = changedOfKind(root, changed, 'test', config)
  const changedSources = changedOfKind(root, changed, 'source', config).filter(({ path }) => policyFor(config, path) !== 'exempt')
  const changedModules = new Set(changedSources.map(({ module }) => module))
  const captured = await Promise.all(
    textsBefore
      .filter(write => changedModules.has(write.module))
      .map(async write => ({ ...write, after: await readWhole($, write.path) })),
  )
  const updated = await change($, s => {
    const withTouches = touchedTests.reduce(
      (acc, { path, module }) => recordTestTouch(acc, { module, testPath: `${root}/${path}` }, nowMs),
      s,
    )
    const withEdits = changedSources.reduce(
      (acc, { module }) => recordSourceEdit(acc, module, acc.unlocked[module] !== undefined, nowMs),
      withTouches,
    )
    return captured.reduce(
      (acc, write) =>
        write.after === null
          ? acc
          : recordChange(acc, write.module, write.path, beforeText(write.before), write.after, beforeState(write.before)),
      withEdits,
    )
  })
  for (const { path, module } of touchedTests) {
    await rememberUnlock($, root, module, `${root}/${path}`, nowMs)
  }
  const commented: string[] = []
  for (const write of captured) {
    if (write.after !== null) {
      commented.push(...(await noteCommentedOut($, root, write.module, write.path, beforeText(write.before), write.after, nowMs)))
    }
  }
  const unguardedPaths = changedSources
    .filter(source => updated.unlocked[source.module] === undefined && policyFor(config, source.path) !== 'observe')
    .map(source => source.path)

  const output = result.text ?? ''
  // A command held for approval or refused never ran: no run to read, nothing to count. The hold text is the signal, flagged or not.
  // A run is this project's only when it executes inside the root: `cd ../other && npx vitest run` is another repository's run.
  // A workspace run (`npm test -w server`) runs in its package: the runner prints paths from there.
  const plainLocation = testRunLocation(command, start)
  const target = plainLocation === null ? null : workspaceTarget(command)
  const runLocation = target === null ? plainLocation : ((await packageDirFor($, root, start, config, target)) ?? plainLocation)
  const ran = runLocation !== null && isInsideRoot(root, runLocation) && !neverRan(output)
  const read = ran ? readRun(output) : 'none'
  // A runner that never started ran no test: not an unread run, and the agent is told it did not start.
  const notStarted = read === 'unknown' ? runnerDidNotStart(output) : null
  let outcome = notStarted === null ? read : 'none'
  // Tests that were failing before the change neither hide a red nor block a green: judge a run of the current
  // module's own test file by which tests fail. Only the known failures, or fewer than the red with none new, is green.
  let alreadyFailing: string[] = []
  const working = updated.current
  const ownFile = outcome === 'fail' && working !== null ? namedTestFile(command, config.stack, start) : null
  if (working !== null && ownFile !== null && relativePath(root, ownFile).toLowerCase() === relativePath(root, working.testPath).toLowerCase()) {
    const names = failedTestsIn(output)
    const state = moduleState(updated, working.module)
    const within = (set: readonly string[]) => names.length > 0 && set.length > 0 && names.every(name => set.includes(name))
    if (within(state.knownFailures ?? [])) {
      outcome = 'pass'
      alreadyFailing = names
    } else if (within(state.redFailures ?? []) && names.length < (state.redFailures ?? []).length) {
      outcome = 'pass'
      alreadyFailing = names
      await change($, s => recordKnownFailures(s, working.module, names))
    } else if (names.length > 0) {
      await change($, s => recordRedNames(s, working.module, names))
    }
  }
  let afterRun = updated
  let elsewhere: string[] = []
  const redUnlocked: string[] = []
  if (outcome === 'unknown') {
    afterRun = await change($, s => recordUnreadRun(s, nowMs))
  } else if (outcome !== 'none') {
    const named = namedTestFile(command, config.stack, start) ?? undefined
    const target = named === undefined ? null : classifyPath(root, named, config)
    let targeted = updated
    const namedImports = named === undefined ? [] : await importedModules($, root, config, named)
    const current = updated.current
    // The run is the current module's test, or a test that imports it: the band stays on the module being worked on.
    const keepsCurrent =
      current !== null && named !== undefined && (relativePath(root, current.testPath).toLowerCase() === relativePath(root, named).toLowerCase() || namedImports.includes(current.module))
    if (target?.kind === 'test' && named !== undefined && !keepsCurrent) {
      // A red on the module's own test is the evidence a touch stands for: it unlocks the module, and the band follows it.
      const testPath = named
      if (outcome === 'fail' && updated.unlocked[target.module] === undefined) {
        targeted = await change($, s => recordRedUnlock(s, target.module, testPath, true))
        await rememberUnlock($, root, target.module, testPath, nowMs)
        redUnlocked.push(target.module)
      } else {
        targeted = await change($, s => recordRunTarget(s, target.module))
      }
    }
    if (outcome === 'fail') {
      // The runner prints paths relative to where it ran; resolve them there, then name them from the root.
      const failed = failedFilesIn(output).map(path => relativePath(root, /^(?:[A-Za-z]:|\/)/.test(path) ? path : `${runLocation}/${path}`))
      // Every test file the runner named as failed unlocks its module the same way, without becoming current.
      for (const path of failed) {
        const seen = classifyPath(root, absolutePath(root, path), config)
        if (seen.kind === 'test' && targeted.unlocked[seen.module] === undefined) {
          targeted = await change($, s => recordRedUnlock(s, seen.module, absolutePath(root, path), false))
          await rememberUnlock($, root, seen.module, absolutePath(root, path), nowMs)
          redUnlocked.push(seen.module)
        }
      }
      // A failing test is a red for every module it imports: unlocked if they were not, and their cycle saw red.
      const failingTests = [...new Set([...failed.map(path => absolutePath(root, path)), ...(named !== undefined && target?.kind === 'test' ? [named] : [])])]
      const coveredByFailure: string[] = []
      for (const testFile of failingTests) {
        for (const module of await importedModules($, root, config, testFile)) {
          coveredByFailure.push(module)
          if (targeted.unlocked[module] === undefined) {
            targeted = await change($, s => recordRedUnlock(s, module, testFile, false))
            await rememberUnlock($, root, module, testFile, nowMs)
            redUnlocked.push(module)
          }
        }
      }
      const own = targeted.current?.module
      for (const module of [...new Set(coveredByFailure)].filter(module => module !== own)) {
        targeted = await change($, s => recordRedFor(s, module, nowMs))
      }
      // The suite is red; the module is red only if its own test, or a test that imports it, is among the files that failed.
      const ownFailed = own !== undefined && (failedModules(root, failed, config).includes(own) || coveredByFailure.includes(own))
      elsewhere = failed.length > 0 && own !== undefined && !ownFailed ? failed : []
    }
    afterRun = await change($, s => recordRun(s, outcome === 'pass', nowMs, elsewhere))
    if (outcome === 'pass' && (named !== undefined || !filtersTests(command))) {
      // The test file passed, or the whole suite did: no other module it is the test for stays red behind it.
      afterRun = await change($, s => closeCyclesForTest(s, named ?? null, s.current?.module, nowMs))
    }
  }
  const passedModule = outcome === 'pass' && !afterRun.paused ? afterRun.current?.module : undefined
  // The module's own record before this run: its red, its test edits, its uncaptured edits. Never another module's.
  const before_ = passedModule === undefined ? null : moduleState(updated, passedModule)
  const checkStartMs = await $.clock.now()
  const check =
    passedModule === undefined ? 'unchecked' : await verifyCatch($, root, config, afterRun, passedModule, before_?.editedSinceRun === true, nowMs - startedMs, nowMs, before_?.sawRed === true && !before_.testTouchedAfterRed, alreadyFailing)
  // The time the check itself cost, baseline included: the part of a guarded run's overhead that is Dope TDD's own.
  const checkMs = (await $.clock.now()) - checkStartMs
  if (checkMs > 0) {
    await change($, s => ({ ...s, checkMsTotal: s.checkMsTotal + checkMs }))
  }
  // Red, then the test edited, then green with the module's code unchanged: the green came from the test.
  const testChanged = passedModule !== undefined && check === 'unchecked' && before_?.sawRed === true && before_.testTouchedAfterRed
  if (passedModule !== undefined) {
    await change($, s => {
      const counted = recordCatch(s, passedModule, check, nowMs)
      return testChanged ? recordTestChanged(counted, passedModule, nowMs) : counted
    })
  }
  const runModule = afterRun.current?.module
  const sourcePath = runModule === undefined ? undefined : sourcePathFor(config, runModule)
  const advice =
    outcome === 'none'
      ? null
      : outcome === 'unknown'
        ? unreadRunAdvice(isTruncated(output))
        : runAdvice(updated, afterRun, check === 'unchecked' ? undefined : check, { elsewhere, testChanged, sourcePath })

  const reminders = current.paused
    ? []
    : [
        ...unguardedPaths.map(path => `dope-tdd: ${path} changed through a shell command without a test touched first.`),
        ...(alreadyFailing.length === 0
          ? []
          : [
              `dope-tdd: ${working?.module ?? 'this module'} is green apart from ${alreadyFailing.length} test${alreadyFailing.length === 1 ? ' that was' : 's that were'} already failing before your change: ${alreadyFailing.slice(0, 3).join('; ')}${alreadyFailing.length > 3 ? '; …' : ''}.`,
            ]),
        ...(notStarted === null ? [] : [`dope-tdd: the test runner did not start (${notStarted}); nothing was counted. Run it the way this project runs its tests.`]),
        ...bystanders.map(path => `dope-tdd: ${path} changed while the command ran, but the command cannot have changed it (another editor or session?); not counted.`),
        ...commented,
        ...redUnlocked.map(module => redUnlockAdvice(module, sourcePathFor(config, module))),
        ...(advice === null ? [] : [advice]),
      ]
  return tell(quiet, result, reminders)
}

async function lastModifiedMs($: EngineInterface, path: string): Promise<number | null> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch (error) {
    $.ui.log(`dope-tdd: could not stat ${path}: ${String(error)}`)
    return null
  }
}

async function readSource($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.read(path)).slice(0, MAX_SOURCE_CHARS)
  } catch (error) {
    $.ui.log(`dope-tdd: could not read ${path}: ${String(error)}`)
    return null
  }
}

let logoSource: string | null = null

async function loadLogo($: EngineInterface): Promise<string | null> {
  if (logoSource === null) {
    logoSource = await readSource($, `${$.plugin.root}/assets/skull.svg`)
  }
  return logoSource
}

async function seedRememberedUnlocks($: EngineInterface): Promise<void> {
  const root = await $.session.root()
  const nowMs = await $.clock.now()
  const legacy = legacyUnlockKey(root) === unlockKey(root) ? {} : freshUnlocks(await $.store.get(legacyUnlockKey(root)), nowMs)
  const stored = { ...legacy, ...freshUnlocks(await $.store.get(unlockKey(root)), nowMs) }
  const present = await Promise.all(
    Object.entries(stored).map(async ([module, entry]) =>
      (await lastModifiedMs($, entry.testPath)) === null ? [] : [[module, entry] as const],
    ),
  )
  const entries = Object.fromEntries(present.flat())
  if (Object.keys(entries).length > 0) {
    await change($, s => seedUnlocks(s, entries))
  }
}

// -t / --testNamePattern / -k / --filter / --grep: a run of some tests by name, not the whole suite.
const TEST_FILTER = /(?:^|\s)(?:-t|-k|-g|--testNamePattern|--filter|--grep)(?:[\s=]|$)/

function filtersTests(command: string): boolean {
  return TEST_FILTER.test(command)
}

/** The source modules a test file imports, each with the file that resolved: a test covers what it imports. */
async function importedModules($: EngineInterface, root: string, config: GuardConfig, testPath: string, text?: string | null): Promise<string[]> {
  const source = text ?? (await readWhole($, testPath))
  if (source === null || source === undefined) {
    return []
  }
  const found: string[] = []
  for (const candidate of importCandidates(relativePath(root, testPath), source, config.stack).slice(0, 80)) {
    const target = classifyPath(root, `${root}/${candidate}`, config)
    if (target.kind !== 'source' || found.includes(target.module)) {
      continue
    }
    if (await $.fs.exists(`${root}/${candidate}`)) {
      found.push(target.module)
    }
  }
  return found
}

/** How one test file runs in this project, as a person types it, for a path relative to the root; null when no runner is found. */
async function runCommandFor($: EngineInterface, root: string, config: GuardConfig, testPath: string): Promise<string | null> {
  const runner = await detectRunner($, root, config, testPath)
  return runner === null ? null : runnerNamed(runner.kind).describe(relativePath(root, testPath))
}

/** The command with a placeholder, for the briefing: the layout's own test extension picks the runner. */
async function briefingCommand($: EngineInterface, root: string, config: GuardConfig): Promise<string | null> {
  const ext = config.layout.displayExt ?? stackOf(config.stack).exts[0] ?? 'ts'
  const runner = await detectRunner($, root, config, `${root}/example.${ext}`)
  return runner === null ? null : runnerNamed(runner.kind).describe('<test file>')
}

/**
 * The receipt for a module, ready for a pull request: the status as the band
 * reads it, then the two commands a reviewer runs to re-check the proof
 * without the plugin: the test, and the test against the code as it was
 * before the change.
 */
async function receiptText($: EngineInterface, root: string, config: GuardConfig, named: string | undefined, nowMs: number): Promise<string> {
  const s = await readStats($)
  const module = named ?? s.current?.module
  const status = formatStatus(s, nowMs, config)
  if (module === undefined) {
    return ['dope-tdd receipt', '```', status, '```', 'No module is current; name one: /tdd receipt <module>.'].join('\n')
  }
  const lines = [`dope-tdd receipt for ${module}`, '```', status, '```']
  const testPath = s.unlocked[module]
  if (testPath === undefined) {
    lines.push(`No test on record for ${module}; the receipt is the status alone.`)
    return lines.join('\n')
  }
  const runner = await detectRunner($, root, config, testPath)
  const relativeTest = relativePath(root, testPath)
  const run = runner === null ? `<run ${relativeTest} with your test runner>` : runnerNamed(runner.kind).describe(relativeTest)
  // The change record is cleared once checked; the last catch keeps the path it reverted.
  const changePath = s.changes[module]?.path ?? (s.lastCatch?.module === module ? s.lastCatch.path : undefined)
  const change = changePath === undefined ? undefined : { path: changePath }
  // Never the stash: on a committed change it saves nothing, and its pop would apply the reviewer's own stash.
  const head = await gitQuiet($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const base = head !== null && head.exitCode === 0 && head.stdout.trim() !== '' ? head.stdout.trim() : 'main'
  lines.push('To check the proof yourself, from the repo root with this change checked out:', '```', run)
  if (change !== undefined) {
    const path = relativePath(root, change.path)
    lines.push(`git checkout ${base} -- ${path}`, run, `git checkout HEAD -- ${path}`)
  }
  lines.push('```')
  lines.push(
    change === undefined
      ? `No change to ${module} is on record this session, so there is nothing to put back; the first run is the whole receipt.`
      : `The first run passes. The second runs the same test against the code on ${base}, before the change, and fails, which is what the catch check saw. The last line puts the change back.`,
  )
  return lines.join('\n')
}

/** This repository's field guide as a briefing section, or null when there is none. Never fails the prompt. */
async function fieldGuide($: EngineInterface, root: string): Promise<string | null> {
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home === undefined || home === '') {
      return null
    }
    // The remote does not move within a session: asked once per root, not on every prompt.
    let remote = remotesByRoot.get(root)
    if (remote === undefined) {
      remote = null
      for (const name of ['upstream', 'origin']) {
        const answer = await gitQuiet($, root, ['config', '--get', `remote.${name}.url`])
        if (answer !== null && answer.exitCode === 0 && answer.stdout.trim() !== '') {
          remote = answer.stdout.trim()
          break
        }
      }
      remotesByRoot.set(root, remote)
    }
    const key = guideKey(remote, root)
    const path = guidePath(home, key)
    if (!(await $.fs.exists(path))) {
      return null
    }
    const text = await $.fs.read(path)
    return typeof text === 'string' && text.trim() !== '' ? guideSection(key, text) : null
  } catch {
    return null
  }
}

/** The session's record, left under the user's home when it ends; DOPE_TDD_LOG=off keeps it in memory. */
async function writeSessionLog($: EngineInterface, sessionId: string, reason: string): Promise<void> {
  if ((await $.env.get('DOPE_TDD_LOG')) === 'off') {
    return
  }
  const s = await readStats($)
  if (!hasActivity(s)) {
    return
  }
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (home === undefined || home === '') {
    return
  }
  const root = await $.session.root()
  const config = await loadConfig($, root)
  const nowMs = await $.clock.now()
  const record = sessionRecord(s, config, { sessionId, reason, root, endedAtMs: nowMs }, formatStatus(s, nowMs, config))
  await $.fs.write(sessionLogPath(home, nowMs, sessionId), `${JSON.stringify(record, null, 2)}
`)
}

async function currentStatus($: EngineInterface): Promise<string> {
  const config = await loadConfig($, await $.session.root())
  return formatStatus(await readStats($), await $.clock.now(), config)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(MINUTE, () => {
      void $.clock.now().then(nowMs =>
        change($, s => expireCurrent(s, nowMs)).then(s =>
          hasActivity(s) ? update($, tick, n => n + 1) : undefined,
        ),
      )
    })
    const started = await next(e)
    const root = await $.session.root()
    await ensureRepaired($, root, await $.clock.now())
    await seedRememberedUnlocks($)
    await loadConfig($, root)
    await $.command.register({
      name: 'tdd',
      description: 'Show the TDD guard status and recent events; /tdd why explains the words on the band; /tdd setup detects where your tests live; /tdd receipt prints the receipt for a pull request',
    })
    await $.tool.register({
      name: 'status',
      description: 'Report the TDD guard state: paused or on, phase, current module, counts, and the recent event log.',
    })
    return started
  })

  // The session's receipt stays on this machine. Exits stay fast: a log that cannot be written is skipped, never waited on.
  on('session.end', async ($, e, next) => {
    try {
      // A session that ends mid-check (an exit, a crash of the run) must not leave old code on disk: put the change back.
      const root = await $.session.root()
      const nowMs = await $.clock.now()
      if (isChecking(await readStats($), nowMs) || (await checkInFlight($, root, nowMs)) === null) {
        await repairInterruptedCheck($, root)
      }
    } catch {
      // The next session start repairs what this could not.
    }
    try {
      await writeSessionLog($, e.sessionId, e.reason)
    } catch {
      // The log is a record, not a gate.
    }
    return next(e)
  })

  on('command.run', { command: 'tdd' }, async ($, e) => {
    const raw = e.args.trim().split(/\s+/).filter(word => word !== '')
    const words = raw.map(word => word.toLowerCase())
    if (words[0] === 'why') {
      return { text: formatGlossary() }
    }
    if (words[0] === 'setup') {
      return { text: await setupText($, await $.session.root(), words[1] === 'write', await $.clock.now()) }
    }
    if (words[0] === 'receipt') {
      const root = await $.session.root()
      // The module id keeps its case: server/managers/RoomManager is not server/managers/roommanager.
      return { text: await receiptText($, root, await loadConfig($, root), raw[1], await $.clock.now()) }
    }
    return { text: await currentStatus($) }
  })

  // The briefing: the rules in Claude's system prompt, so the first refusal is an expected step, not a surprise.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const root = await $.session.root()
    const config = await loadConfig($, root)
    // Observe measures how the agent works on its own, so it is not briefed.
    if (config.mode === 'observe') {
      return composed
    }
    const text = briefingText(config, await briefingCommand($, root, config))
    const guide = await fieldGuide($, root)
    return {
      sections: [
        ...composed.sections,
        { id: 'dope-tdd:briefing', text, scope: 'session' as const },
        ...(guide === null ? [] : [{ id: 'dope-tdd:field-guide', text: guide, scope: 'session' as const }]),
      ],
    }
  })

  on('tool.call', { tool: STATUS_TOOL }, async $ => ({ result: await currentStatus($) }) as ToolCallResult).catch(($, _e, next) => {
    reportGuardFailure($, 'status', next.error)
    return { result: `dope-tdd: the status could not be read (${next.error.kind}); try /tdd` } as ToolCallResult
  })

  on('tool.call', { tool: 'Edit' }, ($, e, next) => guardFileWrite($, 'Edit', e.file_path, () => next(e))).catch(($, e, next) => {
    reportGuardFailure($, 'Edit', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, ($, e, next) => guardFileWrite($, 'Write', e.file_path, () => next(e))).catch(($, e, next) => {
    reportGuardFailure($, 'Write', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => guardShell($, e.command, () => next(e), 'bash')).catch(($, e, next) => {
    reportGuardFailure($, 'Bash', next.error)
    return next(e)
  })

  // Windows sessions run their shell through this tool; test runs, writes and the git backstop are the same story.
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guardShell($, e.command, () => next(e), 'powershell')).catch(($, e, next) => {
    reportGuardFailure($, 'PowerShell', next.error)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const current = await readStats($)
    if (e.props.hasSurvey || !hasActivity(current)) {
      return next(e)
    }

    const nowMs = await $.clock.now()
    const config = await configForRender($, await $.session.root())
    const logo = e.surface === 'terminal' ? null : await loadLogo($)

    return drawBand($.ui.resolve(e), {
      stats: current,
      config,
      nowMs,
      logo,
      onViewTest: () => $.ui.open({ id: TEST_PANE, title: `Test · ${current.current?.module ?? ''}` }),
      onTogglePause: async () => {
        const nowMs = await $.clock.now()
        const toggled = await change($, s => togglePause(s, nowMs))
        $.ui.toast(toggled.paused ? 'TDD guard paused' : 'TDD guard resumed')
      },
      onReset: async () => {
        await change($, resetStats)
        $.ui.toast('TDD stats reset')
      },
    })
  })

  on('ui.render', { component: 'Pane', requestId: TEST_PANE }, async ($, e) => {
    const { current } = await readStats($)
    const source = current ? await readSource($, current.testPath) : null
    return drawTestPane($.ui.resolve(e), { current, source })
  })
}
