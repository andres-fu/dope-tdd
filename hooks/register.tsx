import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { CatchOutcome, TddStats } from '../types'
import { findSourceWrites } from './bashWrites'
import { catchOutcome, runnerArgv, timeBudgetMs } from './catchCheck'
import type { RunnerKind } from './catchCheck'
import { CONFIG_FILE, parseConfig, policyFor } from './config'
import type { GuardConfig } from './config'
import { hollowAdvice, inheritedAdvice, runAdvice, touchAdvice, unguardedAdvice } from './advice'
import { drawBand, drawTestPane } from './draw'
import { changedPaths, isRevertCommand, parseNumstat } from './gitChanges'
import type { SourceSnapshot } from './gitChanges'
import { classifyPath, isTestRun, relativePath } from './mirror'
import { runOutcome } from './runOutcome'
import {
  INITIAL_STATS,
  expireCurrent,
  markReminded,
  normalizeStats,
  recordBlocked,
  recordCatch,
  recordChange,
  recordRun,
  recordRunTarget,
  recordSourceEdit,
  recordTestTouch,
  resetStats,
  seedUnlocks,
  setChecking,
  togglePause,
} from './stats'
import { formatStatus } from './summary'
import { freshUnlocks, hasAssertion, unlockKey } from './unlocks'

