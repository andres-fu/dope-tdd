import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { BeforeState, CatchOutcome, TddStats } from '../types'
import { findSourceWrites } from './bashWrites'
import { catchOutcome, runFailure, runnerArgv, timeBudgetMs } from './catchCheck'
import type { RunnerKind } from './catchCheck'
import { CONFIG_FILE, describeConfigChange, isLoosening, parseConfig, policyFor } from './config'
import type { GuardConfig } from './config'
import {
  assertionsRemovedAdvice,
  commentedOutAdvice,
  configChangedAdvice,
  hollowAdvice,
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
import { classifyPath, relativePath, sourcePathFor, testPathFor, watchedDirs } from './mirror'
import { failedFilesIn, isTestRun, namedTestFile, readRun, runnersFor } from './runners'
import { isTruncated, neverRan } from './runOutcome'
import { detectStackFrom } from './stacks'
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

type Runner = { kind: RunnerKind; root: string; tool: string }

/** Walks up from the project root, because a monorepo hoists the runner into a parent directory; only the stack's own runners are looked for. */
async function detectRunner($: EngineInterface, root: string, config: GuardConfig): Promise<Runner | null> {
  for (let dir: string | null = root; dir !== null; dir = parentDir(dir)) {
    for (const runner of runnersFor(config.stack)) {
      for (const marker of runner.markers) {
        if (await $.fs.exists(`${dir}/${marker}`)) {
          let tool: string | null = null
          for (const candidate of runner.tools) {
            if (await $.fs.exists(`${dir}/${candidate}`)) {
              tool = `${dir}/${candidate}`
              break
            }
          }
          return { kind: runner.kind, root: dir, tool: tool ?? runner.fallback }
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

/** A change that will not be written back is kept next to its file, so no text is ever only in the log. */
async function keepAside($: EngineInterface, path: string, text: string): Promise<string | null> {
  const kept = `${path}${KEPT_SUFFIX}`
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
        left.push((await keepAside($, file.path, file.after)) ?? file.path)
        continue
      }
      try {
        await $.fs.write(file.path, file.after)
        restored.push(file.path)
      } catch {
        left.push((await keepAside($, file.path, file.after)) ?? file.path)
      }
    }
    await forget($, key)
  }
  if (restored.length > 0) {
    $.ui.toast(`dope-tdd restored ${restored.length} file(s) after an interrupted check`)
  }
  if (left.length > 0) {
    $.ui.toast(`dope-tdd left ${left.length} file(s) alone after an interrupted check; the change is kept beside each, see the log`)
    $.ui.log(`dope-tdd: not restored, they no longer match the interrupted check; kept as: ${left.join(', ')}`)
  }
}

/** Runs the repair once per root per process load, and never while a check is in flight. */
async function ensureRepaired($: EngineInterface, root: string, nowMs: number): Promise<void> {
  if (repairedRoots.has(root) || isChecking(await readStats($), nowMs)) {
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
async function verifyCatch(
  $: EngineInterface,
  root: string,
  config: GuardConfig,
  s: TddStats,
  module: string,
  editedSinceRun: boolean,
  greenRunMs: number,
  nowMs: number,
): Promise<CatchOutcome | 'unchecked' | 'refactor'> {
  const cycleChange = s.changes[module]
  const testPath = s.unlocked[module]
  if (cycleChange === undefined) {
    // The backstop saw an edit (a patch, a formatter, a copy) that the text capture did not: say so, never stay silent.
    return editedSinceRun && testPath !== undefined ? { kind: 'unverified', reason: 'change not captured' } : 'unchecked'
  }
  if (testPath === undefined || cycleChange.before === cycleChange.after) {
    return 'unchecked'
  }
  if (cycleChange.kind === 'refactor') {
    return 'refactor'
  }
  if (cycleChange.before === null) {
    return { kind: 'unverified', reason: cycleChange.beforeState === 'unreadable' ? 'could not read the file before the edit' : 'new file' }
  }
  const { path, before, after } = cycleChange
  if ((await readWhole($, path)) !== after) {
    return { kind: 'unverified', reason: 'changed outside' }
  }
  const runner = await detectRunner($, root, config)
  if (runner === null) {
    return catchOutcome('no-runner')
  }
  const godot = config.godot ?? (await godotFromEnv($))

  // The lock first, then the journal: a check that loses the lock never touches another check's journal.
  const locked = await change($, state => acquireCheck(state, module, nowMs))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== nowMs) {
    return { kind: 'unverified', reason: 'another check was running' }
  }
  const journalKey = journalKeyFor(root, module)
  try {
    await $.store.set(journalKey, { files: [{ path, before, after }] })
  } catch (error) {
    await change($, releaseCheck)
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
      const run = await $.process.run(runnerArgv(runner.root, runner.kind, relativePath(root, testPath), runner.tool, { godot }), {
        cwd: root,
        env: { CI: '1' },
        timeoutMs: timeBudgetMs(greenRunMs),
      })
      outcome = catchOutcome(run)
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
    await change($, releaseCheck)
  }

  if (movedWhileReverted) {
    const kept = await keepAside($, path, after)
    const where = kept === null ? 'see the log' : `your change is in ${relativePath(root, kept)}`
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
  return `dope-tdd: write the failing test first. Touch ${testPathFor(config, module)} before editing ${sourcePathFor(config, module)}.`
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
    if (isChecking(latest, await $.clock.now())) {
      return { deny: checkingMessage(latest.checking?.module ?? target.module) }
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
    return touched.paused ? result : tell(quiet, result, [touchAdvice(target.module, sourcePathFor(config, target.module)), ...hollow, ...signals])
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
): Promise<ToolCallResult> {
  const root = await $.session.root()
  await ensureRepaired($, root, await $.clock.now())
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'

  const writes = findSourceWrites(command).map(path => ({
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
  if ((writes.some(({ module }) => module !== null) || isTestRun(command)) && isChecking(current, await $.clock.now())) {
    return { deny: checkingMessage(current.checking?.module ?? 'this module') }
  }

  const before = await snapshotWatched($, root, config)
  const expectedWrites = current.paused
    ? []
    : writes.flatMap(({ path, module, policy }) => (module === null || policy === 'exempt' ? [] : [{ path, module }]))
  const textsBefore = await Promise.all(expectedWrites.map(async write => ({ ...write, before: await readFile($, write.path) })))
  const startedMs = await $.clock.now()
  const result = await proceed()
  if (result.deny !== undefined) {
    return result
  }
  const after = before === null ? null : await snapshotWatched($, root, config)
  const nowMs = await $.clock.now()

  const changed = before === null || after === null || isRevertCommand(command) ? [] : changedPaths(before, after)
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
  const ran = isTestRun(command) && !neverRan(output)
  const outcome = ran ? readRun(output) : 'none'
  let afterRun = updated
  let elsewhere: string[] = []
  if (outcome === 'unknown') {
    afterRun = await change($, s => recordUnreadRun(s, nowMs))
  } else if (outcome !== 'none') {
    const named = namedTestFile(command, config.stack) ?? undefined
    const target = named === undefined ? null : classifyPath(root, absolutePath(root, named), config)
    const targeted = target?.kind === 'test' ? await change($, s => recordRunTarget(s, target.module)) : updated
    if (outcome === 'fail') {
      const failed = failedFilesIn(output)
      const own = targeted.current?.module
      // The suite is red; the module is red only if its own test is among the files that failed.
      elsewhere = failed.length > 0 && own !== undefined && !failedModules(root, failed, config).includes(own) ? failed : []
    }
    afterRun = await change($, s => recordRun(s, outcome === 'pass', nowMs, elsewhere))
  }
  const passedModule = outcome === 'pass' && !afterRun.paused ? afterRun.current?.module : undefined
  // The module's own record before this run: its red, its test edits, its uncaptured edits. Never another module's.
  const before_ = passedModule === undefined ? null : moduleState(updated, passedModule)
  const check =
    passedModule === undefined ? 'unchecked' : await verifyCatch($, root, config, afterRun, passedModule, before_?.editedSinceRun === true, nowMs - startedMs, nowMs)
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
        ...commented,
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
      description: 'Show the TDD guard status and recent events; /tdd why explains the words on the band; /tdd setup detects where your tests live',
    })
    await $.tool.register({
      name: 'status',
      description: 'Report the TDD guard state: paused or on, phase, current module, counts, and the recent event log.',
    })
    return started
  })

  on('command.run', { command: 'tdd' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
    if (words[0] === 'why') {
      return { text: formatGlossary() }
    }
    if (words[0] === 'setup') {
      return { text: await setupText($, await $.session.root(), words[1] === 'write', await $.clock.now()) }
    }
    return { text: await currentStatus($) }
  })

  on('tool.call', { tool: STATUS_TOOL }, async $ => ({ result: await currentStatus($) }) as ToolCallResult).catch(($, _e, next) => {
    reportGuardFailure($, 'status', next.error)
    return { result: `dope-tdd: the status could not be read (${next.error.kind}); try /tdd` } as ToolCallResult
  })

  on('tool.call', { tool: 'Edit' }, ($, e, next) => guardFileWrite($, e.file_path, () => next(e))).catch(($, e, next) => {
    reportGuardFailure($, 'Edit', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, ($, e, next) => guardFileWrite($, e.file_path, () => next(e))).catch(($, e, next) => {
    reportGuardFailure($, 'Write', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => guardShell($, e.command, () => next(e))).catch(($, e, next) => {
    reportGuardFailure($, 'Bash', next.error)
    return next(e)
  })

  // Windows sessions run their shell through this tool; test runs, writes and the git backstop are the same story.
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => guardShell($, e.command, () => next(e))).catch(($, e, next) => {
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
