import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { TddStats } from '../types'
import { findSourceWrites } from './bashWrites'
import { hollowAdvice, inheritedAdvice, runAdvice, touchAdvice } from './advice'
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
  recordRun,
  recordRunTarget,
  recordSourceEdit,
  recordTestTouch,
  resetStats,
  seedUnlocks,
  togglePause,
} from './stats'
import { formatStatus } from './summary'
import { freshUnlocks, hasAssertion, unlockKey } from './unlocks'

const MINUTE = 60_000
const TEST_PANE = 'red-first-test'
const STATUS_TOOL = /^mcp__red-first__status$/
const MAX_SOURCE_CHARS = 10_000
const WATCHED_DIRS = ['src', 'tests']
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

  if (target.kind === 'source' && !current.paused && current.unlocked[target.module] === undefined) {
    const nowMs = await $.clock.now()
    await change($, s => recordBlocked(s, target.module, nowMs))
    return { deny: lockedMessage(target.module) }
  }

  const result = await proceed()
  if (!succeeded(result)) {
    return result
  }

  const nowMs = await $.clock.now()
  if (target.kind === 'source') {
    const inheritedAt = current.reminded.includes(target.module) ? undefined : current.inherited[target.module]
    const edited = await change($, s => markReminded(recordSourceEdit(s, target.module, true, nowMs), target.module))
    const testPath = edited.unlocked[target.module]
    return inheritedAt === undefined || testPath === undefined || edited.paused
      ? result
      : withContext(result, [inheritedAdvice(target.module, relativePath(root, testPath), nowMs - inheritedAt)])
  }
  if (target.kind === 'test') {
    const touched = await change($, s => recordTestTouch(s, { module: target.module, testPath: filePath }, nowMs))
    await rememberUnlock($, root, target.module, filePath, nowMs)
    const source = await readSource($, filePath)
    const hollow = source !== null && !hasAssertion(source) ? [hollowAdvice(relativePath(root, filePath))] : []
    return touched.paused ? result : withContext(result, [touchAdvice(target.module), ...hollow])
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

  const writtenModules = await Promise.all(findSourceWrites(command).map(path => sourceModuleOf($, root, path)))
  const locked = writtenModules.filter(
    (module): module is string => module !== null && current.unlocked[module] === undefined,
  )
  if (locked.length > 0 && !current.paused) {
    const nowMs = await $.clock.now()
    await change($, s => locked.reduce((acc, module) => recordBlocked(acc, module, nowMs), s))
    return { deny: locked.map(lockedMessage).join('\n') }
  }

  const before = await snapshotWatched($, root)
  const result = await proceed()
  if (result.deny !== undefined) {
    return result
  }
  const after = before === null ? null : await snapshotWatched($, root)
  const nowMs = await $.clock.now()

  const changed = before === null || after === null || isRevertCommand(command) ? [] : changedPaths(before, after)
  const touchedTests = changedOfKind(root, changed, 'test')
  const changedSources = changedOfKind(root, changed, 'source')
  const updated = await change($, s => {
    const withTouches = touchedTests.reduce(
      (acc, { path, module }) => recordTestTouch(acc, { module, testPath: `${root}/${path}` }, nowMs),
      s,
    )
    return changedSources.reduce(
      (acc, { module }) => recordSourceEdit(acc, module, acc.unlocked[module] !== undefined, nowMs),
      withTouches,
    )
  })
  for (const { path, module } of touchedTests) {
    await rememberUnlock($, root, module, `${root}/${path}`, nowMs)
  }
  const unguardedPaths = changedSources
    .filter(source => updated.unlocked[source.module] === undefined)
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
  const advice = outcome === 'none' ? null : runAdvice(updated, afterRun)

  const reminders = current.paused
    ? []
    : [
        ...unguardedPaths.map(path => `red-first: ${path} changed through a shell command without a test touched first.`),
        ...(advice === null ? [] : [advice]),
      ]
  return withContext(result, reminders)
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
  return formatStatus(await readStats($), await $.clock.now())
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