const MINUTE = 60_000
const TEST_PANE = 'red-first-test'
const STATUS_TOOL = /^mcp__red-first__status$/
const MAX_SOURCE_CHARS = 10_000
const WATCHED_DIRS = ['src', 'tests']
const JOURNAL_PREFIX = 'catch-journal:'
const TEST_FILE_IN_COMMAND = /(?:^|[\s'"])((?:[A-Za-z]:)?[\w./\\-]*tests[/\\][\w./\\-]+\.test\.tsx?)/

const stats = atom({ plugin: 'red-first', key: 'stats' } as const, INITIAL_STATS)
const tick = atom({ plugin: 'red-first', key: 'tick' } as const, 0)

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
  return parseConfig(await readWhole($, `${root}/${CONFIG_FILE}`))
}

function tell(quiet: boolean, result: ToolCallResult, lines: string[]): ToolCallResult {
  return quiet ? result : withContext(result, lines)
}

function absolutePath(root: string, path: string): string {
  return /^([A-Za-z]:|[\\/])/.test(path) ? path : `${root}/${path}`
}

function checkingMessage(module: string): string {
  return `red-first is verifying that the test for ${module} catches the change; retry in a moment.`
}

async function readWhole($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function detectRunner($: EngineInterface, root: string): Promise<RunnerKind | null> {
  if (await $.fs.exists(`${root}/node_modules/vitest/vitest.mjs`)) {
    return 'vitest'
  }
  if (await $.fs.exists(`${root}/node_modules/jest/bin/jest.js`)) {
    return 'jest'
  }
  return null
}

type Journal = { files: { path: string; text: string }[] }

function isJournal(value: unknown): value is Journal {
  return typeof value === 'object' && value !== null && Array.isArray((value as Journal).files)
}

async function repairInterruptedCheck($: EngineInterface): Promise<void> {
  const key = `${JOURNAL_PREFIX}${await $.session.root()}`
  const journal = await $.store.get(key)
  if (!isJournal(journal) || journal.files.length === 0) {
    return
  }
  for (const file of journal.files) {
    await $.fs.write(file.path, file.text)
  }
  await $.store.delete(key)
  $.ui.toast(`red-first restored ${journal.files.length} file(s) after an interrupted check`)
}

async function verifyCatch(
  $: EngineInterface,
  root: string,
  s: TddStats,
  module: string,
  greenRunMs: number,
): Promise<CatchOutcome | 'unchecked' | 'refactor'> {
  const changes = Object.values(s.changes)
  const testPath = s.unlocked[module]
  if (changes.length === 0 || testPath === undefined || changes.every(cycleChange => cycleChange.before === cycleChange.after)) {
    return 'unchecked'
  }
  if (changes.every(cycleChange => cycleChange.kind === 'refactor')) {
    return 'refactor'
  }
  for (const cycleChange of changes) {
    if ((await readWhole($, cycleChange.path)) !== cycleChange.after) {
      return { kind: 'unverified', reason: 'changed outside' }
    }
  }
  const runner = await detectRunner($, root)
  if (runner === null) {
    return catchOutcome('no-runner')
  }
  const revertible = changes.filter((cycleChange): cycleChange is { path: string; before: string; after: string } => cycleChange.before !== null)
  if (revertible.length === 0) {
    return { kind: 'caught' }
  }

  const journalKey = `${JOURNAL_PREFIX}${root}`
  await $.store.set(journalKey, { files: revertible.map(cycleChange => ({ path: cycleChange.path, text: cycleChange.after })) })
  await change($, state => setChecking(state, true))
  let outcome: CatchOutcome
  try {
    for (const cycleChange of revertible) {
      await $.fs.write(cycleChange.path, cycleChange.before)
    }
    try {
      const run = await $.process.run(runnerArgv(root, runner, relativePath(root, testPath)), {
        cwd: root,
        env: { CI: '1' },
        timeoutMs: timeBudgetMs(greenRunMs),
      })
      outcome = catchOutcome(run)
    } catch {
      outcome = catchOutcome('timeout')
    }
  } finally {
    for (const cycleChange of revertible) {
      await $.fs.write(cycleChange.path, cycleChange.after)
    }
    await change($, state => setChecking(state, false))
  }

  const restored = await Promise.all(revertible.map(async cycleChange => (await readWhole($, cycleChange.path)) === cycleChange.after))
  if (!restored.every(Boolean)) {
    $.ui.toast('red-first could not restore a source file after the catch check; see /tdd')
    $.ui.log(`red-first: restore failed for ${revertible.map(cycleChange => cycleChange.path).join(', ')}; journal kept under ${journalKey}`)
    return { kind: 'unverified', reason: 'restore failed' }
  }
  await $.store.delete(journalKey)
  return outcome
}

function lockedMessage(module: string): string {
  return `red-first: write the failing test first. Touch tests/${module}.test.ts(x) before editing src/${module}.`
}

async function sourceModuleOf($: EngineInterface, root: string, path: string): Promise<string | null> {
  const isAbsolute = /^([A-Za-z]:|[\\/])/.test(path)
  const target = classifyPath(root, isAbsolute ? path : `${root}/${path}`)
  return target.kind === 'source' ? target.module : null
}

async function guardFileWrite(
  $: EngineInterface,
  filePath: string,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  const target = classifyPath(root, filePath)
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
  if (current.checking && target.kind !== 'other') {
    return { deny: checkingMessage(current.current?.module ?? target.module) }
  }

  const before = target.kind === 'source' && !current.paused ? await readWhole($, filePath) : undefined
  const result = await proceed()
  if (!succeeded(result)) {
    return result
  }

  const nowMs = await $.clock.now()
  if (target.kind === 'source') {
    const inheritedAt = current.reminded.includes(target.module) ? undefined : current.inherited[target.module]
    const after = before === undefined ? null : await readWhole($, filePath)
    const edited = await change($, s => {
      const recorded = markReminded(recordSourceEdit(s, target.module, !isLocked, nowMs), target.module)
      return before === undefined || after === null ? recorded : recordChange(recorded, target.module, filePath, before, after)
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
    const source = await readSource($, filePath)
    const hollow = source !== null && !hasAssertion(source) ? [hollowAdvice(relativePath(root, filePath))] : []
    return touched.paused ? result : tell(quiet, result, [touchAdvice(target.module), ...hollow])
  }
  return result
}

async function runGit($: EngineInterface, root: string, args: string[]): Promise<string | null> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['git', ...args], { cwd: root })
    if (exitCode !== 0) {
      $.ui.log(`red-first: git ${args.join(' ')} exited ${exitCode}: ${stderr.trim()}`)
      return null
    }
    return stdout
  } catch (error) {
    $.ui.log(`red-first: could not run git ${args.join(' ')}: ${String(error)}`)
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

async function guardBash(
  $: EngineInterface,
  command: string,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const root = await $.session.root()
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'

  const writes = await Promise.all(
    findSourceWrites(command).map(async path => ({
      path: absolutePath(root, path),
      module: await sourceModuleOf($, root, path),
      policy: policyFor(config, relativePath(root, path)),
    })),
  )
  const locked = writes.flatMap(({ module, policy }) =>
    module !== null && policy === 'enforce' && current.unlocked[module] === undefined ? [module] : [],
  )
  if (locked.length > 0 && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => locked.reduce((acc, module) => recordBlocked(acc, module, nowMs), s))
    return { deny: locked.map(lockedMessage).join('\n') }
  }
  if (current.checking && writes.some(({ module }) => module !== null)) {
    return { deny: checkingMessage(current.current?.module ?? 'this module') }
  }

  const before = await snapshotWatched($, root)
  const expectedWrites = current.paused
    ? []
    : writes.flatMap(({ path, module, policy }) => (module === null || policy === 'exempt' ? [] : [{ path, module }]))
  const textsBefore = await Promise.all(expectedWrites.map(async write => ({ ...write, before: await readWhole($, write.path) })))
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
      (acc, write) => (write.after === null ? acc : recordChange(acc, write.module, write.path, write.before, write.after)),
      withEdits,
    )
  })
  for (const { path, module } of touchedTests) {
    await rememberUnlock($, root, module, `${root}/${path}`, nowMs)
  }
  const unguardedPaths = changedSources
    .filter(source => updated.unlocked[source.module] === undefined && policyFor(config, source.path) !== 'observe')
    .map(source => source.path)

  const outcome = isTestRun(command) ? runOutcome(result.text ?? '', result.isError === true) : 'none'
  let afterRun = updated
  if (outcome !== 'none') {
    const named = TEST_FILE_IN_COMMAND.exec(command)?.[1]
    const target = named === undefined ? null : classifyPath(root, /^([A-Za-z]:)?[\\/]/.test(named) ? named : `${root}/${named}`)
    if (target?.kind === 'test') {
      await change($, s => recordRunTarget(s, target.module))
    }
    afterRun = await change($, s => recordRun(s, outcome === 'pass', nowMs))
  }
  const passedModule = outcome === 'pass' && !afterRun.paused ? afterRun.current?.module : undefined
  const check = passedModule === undefined ? 'unchecked' : await verifyCatch($, root, afterRun, passedModule, nowMs - startedMs)
  if (passedModule !== undefined) {
    await change($, s => recordCatch(s, passedModule, check, nowMs))
  }
  const advice = outcome === 'none' ? null : runAdvice(updated, afterRun, check === 'unchecked' ? undefined : check)

  const reminders = current.paused
    ? []
    : [
        ...unguardedPaths.map(path => `red-first: ${path} changed through a shell command without a test touched first.`),
        ...(advice === null ? [] : [advice]),
      ]
  return tell(quiet, result, reminders)
}

