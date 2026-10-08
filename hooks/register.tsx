import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { BeforeState, CatchOutcome, TddStats } from '../types'
import { findSourceWrites } from './bashWrites'
import { catchOutcome, runnerArgv, timeBudgetMs } from './catchCheck'
import type { RunnerKind } from './catchCheck'
import { CONFIG_FILE, describeConfigChange, parseConfig, policyFor } from './config'
import type { GuardConfig } from './config'
import {
  configChangedAdvice,
  hollowAdvice,
  inheritedAdvice,
  runAdvice,
  touchAdvice,
  unguardedAdvice,
  unreadRunAdvice,
} from './advice'
import { drawBand, drawTestPane } from './draw'
import { changedPaths, isRevertCommand, parseNumstat } from './gitChanges'
import type { SourceSnapshot } from './gitChanges'
import { classifyPath, isTestRun, relativePath } from './mirror'
import { failedFiles, isTruncated, neverRan, runOutcome } from './runOutcome'
import {
  INITIAL_STATS,
  acquireCheck,
  expireCurrent,
  isChecking,
  markReminded,
  normalizeStats,
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
  releaseCheck,
  resetStats,
  seedUnlocks,
  togglePause,
} from './stats'
import { formatGlossary, formatStatus } from './summary'
import { freshUnlocks, hasAssertion, unlockKey } from './unlocks'