async function lastModifiedMs($: EngineInterface, path: string): Promise<number | null> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch (error) {
    $.ui.log(`red-first: could not stat ${path}: ${String(error)}`)
    return null
  }
}

async function readSource($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.read(path)).slice(0, MAX_SOURCE_CHARS)
  } catch (error) {
    $.ui.log(`red-first: could not read ${path}: ${String(error)}`)
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
    await $.command.register({ name: 'tdd', description: 'Show the TDD guard status and recent events' })
    await $.tool.register({
      name: 'status',
      description: 'Report the TDD guard state: paused or on, phase, current module, counts, and the recent event log.',
    })
    return started
  })

  on('command.run', { command: 'tdd' }, async $ => ({ text: await currentStatus($) }))

  on('tool.call', { tool: STATUS_TOOL }, async $ => ({ result: await currentStatus($) }) as ToolCallResult)

  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    guardFileWrite($, e.file_path, () => next(e)),
  )

  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    guardFileWrite($, e.file_path, () => next(e)),
  )

  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    guardBash($, e.command, () => next(e)),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const current = await readStats($)
    if (e.props.hasSurvey || !hasActivity(current)) {
      return next(e)
    }

    const nowMs = await $.clock.now()
    const modifiedMs = current.current ? await lastModifiedMs($, current.current.testPath) : null
    const logo = e.surface === 'terminal' ? null : await loadLogo($)

    return drawBand($.ui.resolve(e), {
      stats: current,
      nowMs,
      modifiedMs,
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