const MINUTE = 60_000
const TEST_PANE = 'dope-tdd-test'
const STATUS_TOOL = /^mcp__dope-tdd__status$/
const MAX_SOURCE_CHARS = 10_000
const WATCHED_DIRS = ['src', 'tests']
const JOURNAL_PREFIX = 'catch-journal:'
const TEST_FILE_IN_COMMAND = /(?:^|[\s'"])((?:[A-Za-z]:)?[\w./\\-]*tests[/\\][\w./\\-]+\.test\.tsx?)/
const RUNNER_FILES: readonly (readonly [RunnerKind, string])[] = [
  ['vitest', 'node_modules/vitest/vitest.mjs'],
  ['jest', 'node_modules/jest/bin/jest.js'],
]

const stats = atom({ plugin: 'dope-tdd', key: 'stats' } as const, INITIAL_STATS)
const tick = atom({ plugin: 'dope-tdd', key: 'tick' } as const, 0)

/** The config as the tool hooks last read it; renders reuse it instead of reading the file on every redraw. */
let cachedConfig: { root: string; config: GuardConfig } | null = null

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

async function loadConfig($: EngineInterface, root: string): Promise<GuardConfig> {
  const config = parseConfig(await readWhole($, `${root}/${CONFIG_FILE}`))
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

type Runner = { kind: RunnerKind; root: string }

/** Walks up from the project root, because a monorepo hoists the runner into a parent node_modules. */
async function detectRunner($: EngineInterface, root: string): Promise<Runner | null> {
  for (let dir: string | null = root; dir !== null; dir = parentDir(dir)) {
    for (const [kind, file] of RUNNER_FILES) {
      if (await $.fs.exists(`${dir}/${file}`)) {
        return { kind, root: dir }
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

async function forget($: EngineInterface, key: string): Promise<void> {
  try {
    await $.store.delete(key)
  } catch (error) {
    $.ui.log(`dope-tdd: could not clear ${key}: ${String(error)}`)
  }
}

/**
 * A journal left behind means a check died between revert and restore. A file
 * still at `before` gets `after` back; a file that moved since is left alone,
 * because the hand that moved it knew more than the journal does.
 */
async function repairInterruptedCheck($: EngineInterface): Promise<void> {
  const key = `${JOURNAL_PREFIX}${await $.session.root()}`
  const files = journalFiles(await $.store.get(key))
  if (files === null) {
    return
  }
  const restored: string[] = []
  const left: string[] = []
  for (const file of files) {
    const onDisk = await readWhole($, file.path)
    if (onDisk === file.after) {
      continue
    }
    if (onDisk !== file.before) {
      left.push(file.path)
      continue
    }
    try {
      await $.fs.write(file.path, file.after)
      restored.push(file.path)
    } catch {
      left.push(file.path)
    }
  }
  await forget($, key)
  if (restored.length > 0) {
    $.ui.toast(`dope-tdd restored ${restored.length} file(s) after an interrupted check`)
  }
  if (left.length > 0) {
    $.ui.toast(`dope-tdd left ${left.length} file(s) alone after an interrupted check; see the log`)
    $.ui.log(`dope-tdd: not restored, they no longer match the interrupted check: ${left.join(', ')}`)
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
  s: TddStats,
  module: string,
  greenRunMs: number,
  nowMs: number,
): Promise<CatchOutcome | 'unchecked' | 'refactor'> {
  const cycleChange = s.changes[module]
  const testPath = s.unlocked[module]
  if (cycleChange === undefined || testPath === undefined || cycleChange.before === cycleChange.after) {
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
  const runner = await detectRunner($, root)
  if (runner === null) {
    return catchOutcome('no-runner')
  }

  const journalKey = `${JOURNAL_PREFIX}${root}`
  try {
    await $.store.set(journalKey, { files: [{ path, before, after }] })
  } catch (error) {
    $.ui.log(`dope-tdd: could not journal the catch check for ${path}: ${String(error)}`)
    return { kind: 'unverified', reason: 'could not journal the revert' }
  }
  const locked = await change($, state => acquireCheck(state, module, nowMs))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== nowMs) {
    await forget($, journalKey)
    return { kind: 'unverified', reason: 'another check was running' }
  }

  let outcome: CatchOutcome = { kind: 'unverified', reason: 'revert failed' }
  let reverted = false
  let movedWhileReverted = false
  try {
    await $.fs.write(path, before)
    reverted = true
    try {
      const run = await $.process.run(runnerArgv(runner.root, runner.kind, relativePath(root, testPath)), {
        cwd: root,
        env: { CI: '1' },
        timeoutMs: timeBudgetMs(greenRunMs),
      })
      outcome = catchOutcome(run)
    } catch {
      outcome = catchOutcome('timeout')
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
    $.ui.toast(`dope-tdd: ${relativePath(root, path)} changed during the catch check and was left as is; see /tdd`)
    $.ui.log(`dope-tdd: ${path} changed while reverted; the text before the check is kept under ${journalKey}`)
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

function lockedMessage(module: string): string {
  return `dope-tdd: write the failing test first. Touch tests/${module}.test.ts(x) before editing src/${module}.`
}

function sourceModuleOf(root: string, path: string): string | null {
  const target = classifyPath(root, absolutePath(root, path))
  return target.kind === 'source' ? target.module : null
}

function beforeText(file: FileRead): string | null {
  return file.kind === 'text' ? file.text : null
}

function beforeState(file: FileRead): BeforeState | undefined {
  return file.kind === 'text' ? undefined : file.kind
}

async function guardFileWrite(
  $: EngineInterface,
  filePath: string,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  const target = classifyPath(root, filePath)
  const isConfig = relativePath(root, filePath) === CONFIG_FILE
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'
  const policy = target.kind === 'source' ? policyFor(config, relativePath(root, filePath)) : null
  if (policy === 'exempt') {
    return proceed()
  }
  const isLocked = target.kind === 'source' && current.unlocked[target.module] === undefined

  if (isLocked && policy === 'enforce' && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => recordBlocked(s, target.module, nowMs))
    return { deny: lockedMessage(target.module) }
  }

  const before = target.kind === 'source' && !current.paused ? await readFile($, filePath) : undefined
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
    const detail = describeConfigChange(config, await loadConfig($, root))
    if (detail === null) {
      return result
    }
    await change($, s => recordConfigChange(s, detail, nowMs))
    $.ui.toast(`dope-tdd: ${CONFIG_FILE} changed: ${detail}`)
    return withContext(result, [configChangedAdvice(detail)])
  }
  if (target.kind === 'source') {
    const inheritedAt = current.reminded.includes(target.module) ? undefined : current.inherited[target.module]
    const after = before === undefined ? null : await readWhole($, filePath)
    const edited = await change($, s => {
      const recorded = markReminded(recordSourceEdit(s, target.module, !isLocked, nowMs), target.module)
      return before === undefined || after === null
        ? recorded
        : recordChange(recorded, target.module, filePath, beforeText(before), after, beforeState(before))
    })
    if (edited.paused) {
      return result
    }
    if (isLocked) {
      return tell(quiet, result, policy === 'warn' ? [unguardedAdvice(target.module)] : [])
    }
    const testPath = edited.unlocked[target.module]
    return inheritedAt === undefined || testPath === undefined
      ? result
      : tell(quiet, result, [inheritedAdvice(target.module, relativePath(root, testPath), nowMs - inheritedAt)])
  }
  if (target.kind === 'test') {
    const touched = await change($, s => recordTestTouch(s, { module: target.module, testPath: filePath }, nowMs))
    await rememberUnlock($, root, target.module, filePath, nowMs)
    const source = await readWhole($, filePath)
    const hollow = source !== null && !hasAssertion(source) ? [hollowAdvice(relativePath(root, filePath))] : []
    return touched.paused ? result : tell(quiet, result, [touchAdvice(target.module), ...hollow])
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

function changedOfKind(root: string, paths: string[], kind: 'source' | 'test'): ChangedFile[] {
  return paths.flatMap(path => {
    const target = classifyPath(root, `${root}/${path}`)
    return target.kind === kind ? [{ path, module: target.module }] : []
  })
}

async function snapshotWatched($: EngineInterface, root: string): Promise<SourceSnapshot | null> {
  const numstat = await runGit($, root, ['diff', '--numstat', '--relative', '--', ...WATCHED_DIRS])
  const untracked = await runGit($, root, ['ls-files', '--others', '--exclude-standard', '--', ...WATCHED_DIRS])
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
function failedModules(root: string, files: string[]): string[] {
  return files.flatMap(file => {
    const target = classifyPath(root, absolutePath(root, file))
    return target.kind === 'test' ? [target.module] : []
  })
}

async function guardShell(
  $: EngineInterface,
  command: string,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'

  const writes = findSourceWrites(command).map(path => ({
    path: absolutePath(root, path),
    module: sourceModuleOf(root, path),
    policy: policyFor(config, relativePath(root, path)),
  }))
  const locked = writes.flatMap(({ module, policy }) =>
    module !== null && policy === 'enforce' && current.unlocked[module] === undefined ? [module] : [],
  )
  if (locked.length > 0 && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => locked.reduce((acc, module) => recordBlocked(acc, module, nowMs), s))
    return { deny: locked.map(lockedMessage).join('\n') }
  }
  if (writes.some(({ module }) => module !== null) && isChecking(current, await $.clock.now())) {
    return { deny: checkingMessage(current.checking?.module ?? 'this module') }
  }

  const before = await snapshotWatched($, root)
  const expectedWrites = current.paused
    ? []
    : writes.flatMap(({ path, module, policy }) => (module === null || policy === 'exempt' ? [] : [{ path, module }]))
  const textsBefore = await Promise.all(expectedWrites.map(async write => ({ ...write, before: await readFile($, write.path) })))
  const startedMs = await $.clock.now()
  const result = await proceed()
  if (result.deny !== undefined) {
    return result
  }
  const after = before === null ? null : await snapshotWatched($, root)
  const nowMs = await $.clock.now()

  const changed = before === null || after === null || isRevertCommand(command) ? [] : changedPaths(before, after)
  const touchedTests = changedOfKind(root, changed, 'test')
  const changedSources = changedOfKind(root, changed, 'source').filter(({ path }) => policyFor(config, path) !== 'exempt')
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
  const unguardedPaths = changedSources
    .filter(source => updated.unlocked[source.module] === undefined && policyFor(config, source.path) !== 'observe')
    .map(source => source.path)

  const output = result.text ?? ''
  // A command held for approval or refused never ran: no run to read, nothing to count.
  const ran = isTestRun(command) && !(result.isError === true && neverRan(output))
  const outcome = ran ? runOutcome(output) : 'none'
  let afterRun = updated
  let elsewhere: string[] = []
  if (outcome === 'unknown') {
    afterRun = await change($, s => recordUnreadRun(s, nowMs))
  } else if (outcome !== 'none') {
    const named = TEST_FILE_IN_COMMAND.exec(command)?.[1]
    const target = named === undefined ? null : classifyPath(root, absolutePath(root, named))
    const targeted = target?.kind === 'test' ? await change($, s => recordRunTarget(s, target.module)) : updated
    if (outcome === 'fail') {
      const failed = failedFiles(output)
      const own = targeted.current?.module
      // The suite is red; the module is red only if its own test is among the files that failed.
      elsewhere = failed.length > 0 && own !== undefined && !failedModules(root, failed).includes(own) ? failed : []
    }
    afterRun = await change($, s => recordRun(s, outcome === 'pass', nowMs, elsewhere))
  }
  const passedModule = outcome === 'pass' && !afterRun.paused ? afterRun.current?.module : undefined
  const check = passedModule === undefined ? 'unchecked' : await verifyCatch($, root, afterRun, passedModule, nowMs - startedMs, nowMs)
  // Red, then the test edited, then green with the module's code unchanged: the green came from the test.
  const testChanged = passedModule !== undefined && check === 'unchecked' && updated.sawRed && updated.testChangedAfterRed
  if (passedModule !== undefined) {
    await change($, s => {
      const counted = recordCatch(s, passedModule, check, nowMs)
      return testChanged ? recordTestChanged(counted, passedModule, nowMs) : counted
    })
  }
  const advice =
    outcome === 'none'
      ? null
      : outcome === 'unknown'
        ? unreadRunAdvice(isTruncated(output))
        : runAdvice(updated, afterRun, check === 'unchecked' ? undefined : check, { elsewhere, testChanged })

  const reminders = current.paused
    ? []
    : [
        ...unguardedPaths.map(path => `dope-tdd: ${path} changed through a shell command without a test touched first.`),
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
  const stored = freshUnlocks(await $.store.get(unlockKey(root)), nowMs)
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
    await repairInterruptedCheck($)
    await seedRememberedUnlocks($)
    await loadConfig($, await $.session.root())
    await $.command.register({ name: 'tdd', description: 'Show the TDD guard status and recent events; /tdd why explains the words on the band' })
    await $.tool.register({
      name: 'status',
      description: 'Report the TDD guard state: paused or on, phase, current module, counts, and the recent event log.',
    })
    return started
  })

  on('command.run', { command: 'tdd' }, async ($, e) => {
    const wantsGlossary = e.args.trim().toLowerCase() === 'why'
    return { text: wantsGlossary ? formatGlossary() : await currentStatus($) }
  })

  on('tool.call', { tool: STATUS_TOOL }, async $ => ({ result: await currentStatus($) }) as ToolCallResult)

  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    guardFileWrite($, e.file_path, () => next(e)),
  )

  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    guardFileWrite($, e.file_path, () => next(e)),
  )

  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    guardShell($, e.command, () => next(e)),
  )

  // Windows sessions run their shell through this tool; test runs, writes and the git backstop are the same story.
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) =>
    guardShell($, e.command, () => next(e)),
  )

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
