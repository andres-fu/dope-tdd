import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { CatchOutcome, TddStats } from '../types'
import { beforeText, captureEdit, recordFileEdit, recordShellChanges, unguardedShellPaths } from './afterWrite.ts'
import type { FileRead } from './afterWrite.ts'
import { findSourceWrites, writesFileNamed } from './bashWrites.ts'
import { findRunner } from './findRunner.ts'
import type { FoundRunner } from './findRunner.ts'
import { briefingText } from './briefing.ts'
import { SPIKE_SKILL, removeFolderArgv, spikeQuestion, staleSpikes } from './spike.ts'
import { freshLeftRed, leftRedAtEnd, leftRedKey, leftRedNote } from './leftRed.ts'
import { importCandidates, testsItsOwnModule } from './imports.ts'
import { changedLines } from './changedLines.ts'
import { catchOutcome, linkArgv, nestedPackageDirs, runFailure, runnerArgv, timeBudgetMs, unlinkArgv, worktreeFailureReason } from './catchCheck.ts'
import type { RunnerKind, WorktreeFailure } from './catchCheck.ts'
import { CONFIG_FILE, approverOf, describeConfigChange, isLoosening, parseConfig, pauseLimit, policyFor } from './config.ts'
import type { Approver } from './config.ts'
import { buildLabel, manifestVersion } from './build.ts'
import { applyBar, failureVerdict, moduleHunks, parseVerdict, reviewPrompt, reviewerFor } from './reviewer.ts'
import type { ReviewResult } from './reviewer.ts'
import type { GuardConfig } from './config.ts'
import {
  assertionsRemovedAdvice,
  carryWaitMessage,
  commentedOutAdvice,
  configChangedAdvice,
  commentsOnlyAdvice,
  hollowAdvice,
  importAdvice,
  hollowTouchAdvice,
  inheritedAdvice,
  runAdvice,
  skippedAdvice,
  staleUnlockNote,
  touchAdvice,
  unguardedAdvice,
  unreadRunAdvice,
} from './advice.ts'
import { drawBand, drawTestPane } from './draw.tsx'
import { bringsInCode, changedPaths, gitVerb, isGitOnly, isRevertOnly, parseNumstat, savedStateOf } from './gitChanges.ts'
import { flipsAngles, mutantsOf } from './mutate.ts'
import type { SourceSnapshot } from './gitChanges.ts'
import { findGitOperation, gitDirFromFile } from './gitOperation.ts'
import type { GitOperation } from './gitOperation.ts'
import { learnRoot, rootOfAgent } from './agentRoots.ts'
import type { AgentRoots } from './agentRoots.ts'
import { classifyPath, extOf, isInsideRoot, moduleLabel, pathKey, relativePath, respelled, sameCheckout, sourcePathFor, testFileFor, testPathFor, watchedDirs, worktreeRootFor } from './mirror.ts'
import { failedCountIn, failedFilesIn, failedOnlyOnErrors, failedTestsIn, failureMessage, filtersTests, isNodeTestRun, isPureTestRun, isTestRun, namedOtherFiles, namedTestFile, namesFailedFiles, nodeRunnerCrashed, readRun, runnerNamed, runsWholeFolder, testRunLocation, workspaceTarget } from './runners.ts'
import { isTruncated, neverRan, runnerDidNotStart, unreadableRunner } from './runOutcome.ts'
import { changedRecords, sealRecord, sessionLogPath, sessionRecord } from './sessionLog.ts'
import type { RecordEntry } from './sessionLog.ts'
import { ELSEWHERE, cwdAfter, isPureRead } from './shell.ts'
import { gateShellWrites, judgeFailures, shellGate, shellReminders } from './shellVerdict.ts'
import { absolutePath, applyRun, failedTestPaths, failingTestFiles } from './runPlan.ts'
import type { RunPlan } from './runPlan.ts'
import { detectStackFrom, stackOf } from './stacks.ts'
import type { StackName } from './stacks.ts'
import { formatSetup, inferLayout, isCodeFile, layoutMismatch, suggestedConfig } from './setup.ts'
import { catchWord, countsAsUnwatched, lastRunLine, lastRunTarget } from './bandModel.ts'
import type { Saved } from './bandModel.ts'
import type { Survey } from './setup.ts'
import {
  CHECK_LOCK_TTL_MS,
  INITIAL_STATS,
  acquireCheck,
  expireCurrent,
  isChecking,
  moduleState,
  normalizeStats,
  recordBlocked,
  recordCarryWait,
  recordCatch,
  recordCommentTouch,
  recordConfigChange,
  recordGuardFailure,
  recordGitIn,
  recordImportUnlock,
  recordImporter,
  recordKnownFailures,
  recordRedNames,
  recordReportedElsewhere,
  recordRunTime,
  recordSameRed,
  recordUnwatchedEdit,
  recordStaleUnlocks,
  recordTestChanged,
  recordPinSkill,
  recordSpike,
  recordTestTouch,
  releaseCurrent,
  recordUnreadRun,
  recordWorkaround,
  releaseCheck,
  resetStats,
  seedUnlocks,
  togglePause,
} from './stats.ts'
import { formatGlossary, formatStatus } from './summary.ts'
import { contentHash, freshUnlocks, hasAssertion, legacyUnlockKey, sameIgnoringLineEndings, staleUnlockKeys, storeRoot, unlockEntry, unlockKey } from './unlocks.ts'
import { commentedOutLines, testEditSignals } from './workarounds.ts'
import { checkingMessage, experimentalCheckReason, lockedFor, standingDownLine } from './refusals.ts'
import type { LockedFacts } from './refusals.ts'
import { OVERRIDES_FILE, coveringOverride, isAttended, formatOverrides, parseRecord, recordEdit, requestNotes, serializeRecord } from './overrides.ts'
import { planDecision, planEnd, planExpiry, planRequest, planResume, planShellCover, refusal, requestFrom, sendsToModel } from './requestPlan.ts'
import { gateWrite } from './fileGate.ts'
import type { Override, OverrideRequest, Review } from '../types'
import { succeeded, tell, withContext } from './toolResult.ts'
import { isExpired, keptNotice, keptPathFor, pruneArgv, PRUNED_FOLDERS } from './retention.ts'
import { JOURNAL_PREFIX, SHARED_LOCK_REF, elsewhereNotice, journalEntry, journalFiles, journalKeyFor, parseLock, sharedLockKey } from './checkJournal.ts'
import type { SharedLock } from './checkJournal.ts'

const MINUTE = 60_000
const TEST_PANE = 'dope-tdd-test'
/** The pane "last run" on the band opens: the test file that run was (bandModel.ts, lastRunTarget). */
const LAST_RUN_PANE = 'dope-tdd-last-run'
const STATUS_TOOL = /^mcp__dope-tdd__status$/
const MAX_SOURCE_CHARS = 10_000
/** Where a change left alone after a check is kept, next to its source, named in the toast. */
const SURVEY_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'out', '.next', '.cache', 'target', 'vendor'])
const SURVEY_DEPTH = 6
const SURVEY_CAP = 5_000

const stats = atom({ plugin: 'dope-tdd', key: 'stats' } as const, INITIAL_STATS)
const tick = atom({ plugin: 'dope-tdd', key: 'tick' } as const, 0)
/** Where each of the agent's shells is: Claude Code keeps it between calls, and resets it to the root when a cd leaves the project. */
const bashCwd = atom({ plugin: 'dope-tdd', key: 'bash-cwd' } as const, '')
const powershellCwd = atom({ plugin: 'dope-tdd', key: 'powershell-cwd' } as const, '')
/** The git operation the guard last stood down for, or '': kept so the start and the end are each said once. */
const gitOperation = atom({ plugin: 'dope-tdd', key: 'git-operation' } as const, '')
/** The runners this session ran whose summary dope-tdd cannot read yet, each named to the agent once. */
const unreadRunners = atom({ plugin: 'dope-tdd', key: 'unread-runners' } as const, [] as readonly string[])
/** The repo's override record (dope-tdd.overrides.json), kept here too so the band never reads the file to draw. */
const overrideRecord = atom({ plugin: 'dope-tdd', key: 'overrides' } as const, [] as readonly Override[])
/** Whether the current module's work is committed or pushed, read from git after each tool call while green; '' module before. */
const savedAtom = atom({ plugin: 'dope-tdd', key: 'saved' } as const, { module: '', state: 'uncommitted' } as Saved)
/** Whether a person is there to approve an override; unknown counts as there, as in a session the tests start bare. */
const attended = atom({ plugin: 'dope-tdd', key: 'attended' } as const, true)
const OVERRIDE_TOOL = /^mcp__dope-tdd__override_request$/
const RECORD_DENY = `dope-tdd keeps this record (${OVERRIDES_FILE}). Ask for an override with mcp__dope-tdd__override_request; a person decides it with /tdd approve or /tdd deny.`
/** Which dope-tdd is running (build.ts): read once at session start, shown first in /tdd and kept in the session log. */
const buildAtom = atom({ plugin: 'dope-tdd', key: 'build' } as const, '')
/**
 * This session's id, read once at its start (2026-10-18): the band asked the engine for it on every draw. '' until
 * read; /clear, /resume and /branch empty $.state, so they read it again, and a draw before any read asks the engine.
 */
const sessionIdAtom = atom({ plugin: 'dope-tdd', key: 'session-id' } as const, '')
type ShellName = 'bash' | 'powershell'

/** Each subagent's worktree, learned from the paths it names (agentRoots.ts); the main loop is never listed. */
const agentRootsAtom = atom({ plugin: 'dope-tdd', key: 'agent-roots' } as const, {} as AgentRoots)
/** Where each subagent's shells are, by `<agentId>:<shell>`: one agent's `cd` must not move another's (#198). */
const agentCwds = atom({ plugin: 'dope-tdd', key: 'agent-cwds' } as const, {} as Readonly<Record<string, string>>)

async function placeAgent($: EngineInterface, agentId: string | undefined, path: string | undefined): Promise<void> {
  if (agentId === undefined || path === undefined) {
    return
  }
  const sessionRoot = await $.session.root()
  const roots = await read($, agentRootsAtom)
  const next = learnRoot(roots, agentId, sessionRoot, path)
  if (next !== roots) {
    await update($, agentRootsAtom, () => next)
  }
}

async function agentRoot($: EngineInterface, agentId: string | undefined): Promise<string> {
  return rootOfAgent(await read($, agentRootsAtom), agentId, await $.session.root())
}

async function readCwd($: EngineInterface, shell: ShellName, agentId?: string): Promise<string> {
  if (agentId !== undefined) {
    return (await read($, agentCwds))[`${agentId}:${shell}`] ?? ''
  }
  return shell === 'bash' ? read($, bashCwd) : read($, powershellCwd)
}

async function writeCwd($: EngineInterface, shell: ShellName, cwd: string, agentId?: string): Promise<void> {
  if (agentId !== undefined) {
    await update($, agentCwds, cwds => ({ ...cwds, [`${agentId}:${shell}`]: cwd }))
    return
  }
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
/** What the briefing says about a default layout that matches none of the code (#167), per root; `/tdd setup` looks again. */
const layoutNotes = new Map<string, string | null>()
/** Roots whose interrupted-check journals were looked at since this module loaded (a hot reload starts over). */
const repairedRoots = new Set<string>()
let guardFailureToasted = false

function hasActivity(s: TddStats): boolean {
  // Unwatched edits and unread runs count: the band must show up to say it is not watching (2026-10-18).
  return s.events.length > 0 || s.paused || s.current !== null || s.unwatched.length > 0 || s.unreadRuns > 0
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
  // The test as it is now (#54), so a later session can tell whether it is still the test that earned this unlock.
  // Unreadable: stored without a hash, which a later session keeps (still pending a run) rather than drops.
  await $.store.set(key, { ...stored, [module]: unlockEntry(testPath, nowMs, await readWhole($, testPath)) })
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

/** The rules as the agent is told them, or null in observe mode, which measures how the agent works on its own. */
async function briefing($: EngineInterface): Promise<string | null> {
  const root = await $.session.root()
  const config = await loadConfig($, root)
  if (config.mode === 'observe') {
    return null
  }
  // #167: with no dope-tdd.json the project is walked once per root, so a default that pairs nothing is said.
  if (config.layoutGuessed === true && !layoutNotes.has(root)) {
    layoutNotes.set(root, layoutMismatch(await surveyProject($, root), config))
  }
  const layoutNote = config.layoutGuessed === true ? (layoutNotes.get(root) ?? null) : null
  // Idea 15: the store changes only when a session ends, so the briefing stays the same all session.
  const leftRed = leftRedNote(freshLeftRed(await $.store.get(leftRedKey(root)), await $.clock.now()))
  return briefingText(config, await briefingCommand($, root, config), layoutNote, leftRed)
}

async function configForRender($: EngineInterface, root: string): Promise<GuardConfig> {
  return cachedConfig?.root === root ? cachedConfig.config : loadConfig($, root)
}

async function readOverrides($: EngineInterface, root: string): Promise<Override[]> {
  const record = parseRecord(await readWhole($, `${root}/${OVERRIDES_FILE}`))
  await update($, overrideRecord, () => record)
  return record
}

async function writeOverrides($: EngineInterface, root: string, record: readonly Override[]): Promise<void> {
  await $.fs.write(`${root}/${OVERRIDES_FILE}`, serializeRecord(record))
  await update($, overrideRecord, () => record)
}

async function pauseGuard($: EngineInterface, nowMs: number): Promise<void> {
  if (!(await readStats($)).paused) {
    await change($, s => togglePause(s, nowMs))
  }
}

async function resumeGuard($: EngineInterface, nowMs: number): Promise<void> {
  if ((await readStats($)).paused) {
    await change($, s => togglePause(s, nowMs))
  }
}

/** A pause whose minutes ran out ends here: the guard is back, and the person hears what happened while it was off. */
async function endExpiredPauses($: EngineInterface, root: string, nowMs: number): Promise<void> {
  const expiry = planExpiry(await readOverrides($, root), nowMs)
  if (!expiry.resume) {
    return
  }
  await writeOverrides($, root, expiry.record)
  await resumeGuard($, nowMs)
  for (const line of expiry.summaries) {
    toast($, line)
    $.ui.log(line)
  }
}

/**
 * Every toast goes through here: the app already puts the plugin's name in front of a toast (live trial: "dope-tdd:
 * dope-tdd: ended the override"), so ours drop it, keeping a leading ⚑.
 */
function toast($: EngineInterface, text: string): void {
  $.ui.toast(text.replace(/^(⚑ )?dope-tdd: /, '$1'))
}

/** This session's id, the owner of the overrides it asks for; undefined when the engine cannot say. */
async function sessionIdNow($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

/** Keeps this session's id for the band, when the engine can say it. */
async function rememberSessionId($: EngineInterface): Promise<void> {
  const id = await sessionIdNow($)
  if (id !== undefined) {
    await update($, sessionIdAtom, () => id)
  }
}

/** The id the band draws with: the one kept at the session's start, or the engine's answer when none was kept. */
async function sessionIdForBand($: EngineInterface): Promise<string | undefined> {
  const kept = await read($, sessionIdAtom)
  return kept !== '' ? kept : await sessionIdNow($)
}

/** The build: plugin.json's version, and the last commit when the plugin's own folder is a git checkout (while developed). */
async function readBuild($: EngineInterface): Promise<string> {
  const log = await gitQuiet($, $.plugin.root, ['log', '-1', '--format=%h|%cs|%s'])
  const manifest = (await $.fs.exists(`${$.plugin.root}/.claude-plugin/plugin.json`)) ? await readSource($, `${$.plugin.root}/.claude-plugin/plugin.json`) : null
  return buildLabel(log !== null && log.exitCode === 0 ? log.stdout : null, manifestVersion(manifest))
}

async function surfacesNow($: EngineInterface): Promise<readonly string[]> {
  try {
    return await $.session.surfaces()
  } catch {
    return []
  }
}

function inputText(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' ? value : null
}

/**
 * An override request, from the agent's tool or a person's /tdd pause. The form is checked first (overrides.ts), then
 * the rising bar, then who decides: a person asking is the approver, a hotfix passes as debt, and an agent waits for a
 * person, or is denied when nobody is there. Every outcome but a malformed request is written to the record.
 */
async function requestOverride($: EngineInterface, input: Record<string, unknown>, by: 'agent' | 'human'): Promise<string> {
  const root = await $.session.root()
  const config = await loadConfig($, root)
  const nowMs = await $.clock.now()
  const path = inputText(input, 'path')
  const absolute = path === null ? null : absolutePath(root, path)
  const target = absolute === null ? null : classifyPath(root, absolute, config)
  const request = requestFrom(input, by, {
    module: target !== null && target.kind === 'source' ? target.module : null,
    path: absolute === null ? null : relativePath(root, absolute),
  })
  const record = await readOverrides($, root)
  const refused = refusal(request, record, nowMs, { pauseMaxMinutes: pauseLimit(config) })
  if (refused !== null) {
    return refused
  }
  const approver = approverOf(config)
  const review = approver.approver === 'model' && sendsToModel(request, 'model') ? await reviewRequest($, root, request, requestNotes(record, request, nowMs), approver) : undefined
  const session = await sessionIdNow($)
  // The decisions are requestPlan.ts's; this records them, pauses if asked, and says what it said.
  const planned = planRequest({
    request,
    record,
    nowMs,
    present: isAttended(await read($, attended), await surfacesNow($)),
    labelOf: module => (module === null ? 'every module' : moduleLabel(config, module)),
    ...(review === undefined ? {} : { review }),
    ...(session === undefined ? {} : { session }),
  })
  await writeOverrides($, root, [...record, planned.entry])
  if (planned.pause) {
    await pauseGuard($, nowMs)
  }
  for (const notice of planned.notices) {
    if (notice.toast) {
      toast($, notice.text)
    }
    $.ui.log(notice.text)
  }
  return planned.reply
}

/**
 * The reviewer model, when the repo opted in (reviewer.ts). It gets the rubric as its system prompt, the request as
 * delimited data, dope-tdd's own facts, and the module's and its test's hunks only; no tools. A failed or unreadable
 * answer escalates, and a repeat on the same module cannot be approved by it.
 */
async function reviewRequest($: EngineInterface, root: string, request: OverrideRequest, history: readonly string[], approver: Approver & { approver: 'model' }): Promise<Review> {
  const choice = reviewerFor(approver, await $.session.model())
  const s = await readStats($)
  const unlocked = request.module === null ? undefined : s.unlocked[request.module]
  const testPath = unlocked === undefined ? null : relativePath(root, unlocked)
  const lastCatch = request.module !== null && s.lastCatch?.module === request.module ? catchWord(s.lastCatch.outcome) : null
  const paths = [request.path, testPath].filter((path): path is string => path !== null)
  const diff = paths.length === 0 ? null : await gitQuiet($, root, ['diff', '--no-ext-diff', 'HEAD', '--', ...paths])
  const hunks = moduleHunks(diff === null || diff.exitCode !== 0 ? '' : diff.stdout, paths, 120)
  const { system, prompt } = reviewPrompt(request, { testPath, lastCatch, hunks, history })
  let result: ReviewResult
  try {
    const reply = await $.model.complete({ model: choice.model, effort: choice.effort as never, system, prompt, maxTokens: 300, timeoutMs: 60_000 })
    result = reply.isAnswered ? parseVerdict(reply.text) : failureVerdict(reply.reason === 'api-error' ? `api-error ${reply.status ?? 'no status'}` : reply.reason)
  } catch {
    result = failureVerdict('the call was refused')
  }
  // Only a repeat on the same module raises the bar for the model; requests across modules in a day are the person's note.
  const barred = applyBar(result, history.filter(note => note.endsWith(' this week')))
  return { model: choice.model, effort: choice.effort, verdict: barred.verdict, reason: barred.reason }
}

/** A person's decision on the waiting request, from /tdd or the band. */
async function decidePending($: EngineInterface, approve: boolean, why: string | null): Promise<string> {
  const root = await $.session.root()
  const nowMs = await $.clock.now()
  const record = await readOverrides($, root)
  const config = await loadConfig($, root)
  const decided = planDecision(record, approve, why, nowMs, module => (module === null ? 'every module' : moduleLabel(config, module)))
  if (decided.record.some((o, index) => o !== record[index])) {
    await writeOverrides($, root, decided.record)
    $.ui.log(decided.reply)
  }
  if (decided.pause) {
    await pauseGuard($, nowMs)
  }
  return decided.reply
}

/** /tdd resume (and /tdd on): ends a pause early. Its untested edits stay debt; the person hears how many. */
async function resumeNow($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  const nowMs = await $.clock.now()
  const record = await readOverrides($, root)
  const resumed = planResume(record, (await readStats($)).paused, nowMs)
  if (!resumed.resume) {
    return resumed.reply
  }
  if (resumed.record.some((o, index) => o !== record[index])) {
    await writeOverrides($, root, resumed.record)
  }
  await resumeGuard($, nowMs)
  toast($, 'TDD guard resumed')
  $.ui.log(resumed.reply)
  return resumed.reply
}

/** /tdd override end <module|pause>: a person ends an override; an ended hotfix or module override is no longer debt. */
async function endNamed($: EngineInterface, target: string | undefined): Promise<string> {
  const root = await $.session.root()
  const nowMs = await $.clock.now()
  const record = await readOverrides($, root)
  const ended = planEnd(record, target, nowMs)
  if (ended.record.some((o, index) => o !== record[index])) {
    await writeOverrides($, root, ended.record)
  }
  if (ended.resume) {
    await resumeGuard($, nowMs)
  }
  return ended.reply
}

async function readWhole($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function realPathOf($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.stat(path, { resolve: true })).realPath ?? null
  } catch {
    return null
  }
}

/**
 * The path as the project spells it. A file reached through a symbolic link (macOS reaches /private/tmp through /tmp;
 * a checkout can be a link) is outside the root by its spelling and inside it in fact, and read as outside, its edit
 * would pass unguarded and uncounted. A path inside the root by its spelling costs nothing; any other is resolved,
 * through the nearest folder that exists when the file is not written yet, and kept as it is when it lands elsewhere.
 */
async function projectPath($: EngineInterface, root: string, path: string): Promise<string> {
  if (isInsideRoot(root, path)) {
    return path
  }
  let realRoot = realRoots.get(root)
  if (realRoot === undefined) {
    realRoot = await realPathOf($, root)
    realRoots.set(root, realRoot)
  }
  let probe = path.replace(/\\/g, '/').replace(/\/$/, '')
  let rest = ''
  for (let depth = 0; depth < MAX_RESOLVE_DEPTH; depth++) {
    const real = await realPathOf($, probe)
    if (real !== null) {
      return respelled(root, realRoot, rest === '' ? real : `${real.replace(/\/$/, '')}/${rest}`) ?? path
    }
    const cut = probe.lastIndexOf('/')
    if (cut <= 0) {
      return path
    }
    rest = rest === '' ? probe.slice(cut + 1) : `${probe.slice(cut + 1)}/${rest}`
    probe = probe.slice(0, cut)
  }
  return path
}

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

type Runner = FoundRunner

/** The runner for a test file, found through Claude Code's view of the disk. */
function detectRunner($: EngineInterface, root: string, config: GuardConfig, testPath: string): Promise<Runner | null> {
  return findRunner(
    root,
    config.stack,
    testPath,
    path => $.fs.exists(path),
    path => $.fs.read(path).catch(() => null),
  )
}

let sharedLockUnavailableSaid = false
/** Module and test pairs whose baseline (the check's own command, nothing reverted) was green in this load. */
const baselined = new Set<string>()
/** Each root's real location, every symbolic link followed, or null when it cannot be resolved; asked once per root. */
const realRoots = new Map<string, string | null>()
/** How many folders up a path not written yet is followed to one that exists. */
const MAX_RESOLVE_DEPTH = 64

async function gitQuiet($: EngineInterface, root: string, args: string[], stdin?: string, timeoutMs?: number): Promise<{ exitCode: number; stdout: string } | null> {
  try {
    // The engine stops a run after 30 s by default; a caller that needs longer (a worktree on a big checkout) says so.
    const run = await $.process.run(['git', ...args], { cwd: root, ...(stdin === undefined ? {} : { stdin }), ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    return { exitCode: run.exitCode, stdout: run.stdout }
  } catch {
    return null
  }
}

async function acquireSharedLock($: EngineInterface, root: string, module: string, nowMs: number): Promise<SharedLock> {
  const hashed = await gitQuiet($, root, ['hash-object', '-w', '--stdin'], JSON.stringify({ module, sinceMs: nowMs }))
  if (hashed === null || hashed.exitCode !== 0) {
    // Not a git checkout: the plugin store alone says a check is running, so another session waits for it and its end
    // or start does not "repair" a file this check reverted (verified review A10). Best effort: a store read then write
    // is not atomic across sessions, as a git compare-and-swap is.
    const existing = parseLock(JSON.stringify((await $.store.get(sharedLockKey(root))) ?? null))
    if (existing !== null && nowMs - existing.sinceMs < CHECK_LOCK_TTL_MS) {
      return { kind: 'busy', module: existing.module }
    }
    if (!sharedLockUnavailableSaid) {
      sharedLockUnavailableSaid = true
      $.ui.log('dope-tdd: not a git checkout, so the catch-check lock is kept in the plugin store only, best effort across sessions')
    }
    const token = `store:${nowMs}`
    try {
      await $.store.set(sharedLockKey(root), { module, sinceMs: nowMs, sha: token })
    } catch (error) {
      $.ui.log(`dope-tdd: could not record the check lock in the store: ${String(error)}`)
    }
    return { kind: 'acquired', sha: token }
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

/**
 * Another project's interrupted catch check: told to the user and put on the record, never repaired from here (#89: a
 * session writes only in its own repository). The owner repairs it by opening a session there. Never fails the start.
 */
async function reportJournalsElsewhere($: EngineInterface, root: string, nowMs: number): Promise<void> {
  try {
    const own = await journalKeys($, root)
    const found: { paths: string[]; atMs?: number }[] = []
    for (const key of await $.store.keys()) {
      if (key.startsWith(JOURNAL_PREFIX) && !own.includes(key)) {
        const value = await $.store.get(key)
        const atMs = (value as { atMs?: unknown } | null)?.atMs
        found.push({ paths: (journalFiles(value) ?? []).map(file => file.path), ...(typeof atMs === 'number' ? { atMs } : {}) })
      }
    }
    const notice = elsewhereNotice(found, nowMs)
    if (notice !== null) {
      toast($, notice)
      $.ui.log(notice)
      await change($, s => recordReportedElsewhere(s, notice.replace(/^dope-tdd: /, ''), nowMs))
    }
  } catch (error) {
    $.ui.log(`dope-tdd: could not look for other projects' checks: ${String(error)}`)
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
 * `~/.dope-tdd/kept/<repo>-<hash>/<path>` (retention.ts, keptPathFor), never inside the repository. A second kept
 * copy of the same file gets the time added, so it never overwrites the first (verified review A11).
 */
async function keepAside($: EngineInterface, root: string, path: string, text: string): Promise<string | null> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const temp = (await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? (await $.env.get('TMP'))
  const place = keptPathFor({ home, temp, root, relative: relativePath(root, path) })
  if (place === null) {
    $.ui.log(`dope-tdd: no home or temp folder to keep ${relativePath(root, path)} in; your change is still in the journal`)
    return null
  }
  const kept = (await $.fs.exists(place)) ? `${place}.${await $.clock.now()}` : place
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
  // Only this root's journals: a session writes only in its own repository, never in another project (#89).
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
    toast($, `dope-tdd restored ${restored.length} file(s) after an interrupted check`)
  }
  if (left.length > 0) {
    toast($, `dope-tdd left ${left.length} file(s) alone after an interrupted check; each change is kept, see the log`)
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
    // Counted, so the band and /tdd say GUARD FAILING instead of looking guarded (verified review A13). Best effort:
    // the state may be what failed, and this handler must never throw.
    void (async () => {
      const nowMs = await $.clock.now()
      await change($, s => recordGuardFailure(s, name, nowMs))
    })().catch(() => {})
    if (!guardFailureToasted) {
      guardFailureToasted = true
      toast($, 'dope-tdd hit an internal error and let a call through; see the log')
    }
  } catch {
    // Re-entry: nothing to report with, and nothing to hold.
  }
}

/**
 * How the plugin itself runs one test file: the runner, where it runs (a runner installed in a package runs from that
 * package, so its own config loads; otherwise the root), the test path from there, and the argv. Null with no runner.
 */
async function oneTestCommand(
  $: EngineInterface,
  root: string,
  config: GuardConfig,
  testPath: string,
): Promise<{ runner: Runner; runIn: string; relativeTest: string; argv: string[] } | null> {
  const runner = await detectRunner($, root, config, testPath)
  if (runner === null) {
    return null
  }
  const godot = config.godot ?? (await godotFromEnv($))
  const runIn = runner.root !== root && isInsideRoot(root, runner.root) ? runner.root : root
  const relativeTest = relativePath(runIn, testPath)
  const argv = runnerArgv(runner.root, runner.kind, relativeTest, runner.tool, { godot, ...(runner.launcher === undefined ? {} : { launcher: runner.launcher }) })
  return { runner, runIn, relativeTest, argv }
}

/**
 * Every failing test name in a run of this test file, when the agent's output was cut (a tail kept the summary and
 * lost the names): the plugin runs the file itself, locally, and reads them. Empty when that cannot be done.
 */
async function allFailingNames($: EngineInterface, root: string, config: GuardConfig, testPath: string): Promise<string[]> {
  try {
    const command = await oneTestCommand($, root, config, testPath)
    // The same opt-in as the catch check: observe mode starts nothing, and an experimental runner (the venv python,
    // mvnw, a Godot binary) runs only with "catchCheck": true (verified review A4, 2026-10-20).
    if (command === null || config.mode === 'observe' || (!ISOLATED_RUNNERS.has(command.runner.kind) && config.catchCheck !== true)) {
      return []
    }
    const run = await $.process.run(command.argv, { cwd: command.runIn, env: { CI: '1', DOPE_TDD_NAMES: '1' }, timeoutMs: 60_000 })
    return failedTestsIn(`${run.stdout}\n${run.stderr}`)
  } catch {
    return []
  }
}

/**
 * A catch-check run, run once more when node --test could not read its test process output (a Node bug, #26): one
 * crash is common with non-ASCII output, two in a row rarer. A second crash is left for catchOutcome to call unverified.
 */
async function checkRun($: EngineInterface, argv: string[], init: Parameters<EngineInterface['process']['run']>[1]) {
  const run = await $.process.run(argv, init)
  if (!nodeRunnerCrashed(`${run.stdout}\n${run.stderr}`)) {
    return run
  }
  $.ui.log('dope-tdd: node --test could not read its test process output; ran it once more')
  return $.process.run(argv, init)
}

/** How long `git worktree add` may take: a checkout of a large repository on Windows can pass the 30 s default. */
const WORKTREE_TIMEOUT_MS = 120_000
/** Runners that find packages by walking up from the file, so a worktree inside .git still reaches the project's node_modules. */
const ISOLATED_RUNNERS: ReadonlySet<RunnerKind> = new Set<RunnerKind>(['vitest', 'jest', 'ava', 'node-test'])
// Inside the checkout's own git directory, so watchers and `git status` never see it: `.git/dope-tdd/wt` in a clone,
// `<main>/.git/worktrees/<name>/dope-tdd/wt` in a linked worktree (field test on VibeCast, 2026-10-18: a linked
// worktree, where `.git` is a file, had no isolated check and no small changes, and nothing said so). From there the
// runner walks up to the main checkout's node_modules, and a nested package's is linked in (#168). A test that is not
// green there is unverified, and your file is left alone (verified review A2): it never falls back to the check in place.
const CHECK_WORKTREE = 'dope-tdd/wt'
/** dope-tdd's own pin skill, by its plugin-qualified name or its bare one. */
const PIN_SKILL = /^(?:dope-tdd:)?pin$/
/** More changed files than this and copying them costs more than the check is worth: the check runs in place. */
const MAX_COPIED_FILES = 300
/**
 * How long one verification may spend beyond its first check: no importer check (#25) or further mutant (#27) starts
 * after this. A green that tried its own test, two importers and their retries could otherwise hold the agent for
 * many minutes (review #8).
 */
const VERIFY_BUDGET_MS = 3 * 60_000

type WorktreeCheck = {
  module: string
  path: string
  /** The code to try in the worktree, each in turn: the old code, or a new file's mutants. */
  variants: readonly string[]
  after: string
  runIn: string
  relativeTest: string
  argv: string[]
  greenRunMs: number
  nowMs: number
  known: readonly string[]
  /** Run the green-before check even if this session ran it already: an importer may have gone red since (review #3). */
  fresh?: boolean
  /** No variant starts after this time: the rest are unverified (review #8). */
  deadlineMs?: number
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
/**
 * The test file's content as part of a baseline's key: a green baseline once stayed trusted after the test changed,
 * as it was kept per module and test path only (verified review D9, 2026-10-20).
 */
async function testFingerprint($: EngineInterface, testPath: string): Promise<string> {
  const text = await readWhole($, testPath)
  return text === null ? 'missing' : contentHash(text)
}

/**
 * Removes the check's copy. Links into nested packages go first (#168): unlinkArgv removes only a link and throws on a
 * real folder, so nothing they point at can be reached. `git worktree remove` leaves a folder that still holds a link
 * (checked by hand on Windows, 2026-10-26), and that folder would block the next `worktree add`, so what is left goes
 * too; Node's recursive remove takes a link away without following it (checked the same day).
 */
async function removeCheckWorktree($: EngineInterface, root: string, wt: string, packageDirs: readonly string[]): Promise<void> {
  for (const dir of packageDirs) {
    await $.process.run(unlinkArgv(`${wt}/${dir}/node_modules`), { timeoutMs: 10_000 }).catch(() => undefined)
  }
  await gitQuiet($, root, ['worktree', 'remove', '--force', wt])
  if (await $.fs.exists(wt)) {
    await $.process.run(removeFolderArgv(wt), { timeoutMs: 30_000 }).catch(() => undefined)
  }
}

async function checkInWorktree($: EngineInterface, root: string, check: WorktreeCheck): Promise<CatchOutcome[] | WorktreeFailure> {
  const { module, path, variants, after, runIn, relativeTest, argv, greenRunMs } = check
  const gitDir = await gitDirOf($, root)
  if (gitDir === null) {
    return { step: 'copy' }
  }
  const wt = `${gitDir}/${CHECK_WORKTREE}`
  // The lock's time is when this check starts, not when the run that asked for it did (review #7).
  const lockedAt = await $.clock.now()
  const locked = await change($, state => acquireCheck(state, module, lockedAt))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== lockedAt) {
    return variants.map(() => ({ kind: 'unverified', reason: 'another check was running' }))
  }
  const shared = await acquireSharedLock($, root, module, lockedAt)
  if (shared.kind === 'busy') {
    await change($, releaseCheck)
    return variants.map(() => ({ kind: 'unverified', reason: `another session was checking ${shared.module}` }))
  }
  const sharedSha = shared.kind === 'acquired' ? shared.sha : null
  const packageDirs = nestedPackageDirs(relativePath(root, runIn))
  try {
    await removeCheckWorktree($, root, wt, packageDirs)
    // Checking out a large repository can take longer than the engine's 30 s default (verified review A3).
    // No hooks: `worktree add` runs the repository's post-checkout hook, a program nobody asked the check to run.
    // core.hooksPath points at a folder that does not exist, so git finds none (verified review A16, 2026-10-20).
    const added = await gitQuiet($, root, ['-c', `core.hooksPath=${gitDir}/dope-tdd/no-hooks`, 'worktree', 'add', '--detach', wt, 'HEAD'], undefined, WORKTREE_TIMEOUT_MS)
    if (added === null || added.exitCode !== 0) {
      return { step: 'copy' }
    }
    const dirty = listed(await gitQuiet($, root, ['diff', '--name-only', 'HEAD']))
    const untracked = listed(await gitQuiet($, root, ['ls-files', '--others', '--exclude-standard']))
    const deleted = listed(await gitQuiet($, root, ['diff', '--name-only', '--diff-filter=D', 'HEAD']))
    if (dirty === null || untracked === null || deleted === null) {
      return { step: 'changes' }
    }
    const gone = new Set(deleted)
    const copies = [...new Set([...dirty, ...untracked])].filter(file => !gone.has(file))
    if (copies.length > MAX_COPIED_FILES) {
      return { step: 'too-many', detail: String(MAX_COPIED_FILES) }
    }
    for (const file of copies) {
      const text = await readWhole($, `${root}/${file}`)
      if (text === null) {
        return { step: 'unreadable', detail: file }
      }
      await $.fs.write(`${wt}/${file}`, text)
    }
    for (const file of gone) {
      await gitQuiet($, wt, ['rm', '-q', '--', file])
    }
    // #168: a nested package's node_modules (site/node_modules in an Astro site) is out of the runner's reach from the
    // copy inside .git, so each one on the way down to the run is linked in. Unlinked before the copy is removed.
    for (const dir of packageDirs) {
      const target = `${root}/${dir}/node_modules`
      const link = `${wt}/${dir}/node_modules`
      if ((await $.fs.exists(target)) && !(await $.fs.exists(link))) {
        await $.process.run(linkArgv(target, link), { timeoutMs: 10_000 }).catch(() => undefined)
      }
    }
    const inTree = `${wt}/${relativePath(root, path)}`
    const cwd = runIn === root ? wt : `${wt}/${relativePath(root, runIn)}`
    const budget = timeBudgetMs(greenRunMs)
    // The test must pass in the worktree as the code stands, or the worktree is not the user's project.
    const baselineKey = `wt|${storeRoot(root)}|${module}|${relativeTest.toLowerCase()}|${await testFingerprint($, `${runIn}/${relativeTest}`)}`
    if (check.fresh === true || !baselined.has(baselineKey)) {
      await $.fs.write(inTree, after)
      let base: CatchOutcome
      try {
        base = catchOutcome(await checkRun($, argv, { cwd, env: { CI: '1', DOPE_TDD_BASELINE: '1' }, timeoutMs: budget }), relativeTest, check.known)
      } catch (error) {
        base = catchOutcome(runFailure(error))
      }
      if (base.kind !== 'missed') {
        const detail = base.kind === 'unverified' ? base.reason : 'red'
        $.ui.log(`dope-tdd: the test is not green in the check worktree (${detail}); your file was left alone`)
        return { step: 'not-green', detail }
      }
      baselined.add(baselineKey)
    }
    const outcomes: CatchOutcome[] = []
    for (const variant of variants) {
      if (check.deadlineMs !== undefined && (await $.clock.now()) >= check.deadlineMs) {
        outcomes.push({ kind: 'unverified', reason: 'out of time' })
        continue
      }
      await $.fs.write(inTree, variant)
      try {
        outcomes.push(catchOutcome(await checkRun($, argv, { cwd, env: { CI: '1' }, timeoutMs: budget }), relativeTest, check.known))
      } catch (error) {
        outcomes.push(catchOutcome(runFailure(error)))
      }
    }
    // Counted here, once the test ran in the worktree: a check that found the lock busy ran nothing (debt `review`).
    await change($, state => ({ ...state, worktreeChecks: state.worktreeChecks + 1 }))
    return outcomes
  } catch (error) {
    $.ui.log(`dope-tdd: the check worktree failed (${String(error)}); your file was left alone`)
    return { step: 'error', detail: String(error) }
  } finally {
    await removeCheckWorktree($, root, wt, packageDirs)
    await change($, releaseCheck)
    if (sharedSha !== null) {
      await releaseSharedLock($, root, sharedSha)
    }
  }
}

/**
 * A new file has no old code to put back (#27). In the worktree, with a Node runner, small changes to it are tried
 * instead: one that turns the test red proves the test as a deliberate break would (PROVEN); none means MISSED, with
 * each change named. Null when this cannot run here (no git checkout, an experimental runner): the file stays unverified.
 */
async function newFileCheck(
  $: EngineInterface,
  root: string,
  config: GuardConfig,
  module: string,
  path: string,
  after: string,
  testPath: string,
  greenRunMs: number,
  nowMs: number,
  known: readonly string[],
): Promise<CatchOutcome | null> {
  if ((await readWhole($, path)) !== after) {
    return { kind: 'unverified', reason: 'changed outside' }
  }
  const command = await oneTestCommand($, root, config, testPath)
  if (command === null || !ISOLATED_RUNNERS.has(command.runner.kind) || (await gitDirOf($, root)) === null) {
    return null
  }
  const mutants = mutantsOf(after, { angles: flipsAngles(path, after), types: /\.[cm]?tsx?$/.test(path) })
  if (mutants.length === 0) {
    return { kind: 'unverified', reason: 'new file, with nothing in it to change' }
  }
  const { runIn, relativeTest, argv } = command
  const variants = mutants.map(mutant => mutant.text)
  const deadlineMs = (await $.clock.now()) + VERIFY_BUDGET_MS
  const outcomes = await checkInWorktree($, root, { module, path, variants, after, runIn, relativeTest, argv, greenRunMs, nowMs, known, deadlineMs })
  if (!Array.isArray(outcomes)) {
    return null
  }
  const caught = mutants.filter((_, k) => outcomes[k]?.kind === 'caught').length
  const survived = mutants.filter((_, k) => outcomes[k]?.kind === 'missed').map(mutant => mutant.change)
  const mutation = { tried: mutants.length, caught, survived }
  if (caught > 0) {
    return { kind: 'proven', mutation }
  }
  if (survived.length > 0) {
    return { kind: 'missed', mutation }
  }
  const reason = outcomes.find((outcome): outcome is Extract<CatchOutcome, { kind: 'unverified' }> => outcome.kind === 'unverified')?.reason
  return { kind: 'unverified', reason: reason === undefined ? 'new file' : `new file: ${reason}` }
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
  /** The module saw red in this cycle and its test was not edited after that red. */
  provedByRed = false,
  /** Tests in its file that were failing before the change: a check where only these fail has caught nothing. */
  known: readonly string[] = [],
  /** That red never reached an assertion: an import, a collection or a compile broke (#132). */
  redErrorsOnly = false,
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
  // #57: on Windows a checkout keeps CRLF, and Git Bash's `sed -i` writes the whole file back with LF. A restore by
  // shell is then the code from before the break with other line endings. That changes nothing the code does, so it
  // counts as restored; reverting it would "undo" only line endings and read as MISSED. The agent is told why.
  const lineEndingsOnly =
    cycleChange.before !== null && cycleChange.before !== cycleChange.after && sameIgnoringLineEndings(cycleChange.before, cycleChange.after)
  if (cycleChange.before === cycleChange.after || lineEndingsOnly) {
    // Broken on purpose, red, restored byte for byte: the red was the check, so there is nothing left to revert.
    // Never when the test was edited after the red: that green came from the test, and is TEST CHANGED.
    if (!provedByRed) {
      return 'unchecked'
    }
    // A break that only stopped the test from loading (a bad import) proves no assertion can fail; the red message said
    // so, and the restore must not then say PROVEN (#132's break-and-restore door, found 2026-10-21).
    if (redErrorsOnly) {
      return { kind: 'unverified', reason: 'the red was an error, not a failed assertion: no assertion ran' }
    }
    const eol = lineEndingsOnly ? { lineEndings: true } : {}
    // #55: one break proves one behaviour. The pinned file gets the small changes a new file gets, in the worktree,
    // where the config allows a check at all. They add what else the pins miss; the verdict stays PROVEN either way,
    // and a check that cannot run here (no checkout, an experimental runner) leaves the plain PROVEN.
    const pinPolicy = policyFor(config, relativePath(root, cycleChange.path))
    if (pinPolicy === 'observe' || pinPolicy === 'exempt' || config.catchCheck === false) {
      return { kind: 'proven', ...eol }
    }
    const pinCheck = await newFileCheck($, root, config, module, cycleChange.path, cycleChange.after, testPath, greenRunMs, nowMs, known)
    const mutation = pinCheck !== null && (pinCheck.kind === 'proven' || pinCheck.kind === 'missed') ? pinCheck.mutation : undefined
    return mutation === undefined ? { kind: 'proven', ...eol } : { kind: 'proven', mutation, pinned: true, ...eol }
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
    if (cycleChange.beforeState === 'unreadable') {
      return { kind: 'unverified', reason: 'could not read the file before the edit' }
    }
    return (await newFileCheck($, root, config, module, cycleChange.path, cycleChange.after, testPath, greenRunMs, nowMs, known)) ?? { kind: 'unverified', reason: 'new file' }
  }
  const undone = { path: cycleChange.path, before: cycleChange.before, after: cycleChange.after }
  const budgetEndMs = (await $.clock.now()) + VERIFY_BUDGET_MS
  const own = await checkAgainst($, root, config, module, undone, testPath, greenRunMs, nowMs, known)
  if (own.kind !== 'missed') {
    return own
  }
  // Its own test misses the change: a test seen importing it may catch it, which says where the test is missing (#25).
  for (const other of (s.importers[module] ?? []).filter(path => pathKey(path) !== pathKey(testPath)).slice(0, 2)) {
    if ((await $.clock.now()) >= budgetEndMs) {
      break
    }
    if (!(await $.fs.exists(other))) {
      continue
    }
    const outcome = await checkAgainst($, root, config, module, undone, other, greenRunMs, nowMs, [], true)
    if (outcome.kind === 'caught') {
      return { kind: 'caught', by: relativePath(root, other), own: relativePath(root, testPath) }
    }
  }
  return own
}

/** The catch check of one change against one test file: in the worktree for a Node runner in a git clone, else in place. */
async function checkAgainst(
  $: EngineInterface,
  root: string,
  config: GuardConfig,
  module: string,
  { path, before, after }: { path: string; before: string; after: string },
  testPath: string,
  greenRunMs: number,
  nowMs: number,
  known: readonly string[],
  /** An importer's check: its green-before check runs again, as it may have gone red since (review #3). */
  fresh = false,
): Promise<CatchOutcome> {
  if ((await readWhole($, path)) !== after) {
    return { kind: 'unverified', reason: 'changed outside' }
  }
  const command = await oneTestCommand($, root, config, testPath)
  if (command === null) {
    return catchOutcome('no-runner')
  }
  const { runner, runIn, relativeTest, argv } = command
  // The experimental runners have no throwaway copy: their check writes the old code into the user's file, so only on request.
  if (!ISOLATED_RUNNERS.has(runner.kind) && config.catchCheck !== true) {
    return { kind: 'unverified', reason: experimentalCheckReason(runner.kind) }
  }

  // In a git checkout, a Node runner checks in a worktree: the change is undone there, never in the user's files. When
  // the copy cannot be made or cannot run the test, the check says so; it once fell back to rewriting the user's real
  // file, silently, while the README promised it never would (verified review A2, 2026-10-20).
  if (ISOLATED_RUNNERS.has(runner.kind) && (await gitDirOf($, root)) !== null) {
    const checked = await checkInWorktree($, root, { module, path, variants: [before], after, runIn, relativeTest, argv, greenRunMs, nowMs, known, fresh })
    if (!Array.isArray(checked)) {
      return { kind: 'unverified', reason: worktreeFailureReason(checked) }
    }
    const isolated = checked[0]
    if (isolated === undefined) {
      return { kind: 'unverified', reason: 'the throwaway copy ran nothing, so your file was left alone' }
    }
    return isolated.kind === 'missed' ? { kind: 'missed', slipped: changedLines(before, after) } : isolated
  }

  // The lock first, then the baseline, then the journal: a check that loses the lock never touches another check's
  // journal, and the lock covers the baseline too, so the Edit gate holds the file while it runs (verified review A1).
  // The lock's time is when this check starts, not when the run that asked for it did (review #7).
  const lockedAt = await $.clock.now()
  const locked = await change($, state => acquireCheck(state, module, lockedAt))
  if (locked.checking?.module !== module || locked.checking.sinceMs !== lockedAt) {
    return { kind: 'unverified', reason: 'another check was running' }
  }
  const shared = await acquireSharedLock($, root, module, lockedAt)
  if (shared.kind === 'busy') {
    await change($, releaseCheck)
    return { kind: 'unverified', reason: `another session was checking ${shared.module}` }
  }
  const sharedSha = shared.kind === 'acquired' ? shared.sha : null
  const releaseAll = async () => {
    await change($, releaseCheck)
    if (sharedSha !== null) {
      await releaseSharedLock($, root, sharedSha)
    }
  }

  // The baseline, once per module and test in a session: the check's own command, on the code as it stands, must be
  // green. Otherwise a red with the change undone could come from the command (cwd, env, config), not from the change.
  const baselineKey = `${storeRoot(root)}|${module}|${relativeTest.toLowerCase()}|${await testFingerprint($, testPath)}`
  if (fresh || !baselined.has(baselineKey)) {
    let base: CatchOutcome
    try {
      const run = await checkRun($, argv, { cwd: runIn, env: { CI: '1', DOPE_TDD_BASELINE: '1' }, timeoutMs: timeBudgetMs(greenRunMs) })
      base = catchOutcome(run, relativeTest, known)
    } catch (error) {
      base = catchOutcome(runFailure(error))
    }
    if (base.kind !== 'missed') {
      await releaseAll()
      return { kind: 'unverified', reason: base.kind === 'unverified' ? `baseline: ${base.reason}` : "the test is red under the check's own command before anything is reverted" }
    }
    baselined.add(baselineKey)
  }

  // Compared again just before the revert: the first comparison came before a baseline of up to a minute, and a save
  // from the user's editor in that window was overwritten by the revert, then by the restore (verified review A1).
  if ((await readWhole($, path)) !== after) {
    await releaseAll()
    return { kind: 'unverified', reason: 'changed outside' }
  }
  const journalKey = journalKeyFor(root, module)
  try {
    await $.store.set(journalKey, journalEntry([{ path, before, after }], lockedAt))
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
      const run = await checkRun($, argv, {
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
    toast($, `dope-tdd: ${relativePath(root, path)} changed during the catch check and was left as is; ${where}`)
    // Never the text itself: a log outlives the session and is read by tools this plugin does not control, and the
    // text may hold secrets. When keepAside failed, the file on disk was changed by someone else and `after` is lost
    // with this session; say so by size so the loss is visible without copying the source anywhere.
    $.ui.log(`dope-tdd: ${path} changed while reverted; your change is ${kept ?? `not saved (could not write it aside; ${after.length} characters lost)`}`)
    await forget($, journalKey)
    return { kind: 'unverified', reason: 'changed during check' }
  }
  if ((await readWhole($, path)) !== after) {
    toast($, 'dope-tdd could not restore a source file after the catch check; see /tdd')
    $.ui.log(`dope-tdd: restore failed for ${path}; journal kept under ${journalKey}`)
    return { kind: 'unverified', reason: 'restore failed' }
  }
  await forget($, journalKey)
  return outcome
}

/**
 * #54: a module unlocked in an earlier session, edited before its test ran this session. The refusal names the exact
 * command, so the next step is one run, not a search.
 */
async function carryWait($: EngineInterface, root: string, config: GuardConfig, s: TddStats, module: string, nowMs: number): Promise<string> {
  const testPath = s.unlocked[module] ?? testPathFor(config, module)
  const command = (await runCommandFor($, root, config, testPath)) ?? undefined
  return carryWaitMessage(sourcePathFor(config, module), relativePath(root, testPath), nowMs - (s.inherited[module] ?? nowMs), command)
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
  layoutNotes.delete(root)
  const survey = await surveyProject($, root)
  const configPath = `${root}/${CONFIG_FILE}`
  const existing = await readWhole($, configPath)
  const current = parseConfig(existing, await detectStack($, root))
  const inferred = inferLayout(survey, current.stackSource === 'config' ? current.stack : undefined)
  // The runner under the detected config, which is what saving it gives (Karl's round 4: setup never named one).
  const testCommand = await briefingCommand($, root, { ...current, stack: inferred.stack, layout: inferred.layout, roots: inferred.roots })
  const text = formatSetup(current, inferred, survey, existing !== null, testCommand ?? undefined)
  if (!write) {
    return text
  }
  const { layout: _layout, roots: _roots, stack: _stack, ...kept } = parsedJson(existing)
  const merged = { ...kept, ...suggestedConfig(current, inferred) }
  await $.fs.write(configPath, `${JSON.stringify(merged, null, 2)}\n`)
  const after = await loadConfig($, root)
  const detail = describeConfigChange(current, after) ?? 'no change'
  await change($, s => recordConfigChange(s, `setup: ${detail}`, false, nowMs))
  toast($, `dope-tdd: ${CONFIG_FILE} written (${detail})`)
  return `${text}\nwritten: ${CONFIG_FILE} (${detail})`
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
    } else if (signal.kind === 'comments-only') {
      // Still unlocks: a comment can be an honest note of what is about to be tested. Said and on the record, but no
      // workaround (decided 2026-10-20, verified review A12).
      await change($, s => recordCommentTouch(s, module, nowMs))
      lines.push(commentsOnlyAdvice(relativePath(root, path), module))
    } else {
      await change($, s => recordWorkaround(s, 'assertion-removed', module, `${signal.before} → ${signal.after}`, nowMs))
      lines.push(assertionsRemovedAdvice(relativePath(root, path), signal.before, signal.after))
    }
  }
  return lines
}

/** The checkout's git directory: `.git` itself, or where a `.git` file points (a linked worktree, a submodule). */
async function gitDirOf($: EngineInterface, root: string): Promise<string | null> {
  if (await $.fs.exists(`${root}/.git/HEAD`)) {
    return `${root}/.git`
  }
  const pointer = await readWhole($, `${root}/.git`)
  return pointer === null ? null : gitDirFromFile(pointer, root)
}

/** The git operation in progress in this checkout, or null; a check that fails reads as none. */
async function detectGitOperation($: EngineInterface, root: string): Promise<GitOperation | null> {
  try {
    const gitDir = await gitDirOf($, root)
    return gitDir === null ? null : await findGitOperation(gitDir, path => $.fs.exists(path))
  } catch {
    return null
  }
}

/**
 * Whether the current module's work is committed, and pushed, so a green band stops saying "then commit" once it is
 * (2026-10-19). One git status of the module's two files, and only while green: the only phase whose next step uses it.
 */
async function noteSaved($: EngineInterface, root: string): Promise<void> {
  const s = await readStats($)
  const module = s.current?.module
  const testPath = module === undefined ? undefined : s.unlocked[module]
  if (module === undefined || testPath === undefined || s.phase !== 'green') {
    return
  }
  const config = await loadConfig($, root)
  // --no-optional-locks: status otherwise refreshes the index and takes .git/index.lock, which can make the user's own
  // git command fail while it runs (verified review A14).
  const status = await gitQuiet($, root, ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--', `${sourcePathFor(config, module)}.*`, relativePath(root, testPath)])
  const state = status === null || status.exitCode !== 0 ? null : savedStateOf(status.stdout)
  if (state !== null) {
    await update($, savedAtom, () => ({ module, state }))
  }
}

/**
 * The git operation in progress, and the lines that say what changed since the last tool call: the start and the end
 * are each said once, to the agent in the tool result and to the person in a toast.
 */
async function noteGitOperation($: EngineInterface, root: string): Promise<{ operation: GitOperation | null; lines: string[] }> {
  const operation = await detectGitOperation($, root)
  const before = await read($, gitOperation)
  if ((operation ?? '') === before) {
    return { operation, lines: [] }
  }
  await update($, gitOperation, () => operation ?? '')
  if (operation !== null) {
    toast($, `dope-tdd stands down during the git ${operation}`)
    $.ui.log(`dope-tdd: ${standingDownLine(operation)}`)
    return {
      operation,
      lines: [`dope-tdd: a git ${operation} is in progress, so the guard stands down: edits and runs are not guarded, counted or checked until it ends.`],
    }
  }
  $.ui.log(`dope-tdd: the git ${before} is over; the guard is back on`)
  return { operation, lines: [`dope-tdd: the git ${before} is over; the guard is back on.`] }
}

/**
 * During a git operation the call runs unguarded and uncounted and no catch check starts, so nothing is reverted
 * under a conflict. A check another session already has in flight still holds a call that touches code.
 */
async function standDown(
  $: EngineInterface,
  root: string,
  lines: string[],
  touchesCode: boolean,
  proceed: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  if (touchesCode) {
    const elsewhere = await checkInFlight($, root, await $.clock.now())
    if (elsewhere !== null) {
      return { deny: checkingMessage(moduleLabel(await loadConfig($, root), elsewhere)) }
    }
  }
  const result = await proceed()
  const config = await loadConfig($, root)
  return tell(config.mode === 'observe', result, lines)
}

/** The tools that write one named file. NotebookEdit edits a notebook cell, but the file is a file like any other (#195). */
type FileTool = 'Edit' | 'Write' | 'NotebookEdit'

async function guardFileWrite(
  $: EngineInterface,
  tool: FileTool,
  filePath: string,
  proceed: () => Promise<ToolCallResult>,
  agentId?: string,
): Promise<ToolCallResult> {
  // A file in an agent worktree is judged against that worktree, the checkout it belongs to (#198).
  const root = worktreeRootFor(await $.session.root(), filePath)
  const git = await noteGitOperation($, root)
  if (git.operation !== null) {
    return standDown($, root, git.lines, isCodeFile(relativePath(root, filePath)), proceed)
  }
  const result = await checkFileWrite($, tool, filePath, proceed, agentId)
  await noteSaved($, root)
  return tell((await configForRender($, root)).mode === 'observe', result, git.lines)
}

async function checkFileWrite(
  $: EngineInterface,
  tool: FileTool,
  writtenPath: string,
  proceed: () => Promise<ToolCallResult>,
  agentId?: string,
): Promise<ToolCallResult> {
  const sessionRoot = await $.session.root()
  const root = worktreeRootFor(sessionRoot, writtenPath)
  const filePath = await projectPath($, root, writtenPath)
  await ensureRepaired($, root, await $.clock.now())
  const config = await loadConfig($, root)
  const target = classifyPath(root, filePath, config)
  const relative = relativePath(root, filePath)
  const isConfig = relative === CONFIG_FILE
  if (relative !== OVERRIDES_FILE) {
    await endExpiredPauses($, root, await $.clock.now())
  }
  const current = await readStats($)
  const quiet = config.mode === 'observe'
  const policy = target.kind === 'source' ? policyFor(config, relative) : null
  // #198: unlocks are kept by module name, so one counts only if its test is in this file's checkout; a test touched
  // in an agent worktree must not unlock the main checkout's module, nor the other way round.
  const unlockedBy = target.kind === 'source' ? current.unlocked[target.module] : undefined
  const isLocked = target.kind === 'source' && (unlockedBy === undefined || !sameCheckout(sessionRoot, filePath, unlockedBy))
  const gateNowMs = await $.clock.now()
  const record = await read($, overrideRecord)
  const covering = target.kind === 'source' && isLocked ? coveringOverride(record, target.module, gateNowMs, await sessionIdNow($)) : null
  // The verdict is fileGate.ts's; this acts on it.
  const verdict = gateWrite({
    relativePath: relative,
    isConfig,
    kind: target.kind,
    policy,
    unlocked: !isLocked,
    inherited: target.kind === 'source' && current.inherited[target.module] !== undefined,
    paused: current.paused,
    covering,
    unwatchedCode: target.kind === 'other' && isInsideRoot(root, filePath) && countsAsUnwatched(relative, config),
  })
  if (verdict.kind === 'deny-record') {
    return { deny: RECORD_DENY }
  }
  if (verdict.kind === 'exempt') {
    return proceed()
  }
  if (verdict.kind === 'blocked' && target.kind === 'source') {
    // Refusals are kept per agent, so each agent is offered the override on its own first one (#212).
    await change($, s => recordBlocked(s, target.module, gateNowMs, agentId))
    return { deny: lockedFor(config, current, target.module, gateNowMs, filePath, await lockedFacts($, root, config, current, target.module, filePath, gateNowMs), agentId) }
  }
  if (verdict.kind === 'carry-wait' && target.kind === 'source') {
    await change($, s => recordCarryWait(s, target.module, gateNowMs))
    return { deny: await carryWait($, root, config, current, target.module, gateNowMs) }
  }
  if (verdict.kind === 'go' && verdict.unwatched) {
    // Code no layout pairs with a test: let it through, but remember it, so the band says what it is not watching.
    await change($, s => recordUnwatchedEdit(s, relative))
  }
  if (verdict.kind === 'go' && verdict.spend !== null) {
    // An approved override lets the edit through, on the record: a change override is spent by it, a pause counts it.
    await writeOverrides($, root, recordEdit(record, verdict.spend, relative))
  }

  const before = target.kind !== 'other' && !current.paused ? await readFile($, filePath) : undefined
  if (target.kind !== 'other') {
    // Read again right before the write: a check that started since must not have this file reverted under the edit.
    const latest = await readStats($)
    const nowMs = await $.clock.now()
    if (isChecking(latest, nowMs)) {
      return { deny: checkingMessage(moduleLabel(config, latest.checking?.module ?? target.module)) }
    }
    const elsewhere = await checkInFlight($, root, nowMs)
    if (elsewhere !== null) {
      return { deny: checkingMessage(moduleLabel(config, elsewhere)) }
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
    toast($, `dope-tdd: ${CONFIG_FILE} changed: ${detail}`)
    return withContext(result, [configChangedAdvice(detail)])
  }
  if (target.kind === 'source') {
    const inheritedAt = current.reminded.includes(target.module) ? undefined : current.inherited[target.module]
    const after = before === undefined ? null : await readWhole($, filePath)
    const captured = captureEdit(before, after)
    const edited = await change($, s => recordFileEdit(s, target.module, filePath, !isLocked, captured, nowMs))
    if (edited.paused) {
      return result
    }
    const commented = before === undefined || after === null ? [] : await noteCommentedOut($, root, target.module, filePath, beforeText(before), after, nowMs)
    const sourcePath = sourcePathFor(config, target.module)
    if (isLocked) {
      const warned = policy === 'warn' ? [unguardedAdvice(moduleLabel(config, target.module), sourcePath, testPathFor(config, target.module, extOf(filePath)))] : []
      return tell(quiet, result, [...warned, ...commented])
    }
    const testPath = edited.unlocked[target.module]
    const inherited =
      inheritedAt === undefined || testPath === undefined
        ? []
        : [inheritedAdvice(moduleLabel(config, target.module), relativePath(root, testPath), nowMs - inheritedAt, sourcePath)]
    return tell(quiet, result, [...inherited, ...commented])
  }
  if (target.kind === 'test') {
    const source = await readWhole($, filePath)
    // A test named after no module (tests/band.test.tsx tests the drawing) unlocks, but does not take over the band.
    const makeCurrent = testsItsOwnModule(
      target.module,
      importTargets(root, config, filePath, source),
      await hasOwnSource($, root, config, target.module),
      await importsTestHelpers($, root, config, filePath, source),
    )
    const touched = await change($, s => recordTestTouch(s, { module: target.module, testPath: filePath }, nowMs, makeCurrent))
    await rememberUnlock($, root, target.module, filePath, nowMs)
    const hollow = source !== null && !hasAssertion(source) ? [hollowAdvice(relativePath(root, filePath))] : []
    const signals = before === undefined ? [] : await noteTestEdit($, root, target.module, filePath, beforeText(before), source, nowMs)
    // A Write of the same bytes: the touch counts, and so does the fact that it changed nothing. An Edit always changes something.
    const unchanged = tool === 'Write' && before !== undefined && source !== null && beforeText(before) === source
    if (unchanged) {
      await change($, s => recordWorkaround(s, 'hollow-touch', target.module, relativePath(root, filePath), nowMs))
    }
    const resaved = unchanged ? [hollowTouchAdvice(relativePath(root, filePath))] : []
    // A test covers what it imports: slugify.test.ts importing src/lib/io is the test for io too.
    const importing = (await importedModules($, root, config, filePath, source)).filter(module => module !== target.module)
    if (importing.length > 0) {
      await change($, s => importing.reduce((acc, module) => recordImporter(acc, module, filePath), s))
    }
    // Not a module with a test of its own: its own test comes first, and this one is tried after it (#25).
    const imported: string[] = []
    for (const module of importing) {
      if (touched.unlocked[module] === undefined && !(await hasOwnTest($, root, config, module))) {
        imported.push(module)
      }
    }
    if (imported.length > 0) {
      await change($, s => imported.reduce((acc, module) => recordImportUnlock(acc, module, filePath), s))
      for (const module of imported) {
        await rememberUnlock($, root, module, filePath, nowMs)
      }
    }
    const importLines = imported.length === 0 ? [] : [importAdvice(relativePath(root, filePath), imported.map(module => moduleLabel(config, module)))]
    const command = (await runCommandFor($, root, config, filePath)) ?? undefined
    return touched.paused ? result : tell(quiet, result, [touchAdvice(moduleLabel(config, target.module), sourcePathFor(config, target.module), command), ...importLines, ...hollow, ...signals, ...resaved])
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

/** Records a runner whose summary cannot be read yet; true the first time this session runs it. */
async function noteUnreadRunner($: EngineInterface, runner: string): Promise<boolean> {
  if ((await read($, unreadRunners)).includes(runner)) {
    return false
  }
  await update($, unreadRunners, known => [...known, runner])
  return true
}

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

async function guardShell(
  $: EngineInterface,
  command: string,
  proceed: () => Promise<ToolCallResult>,
  shell: ShellName,
  agentId?: string,
): Promise<ToolCallResult> {
  // A subagent's shell runs in its worktree once its paths placed it there: its writes, its git check and its
  // catch check are that checkout's, not the session's (#198).
  const root = await agentRoot($, agentId)
  const git = await noteGitOperation($, root)
  if (git.operation === null) {
    const result = await checkShell($, command, proceed, shell, root, agentId)
    await noteSaved($, root)
    return tell((await configForRender($, root)).mode === 'observe', result, git.lines)
  }
  // The shell still moves while the guard stands down, so the next command starts where this one left it.
  const carried = await readCwd($, shell, agentId)
  const start = carried !== '' && isInsideRoot(root, carried) ? carried : root
  const touchesCode = isTestRun(command) || findSourceWrites(command, start).length > 0
  const result = await standDown($, root, git.lines, touchesCode, proceed)
  if (result.deny === undefined) {
    const moved = cwdAfter(command, start)
    await writeCwd($, shell, moved !== ELSEWHERE && isInsideRoot(root, moved) ? moved : root, agentId)
  }
  return result
}

async function checkShell(
  $: EngineInterface,
  command: string,
  proceed: () => Promise<ToolCallResult>,
  shell: ShellName,
  root: string,
  agentId: string | undefined,
): Promise<ToolCallResult> {
  await ensureRepaired($, root, await $.clock.now())
  const current = await readStats($)
  const config = await loadConfig($, root)
  const quiet = config.mode === 'observe'
  // The command starts where the last one left the shell, when that is still inside the project.
  const carried = await readCwd($, shell, agentId)
  const start = carried !== '' && isInsideRoot(root, carried) ? carried : root

  // Paths come back resolved against the directory their segment runs in; one in another repository classifies as other.
  const writes = await Promise.all(
    findSourceWrites(command, start).map(async written => {
      const path = await projectPath($, root, absolutePath(root, written))
      // A write into an agent worktree is judged against that worktree, as Edit and Write are (#198).
      const home = worktreeRootFor(root, path)
      return { path, module: sourceModuleOf(home, path, config), policy: policyFor(config, relativePath(home, path)) }
    }),
  )
  const gated = gateShellWrites(writes, current.unlocked, current.inherited, await $.session.root())
  const writesRecord = writesFileNamed(command, OVERRIDES_FILE)
  const covered = writesRecord || gated.locked.length === 0 || current.paused ? gated.locked : await coverShellWrites($, root, gated.locked, writes)
  // The verdict is shellVerdict.ts's; this words the refusal and records it.
  const gate = shellGate({ writesRecord, locked: covered, waiting: gated.waiting, paused: current.paused })
  if (gate.kind === 'deny-record') {
    return { deny: RECORD_DENY }
  }
  if (gate.kind === 'refuse') {
    const { locked, waiting } = gate
    const nowMs = await $.clock.now()
    await change($, s => waiting.reduce((acc, module) => recordCarryWait(acc, module, nowMs), locked.reduce((acc, module) => recordBlocked(acc, module, nowMs, agentId), s)))
    const waits = await Promise.all(waiting.map(module => carryWait($, root, config, current, module, nowMs)))
    const writtenPath = (module: string) => writes.find(write => write.module === module)?.path
    const refusals = await Promise.all(
      locked.map(async module => lockedFor(config, current, module, nowMs, writtenPath(module), await lockedFacts($, root, config, current, module, writtenPath(module), nowMs), agentId)),
    )
    return { deny: [...refusals, ...waits].join('\n') }
  }
  // While a file is reverted on disk, neither a write to source nor a test run may read it.
  if (writes.some(({ module }) => module !== null) || isTestRun(command)) {
    const nowMs = await $.clock.now()
    if (isChecking(current, nowMs)) {
      return { deny: checkingMessage(current.checking === null ? 'this module' : moduleLabel(config, current.checking.module)) }
    }
    const elsewhere = await checkInFlight($, root, nowMs)
    if (elsewhere !== null) {
      return { deny: checkingMessage(moduleLabel(config, elsewhere)) }
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
  await writeCwd($, shell, moved !== ELSEWHERE && isInsideRoot(root, moved) ? moved : root, agentId)
  const after = before === null ? null : await snapshotWatched($, root, config)
  const nowMs = await $.clock.now()

  // A git rewrite with nothing beside it that could write leaves changes that are not the agent's; one beside a script
  // does not hide what the script wrote (verified review A7). Reads beside it write nothing either (Karl's round 4,
  // 2026-10-20: `git checkout main -- api.py; sha256sum api.py` was charged to the agent as a guarded edit).
  const revertOnly = isRevertOnly(command, segment => isPureTestRun(segment) || isPureRead(segment))
  const seen = before === null || after === null || revertOnly ? [] : changedPaths(before, after, await mtimesOfGone($, root, before, after))
  // Code git wrote from another branch, commit or stash is not the agent's edit, but it is said, never silent (2026-10-19).
  if (before !== null && after !== null && revertOnly && bringsInCode(command)) {
    const brought = changedOfKind(root, changedPaths(before, after, await mtimesOfGone($, root, before, after)), 'source', config).filter(({ path }) => policyFor(config, path) !== 'exempt')
    if (brought.length > 0) {
      // The verb only: the arguments can hold a token in a remote URL (verified review B1).
      const detail = gitVerb(command)
      await change($, s => recordGitIn(s, [...new Set(brought.map(({ module }) => module))], detail, nowMs))
      $.ui.log(`dope-tdd: ${detail} brought in code from elsewhere, not guarded: ${brought.map(({ path }) => path).join(', ')}`)
    }
  }
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
  const leading = await Promise.all(
    touchedTests.map(async ({ path, module }) =>
      testsItsOwnModule(
        module,
        importTargets(root, config, `${root}/${path}`, await readWhole($, `${root}/${path}`)),
        await hasOwnSource($, root, config, module),
        await importsTestHelpers($, root, config, `${root}/${path}`, await readWhole($, `${root}/${path}`)),
      ),
    ),
  )
  const tests = touchedTests.map(({ path, module }, index) => ({ path, module, leads: leading[index] ?? true }))
  const updated = await change($, s => recordShellChanges(s, { root, touchedTests: tests, changedSources, captured }, nowMs))
  for (const { path, module } of touchedTests) {
    await rememberUnlock($, root, module, `${root}/${path}`, nowMs)
  }
  const commented: string[] = []
  for (const write of captured) {
    if (write.after !== null) {
      commented.push(...(await noteCommentedOut($, root, write.module, write.path, beforeText(write.before), write.after, nowMs)))
    }
  }
  const unguardedPaths = unguardedShellPaths(changedSources, updated.unlocked, path => policyFor(config, path))

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
  // A runner dope-tdd recognises but cannot read yet ran no unread run: it is named once and its runs are not counted.
  const unreadable = read === 'unknown' && notStarted === null ? unreadableRunner(output) : null
  const firstUnreadable = unreadable !== null && (await noteUnreadRunner($, unreadable))
  let outcome = notStarted === null && unreadable === null ? read : 'none'
  // Tests that were failing before the change neither hide a red nor block a green: judge a run of the current
  // module's own test file by which tests fail. Only the known failures, or fewer than the red with none new, is green.
  let alreadyFailing: string[] = []
  // The run counts for the module whose test file it names, whichever was touched last. A run filtered to some tests
  // by name says nothing about the rest, so it is never judged this way.
  const ownFile = outcome === 'fail' && !filtersTests(command) ? namedTestFile(command, config.stack, start) : null
  const ownTarget = ownFile === null ? null : classifyPath(root, ownFile, config)
  const working = ownFile !== null && ownTarget?.kind === 'test' ? { module: ownTarget.module, testPath: ownFile } : null
  if (working !== null) {
    let names = failedTestsIn(output)
    // A tail kept the summary and lost the names: run the file once, locally, to read them all.
    const count = failedCountIn(output)
    if (count !== null && names.length < count) {
      const all = await allFailingNames($, root, config, working.testPath)
      if (all.length > names.length) {
        names = all
      }
    }
    const judged = judgeFailures(names, moduleState(updated, working.module))
    outcome = judged.outcome
    alreadyFailing = judged.alreadyFailing
    if (judged.record === 'known') {
      await change($, s => recordKnownFailures(s, working.module, names))
    } else if (judged.record === 'red') {
      await change($, s => recordRedNames(s, working.module, names))
    }
  }
  let afterRun = updated
  // Whether this run closed the current module's own cycle, before it closes other modules' (#41).
  let ownCycleClosed = false
  // A green of another module's test is not this module's run: it neither closes its cycle nor starts its check.
  let countsForCurrent = true
  let ownTestOf: string | null = null
  let elsewhere: string[] = []
  let redUnlocked: string[] = []
  let carriedOn: string[] = []
  if (outcome === 'unknown') {
    afterRun = await change($, s => recordUnreadRun(s, nowMs))
  } else if (outcome !== 'none') {
    // What the plan needs from disk, gathered first: the imports of the named test and of each failing one, and
    // whether each module those import has a test of its own (asked only for one not unlocked, as before #59).
    const named = namedTestFile(command, config.stack, start) ?? undefined
    // Files outside the layout the command names (`node --test tools/x.spec-node.ts`): the run is about them (runPlan.ts).
    const namedOther = named === undefined ? namedOtherFiles(command, config.stack, start) : []
    const namedImports =
      named !== undefined
        ? await importedModules($, root, config, named)
        : [...new Set((await Promise.all(namedOther.map(file => importedModules($, root, config, file)))).flat())]
    const failed = outcome === 'fail' ? failedTestPaths(root, runLocation, failedFilesIn(output)) : []
    const errorsOnly = outcome === 'fail' && failedOnlyOnErrors(output)
    const importsOf: Record<string, string[]> = {}
    const ownTest: Record<string, boolean> = {}
    for (const testFile of outcome === 'fail' ? failingTestFiles(root, config, failed, named) : []) {
      importsOf[testFile] = await importedModules($, root, config, testFile)
      for (const module of importsOf[testFile]) {
        if (updated.unlocked[module] === undefined && ownTest[module] === undefined) {
          ownTest[module] = await hasOwnTest($, root, config, module)
        }
      }
    }
    const facts = { outcome, named, filtered: filtersTests(command), namedImports, failed, importsOf, ownTest, wholeFolder: runsWholeFolder(command), namedOther, errorsOnly, namesFailedFiles: outcome === 'fail' && namesFailedFiles(output) }
    let plan = null as RunPlan | null
    afterRun = await change($, s => {
      plan = applyRun(s, facts, root, config, nowMs)
      return plan.state
    })
    if (plan !== null) {
      for (const { module, testPath } of plan.remember) {
        await rememberUnlock($, root, module, testPath, nowMs)
      }
      ;({ redUnlocked, carriedOn, elsewhere, ownCycleClosed, countsForCurrent, ownTestOf } = plan)
    }
    // Idea 17: a run of one named test file is the loop; how long it took goes on the band and into the record.
    if (named !== undefined) {
      afterRun = await change($, s => recordRunTime(s, nowMs, nowMs - startedMs))
    }
    // Idea 16: the same failure on the current module, run after run, is motion without progress.
    const stuckOn = afterRun.current?.module
    if (stuckOn !== undefined && countsForCurrent && elsewhere.length === 0) {
      const failure = outcome === 'fail' ? (failureMessage(output) ?? (failedTestsIn(output).join(', ') || null)) : null
      afterRun = await change($, s => recordSameRed(s, stuckOn, outcome === 'pass' ? 'pass' : 'fail', failure, nowMs))
    }
  }
  const passedModule = outcome === 'pass' && countsForCurrent && !afterRun.paused ? afterRun.current?.module : undefined
  // The module's own record before this run: its red, its test edits, its uncaptured edits. Never another module's.
  const before_ = passedModule === undefined ? null : moduleState(updated, passedModule)
  const checkStartMs = await $.clock.now()
  const check =
    passedModule === undefined ? 'unchecked' : await verifyCatch($, root, config, afterRun, passedModule, before_?.editedSinceRun === true, nowMs - startedMs, nowMs, before_?.sawRed === true && !before_.testTouchedAfterRed, alreadyFailing, before_?.redErrorsOnly === true)
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
        ? unreadRunAdvice(isTruncated(output), isNodeTestRun(command) ? 'node-test' : undefined, nodeRunnerCrashed(output))
        : runAdvice(updated, afterRun, check === 'unchecked' ? undefined : check, { elsewhere, testChanged, sourcePath, label: runModule === undefined ? undefined : moduleLabel(config, runModule), cycleCompleted: ownCycleClosed, errorsOnly: outcome === 'fail' && failedOnlyOnErrors(output), ...(afterRun.sameRed !== null && afterRun.sameRed.module === runModule ? { stuck: afterRun.sameRed } : {}), ...(ownTestOf === null ? {} : { ownTestOf: moduleLabel(config, ownTestOf) }) })

  const reminders = shellReminders(
    {
      paused: current.paused,
      unguardedPaths,
      alreadyFailing,
      alreadyFailingModule: working === null ? null : working.module,
      notStarted,
      unreadableRunner: firstUnreadable ? unreadable : null,
      bystanders,
      commented,
      redUnlocked,
      carriedOn: carriedOn.map(module => ({ module, testPath: afterRun.unlocked[module] ?? '' })),
      passed: outcome === 'pass',
      advice,
    },
    config,
    root,
  )
  return tell(quiet, result, reminders)
}

/** The modified time now of each path that left the snapshot, null for one that is gone; quiet, since gone is expected. */
async function mtimesOfGone($: EngineInterface, root: string, before: SourceSnapshot, after: SourceSnapshot): Promise<Record<string, number | null>> {
  const gone = Object.keys(before).filter(path => after[path] === undefined)
  const entries = await Promise.all(
    gone.map(async path => {
      try {
        return [path, (await $.fs.stat(`${root}/${path}`)).mtimeMs] as const
      } catch {
        return [path, null] as const
      }
    }),
  )
  return Object.fromEntries(entries)
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
  // Each remembered unlock is kept (pending a run, #54), dropped as stale (its test changed since), or forgotten (its test is gone).
  const sorted = await Promise.all(
    Object.entries(stored).map(async ([module, entry]) => {
      if ((await lastModifiedMs($, entry.testPath)) === null) {
        return { module, entry, fate: 'gone' as const }
      }
      if (entry.testHash === undefined) {
        // Stored by an earlier build, before hashes: nothing to compare, so kept. It still waits for a run before any edit.
        return { module, entry, fate: 'kept' as const }
      }
      const text = await readWhole($, entry.testPath)
      // Unreadable now: cannot tell, so kept, for the same reason.
      return { module, entry, fate: text !== null && contentHash(text) !== entry.testHash ? ('stale' as const) : ('kept' as const) }
    }),
  )
  const kept = Object.fromEntries(sorted.filter(item => item.fate === 'kept').map(item => [item.module, item.entry]))
  const stale = Object.fromEntries(sorted.filter(item => item.fate === 'stale').map(item => [item.module, item.entry]))
  if (Object.keys(kept).length > 0 || Object.keys(stale).length > 0) {
    await change($, s => recordStaleUnlocks(seedUnlocks(s, kept), stale, nowMs))
  }
}

/**
 * At a session start: removes session logs written more than 30 days ago, and names the changes kept aside, which are
 * never removed (retention.ts says why). $.fs cannot delete, so node does; a machine without node keeps the files,
 * which is the safe failure. Never fails the start.
 */
async function pruneOldFiles($: EngineInterface, nowMs: number): Promise<void> {
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    if (home === undefined || home === '') {
      return
    }
    const base = `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd`
    const filesUnder = async (dir: string, depth = 0): Promise<{ path: string; mtimeMs: number }[]> => {
      let entries: Awaited<ReturnType<typeof $.fs.list>> = []
      try {
        entries = await $.fs.list(dir)
      } catch {
        return []
      }
      const found: { path: string; mtimeMs: number }[] = []
      for (const entry of entries) {
        if (entry.kind === 'dir' && !entry.isLink && depth < 8) {
          found.push(...(await filesUnder(`${dir}/${entry.name}`, depth + 1)))
        } else if (entry.kind === 'file') {
          found.push({ path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
        }
      }
      return found
    }
    for (const folder of PRUNED_FOLDERS) {
      for (const file of await filesUnder(`${base}/${folder}`)) {
        if (isExpired(file.mtimeMs, nowMs)) {
          await $.process.run(pruneArgv(file.path), { timeoutMs: 10_000 }).catch(() => undefined)
        }
      }
    }
    // Idea 19: a spike copy is a throwaway the skill removes; one left behind goes after SPIKE_TTL_MS. Its git
    // worktree entry is left for git, which prunes entries whose folder is gone.
    let spikes: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      spikes = await $.fs.list(`${base}/spikes`)
    } catch {
      // No spikes folder yet.
    }
    for (const name of staleSpikes(spikes, nowMs)) {
      await $.process.run(removeFolderArgv(`${base}/spikes/${name}`), { timeoutMs: 30_000 }).catch(() => undefined)
    }
    const kept = await filesUnder(`${base}/kept`)
    const notice = keptNotice(kept.map(file => file.path.slice(`${base}/kept/`.length)))
    if (notice !== null) {
      toast($, notice)
      $.ui.log(notice)
    }
  } catch (error) {
    $.ui.log(`dope-tdd: could not prune old files: ${String(error)}`)
  }
}

/** What a session starts from: an interrupted check repaired, the unlocks remembered in the store, the config read. */
/** The store's layout version, so a later release can migrate what it finds instead of guessing (verified review E2). */
const STORE_VERSION = 1

/**
 * At session start: unlock keys that hold nothing fresh are deleted, a folder long gone or an old spelling of a root
 * (verified review B4, 2026-10-20), and the store says its layout version. Best effort: never fails a session start.
 */
async function tidyStore($: EngineInterface, nowMs: number): Promise<void> {
  try {
    const keys = (await $.store.keys()).filter(key => key.startsWith('unlocks:'))
    const entries = Object.fromEntries(await Promise.all(keys.map(async key => [key, await $.store.get(key)] as const)))
    for (const key of staleUnlockKeys(entries, nowMs)) {
      await $.store.delete(key)
    }
    if ((await $.store.get('store-version')) !== STORE_VERSION) {
      await $.store.set('store-version', STORE_VERSION)
    }
  } catch (error) {
    $.ui.log(`dope-tdd: could not tidy the plugin store: ${String(error)}`)
  }
}

async function seedFromStore($: EngineInterface): Promise<void> {
  const root = await $.session.root()
  const nowMs = await $.clock.now()
  await ensureRepaired($, root, nowMs)
  await reportJournalsElsewhere($, root, nowMs)
  await pruneOldFiles($, nowMs)
  await tidyStore($, nowMs)
  await seedRememberedUnlocks($)
  await releaseStaleCurrent($, root, await loadConfig($, root))
}

/**
 * A module on the band whose test now fails testsItsOwnModule (imports.ts) is let go. $.state outlives a reload, so a
 * test named after no module that took the band before that rule existed would otherwise stay there after an upgrade.
 */
async function releaseStaleCurrent($: EngineInterface, root: string, config: GuardConfig): Promise<void> {
  const current = (await readStats($)).current
  if (current === null) {
    return
  }
  const text = await readWhole($, current.testPath)
  if (
    !testsItsOwnModule(
      current.module,
      importTargets(root, config, current.testPath, text),
      await hasOwnSource($, root, config, current.module),
      await importsTestHelpers($, root, config, current.testPath, text),
    )
  ) {
    await change($, releaseCurrent)
  }
}

// -t / --testNamePattern / -k / --filter / --grep: a run of some tests by name, not the whole suite.
/** The module's own test file exists, in any of the stack's extensions: a test that imports the module does not stand in for it. */
async function hasOwnTest($: EngineInterface, root: string, config: GuardConfig, module: string): Promise<boolean> {
  for (const ext of stackOf(config.stack).exts) {
    if (await $.fs.exists(`${root}/${testFileFor(config, module, ext)}`)) {
      return true
    }
  }
  return false
}

/** The source modules a test file imports, each with the file that resolved: a test covers what it imports. */
/** The modules a test's imports name, whether or not their source exists yet: a new module's test names its own. */
function importTargets(root: string, config: GuardConfig, testPath: string, text: string | null): string[] {
  if (text === null) {
    return []
  }
  const found = importCandidates(relativePath(root, testPath), text, config.stack)
    .slice(0, 80)
    .map(candidate => classifyPath(root, `${root}/${candidate}`, config))
    .flatMap(target => (target.kind === 'source' ? [target.module] : []))
  return [...new Set(found)]
}

/** The test imports a project file that is not source, such as a test helper (tests/engine.tsx). */
async function importsTestHelpers($: EngineInterface, root: string, config: GuardConfig, testPath: string, text: string | null): Promise<boolean> {
  if (text === null) {
    return false
  }
  for (const candidate of importCandidates(relativePath(root, testPath), text, config.stack).slice(0, 80)) {
    if (classifyPath(root, `${root}/${candidate}`, config).kind !== 'source' && (await $.fs.exists(`${root}/${candidate}`))) {
      return true
    }
  }
  return false
}

/** The module's own source file exists, in any of the stack's extensions. */
async function hasOwnSource($: EngineInterface, root: string, config: GuardConfig, module: string): Promise<boolean> {
  for (const ext of stackOf(config.stack).exts) {
    if (await $.fs.exists(`${root}/${sourcePathFor(config, module)}.${ext}`)) {
      return true
    }
  }
  return false
}

async function importedModules($: EngineInterface, root: string, config: GuardConfig, testPath: string, text?: string | null): Promise<string[]> {
  const source = text ?? (await readWhole($, testPath))
  if (source === null) {
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
  return runner === null ? null : runnerNamed(runner.kind).describe(relativePath(root, testPath), runner.launcher)
}

/** What a refusal quotes besides the paths: the command that runs the module's test, and the band's last-run line. */
async function lockedFacts($: EngineInterface, root: string, config: GuardConfig, s: TddStats, module: string, writtenPath: string | undefined, nowMs: number): Promise<LockedFacts> {
  const testPath = `${root}/${testPathFor(config, module, writtenPath === undefined ? undefined : extOf(writtenPath))}`
  const command = await runCommandFor($, root, config, testPath)
  return { ...(command === null ? {} : { command }), testExists: await $.fs.exists(testPath), lastRun: lastRunLine(s, nowMs) }
}

/** The test file the briefing reads its runner from, by root and stack: one git call a session, not one a prompt. */
const briefingSamples = new Map<string, string | null>()

/**
 * One of the project's own test files, or null. Karl's round 4 (2026-10-20): a made-up `example.py` could not say
 * `import pytest`, so a project that says pytest only in its tests was briefed `python -m unittest`.
 */
async function sampleTestFile($: EngineInterface, root: string, config: GuardConfig): Promise<string | null> {
  const key = `${root}\n${config.stack}`
  if (briefingSamples.has(key)) {
    return briefingSamples.get(key) ?? null
  }
  const listed = await runGit($, root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...watchedDirs(config)])
  const paths = (listed ?? '').split(/\r?\n/).filter(path => path !== '')
  const sample = changedOfKind(root, paths, 'test', config)[0]?.path ?? null
  briefingSamples.set(key, sample)
  return sample
}

/** The command with a placeholder, for the briefing: a real test file picks the runner, else the layout's own extension. */
async function briefingCommand($: EngineInterface, root: string, config: GuardConfig): Promise<string | null> {
  const ext = config.layout.displayExt ?? stackOf(config.stack).exts[0] ?? 'ts'
  const sample = await sampleTestFile($, root, config)
  const runner = await detectRunner($, root, config, `${root}/${sample ?? `example.${ext}`}`)
  return runner === null ? null : runnerNamed(runner.kind).describe('<test file>', runner.launcher)
}

/**
 * The receipt for a module, ready for a pull request: the status as the band
 * reads it, then the two commands a reviewer runs to re-check the proof
 * without the plugin: the test, and the test against the code as it was
 * before the change.
 */
async function receiptText($: EngineInterface, root: string, config: GuardConfig, named: string | undefined, nowMs: number): Promise<string> {
  const s = await readStats($)
  // A module may be named as its label (`dashboard/src/lib/pkce`) as well as its id.
  const known = [...new Set([...Object.keys(s.unlocked), ...Object.keys(s.modules)])]
  const module = named === undefined ? s.current?.module : (known.find(id => id === named || moduleLabel(config, id) === named) ?? named)
  // The build first: a reviewer reads which version of the rules applied (2026-10-18).
  const status = formatStatus(s, nowMs, config, (await read($, buildAtom)) || undefined)
  // Overrides go on every receipt: who approved what, and what is still debt, read by someone who was not there.
  const overrideLines = formatOverrides(await readOverrides($, root), s.cycles)
  const overrides = overrideLines.length === 0 ? [] : ['```', ...overrideLines, '```']
  if (module === undefined) {
    return ['dope-tdd receipt', '```', status, '```', ...overrides, 'No module is current; name one: /tdd receipt <module>.'].join('\n')
  }
  const label = moduleLabel(config, module)
  const lines = [`dope-tdd receipt for ${label}`, '```', status, '```', ...overrides]
  const testPath = s.unlocked[module]
  if (testPath === undefined) {
    lines.push(`No test on record for ${label}; the receipt is the status alone.`)
    return lines.join('\n')
  }
  const runner = await detectRunner($, root, config, testPath)
  const relativeTest = relativePath(root, testPath)
  const run = runner === null ? `<run ${relativeTest} with your test runner>` : runnerNamed(runner.kind).describe(relativeTest, runner.launcher)
  // The change record is cleared once checked; the last catch keeps the path it reverted.
  const changePath = s.changes[module]?.path ?? (s.lastCatch?.module === module ? s.lastCatch.path : undefined)
  // Not named `change`: the plugin directory reads a name as one thing across the file, and `change` is the
  // top-level helper that $ is passed to; a local of the same name made those calls unreadable to it.
  const recorded = changePath === undefined ? undefined : { path: changePath }
  // Never the stash: on a committed change it saves nothing, and its pop would apply the reviewer's own stash.
  const head = await gitQuiet($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const base = head !== null && head.exitCode === 0 && head.stdout.trim() !== '' ? head.stdout.trim() : 'main'
  lines.push('To check the proof yourself, from the repo root with this change checked out:', '```', run)
  if (recorded !== undefined) {
    const path = relativePath(root, recorded.path)
    lines.push(`git checkout ${base} -- ${path}`, run, `git checkout HEAD -- ${path}`)
  }
  lines.push('```')
  // Idea 18: the words the test failed with when the catch check undid the change, when it kept them.
  const caught = s.lastCatch?.module === module && s.lastCatch.outcome.kind === 'caught' ? s.lastCatch.outcome.message : undefined
  const fails = caught === undefined ? 'fails' : `fails with \`${caught}\``
  lines.push(
    recorded === undefined
      ? `No change to ${label} is on record this session, so there is nothing to put back; the first run is the whole receipt.`
      : `The first run passes. The second runs the same test against the code on ${base}, before the change, and ${fails}, which is what the catch check saw. The last line puts the change back.`,
  )
  return lines.join('\n')
}

/**
 * The backstop for writes no command parser can see (a script, an interpreter): a non-git command that changed the
 * record has it put back, and it is a workaround on the record. One that created it from nothing leaves it empty, so a
 * forged record approves nothing.
 */
async function keepRecord($: EngineInterface, command: string, run: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  // Git may change the record (a pull, a checkout or a merge brings in other people's overrides), but only a command
  // made of git alone: a git segment beside a script proves nothing about what the script wrote (verified review A6).
  if (isGitOnly(command)) {
    return run()
  }
  const root = await $.session.root()
  const path = `${root}/${OVERRIDES_FILE}`
  const before = await readWhole($, path)
  const result = await run()
  const after = await readWhole($, path)
  if (after === before) {
    return result
  }
  const restored = before ?? serializeRecord([])
  await $.fs.write(path, restored)
  await update($, overrideRecord, () => parseRecord(restored))
  const nowMs = await $.clock.now()
  await change($, s => recordWorkaround(s, 'record-edited', '', OVERRIDES_FILE, nowMs))
  const line = `dope-tdd: that command changed ${OVERRIDES_FILE}; only dope-tdd writes it, so dope-tdd put ${OVERRIDES_FILE} back. Recorded as a workaround; say why.`
  $.ui.log(line)
  return tell(false, result, [line])
}

/** The session records in `<home>/.dope-tdd/sessions/`, or none when there is no home or no folder yet. */
async function sessionRecords($: EngineInterface, home: string | undefined): Promise<RecordEntry[]> {
  if (home === undefined || home === '') {
    return []
  }
  try {
    const entries = await $.fs.list(`${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/sessions`)
    return entries.filter(entry => entry.kind === 'file').map(({ name, size, mtimeMs }) => ({ name, size, mtimeMs }))
  } catch {
    return []
  }
}

/**
 * Integrity (2026-10-26: could an agent or a person game this?). Only dope-tdd writes the session records, at a
 * session's end, so an existing record that changed while a shell command ran was edited by it: a workaround on the
 * record, said to the agent. It is not put back (its old text was never read); the record's digest shows the edit too.
 */
async function watchSessionLogs($: EngineInterface, run: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const before = await sessionRecords($, home)
  const result = await run()
  if (before.length === 0) {
    return result
  }
  const changed = changedRecords(before, await sessionRecords($, home))
  if (changed.length === 0) {
    return result
  }
  const nowMs = await $.clock.now()
  await change($, s => recordWorkaround(s, 'log-edited', '', changed.join(', '), nowMs))
  const line = `dope-tdd: that command changed a session record in ~/.dope-tdd/sessions/ (${changed.join(', ')}); only dope-tdd writes those. Recorded as a workaround; say why.`
  $.ui.log(line)
  return tell(false, result, [line])
}

/** Locked modules a shell command writes that an approved override covers are let through and counted on it; the rest stay locked. */
async function coverShellWrites($: EngineInterface, root: string, locked: readonly string[], writes: readonly { path: string; module: string | null }[]): Promise<string[]> {
  const relative = writes.map(write => ({ ...write, path: relativePath(root, write.path) }))
  const covered = planShellCover(await readOverrides($, root), locked, relative, await $.clock.now(), await sessionIdNow($))
  if (covered.stillLocked.length < locked.length) {
    await writeOverrides($, root, covered.record)
  }
  return covered.stillLocked
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
  const build = (await read($, buildAtom)) || undefined
  // Sealed with a digest of its content (2026-10-26, integrity): a hand edit shows; see sessionLog.ts, sealRecord.
  const record = sealRecord(sessionRecord(s, config, { sessionId, reason, root, endedAtMs: nowMs, gitDir: await gitDirOf($, root), ...(build === undefined ? {} : { build }) }, formatStatus(s, nowMs, config, build)))
  await $.fs.write(sessionLogPath(home, nowMs, sessionId), `${JSON.stringify(record, null, 2)}
`)
}

/** Idea 15: what this session leaves red joins what earlier ones did, in the store the next briefing reads. */
async function storeLeftRed($: EngineInterface): Promise<void> {
  const key = leftRedKey(await $.session.root())
  const nowMs = await $.clock.now()
  const entries = leftRedAtEnd(freshLeftRed(await $.store.get(key), nowMs), await readStats($), nowMs)
  await (entries.length === 0 ? $.store.delete(key) : $.store.set(key, entries))
}

async function currentStatus($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  const config = await loadConfig($, root)
  await endExpiredPauses($, root, await $.clock.now())
  const s = await readStats($)
  const status = formatStatus(s, await $.clock.now(), config, (await read($, buildAtom)) || undefined)
  const overrides = formatOverrides(await readOverrides($, root), s.cycles)
  const operation = await detectGitOperation($, root)
  const unread = await read($, unreadRunners)
  const notes = [
    ...(operation === null ? [] : [standingDownLine(operation)]),
    ...(unread.length === 0 ? [] : [`not read: ${unread.join(', ')} (dope-tdd cannot read their summary yet; their runs are not counted)`]),
  ]
  return [...notes, status, ...overrides].join('\n')
}

/** /tdd and its subcommands; the hook drops the plugin prefix the app adds itself. */
async function tddCommand($: EngineInterface, args: string): Promise<string> {
  const raw = args.trim().split(/\s+/).filter(word => word !== '')
  const words = raw.map(word => word.toLowerCase())
  if (words[0] === 'why') {
    return formatGlossary()
  }
  if (words[0] === 'setup') {
    return await setupText($, await $.session.root(), words[1] === 'write', await $.clock.now())
  }
  // No off switch (the standard, "Guardrails, not walls"): a pause takes a time and a reason, and ends by itself.
  if (words[0] === 'off') {
    return 'dope-tdd has no off switch: a pause takes a time and a reason, and comes back on by itself. /tdd pause <minutes> <reason>, for example: /tdd pause 30 pairing on the prod incident in #301'
  }
  if (words[0] === 'on' || words[0] === 'resume') {
    return await resumeNow($)
  }
  if (words[0] === 'pause') {
    return await requestOverride($, { scope: 'pause', kind: 'other', minutes: Number(words[1]), reason: raw.slice(2).join(' ') }, 'human')
  }
  if (words[0] === 'approve' || words[0] === 'deny') {
    const why = raw.slice(1).join(' ')
    return await decidePending($, words[0] === 'approve', why === '' ? null : why)
  }
  if (words[0] === 'override' && words[1] === 'end') {
    // The module id keeps its case, as for the receipt.
    return await endNamed($, raw[2])
  }
  // Band v3: reset left the band (one unconfirmed press erased the record). It asks first, keeps the workarounds,
  // and logs itself.
  if (words[0] === 'reset') {
    if (words[1] !== 'yes') {
      return 'This starts the session counts over: runs, cycles, blocked, the recent events. The workarounds and the override record stay. /tdd reset yes to go ahead.'
    }
    const nowMs = await $.clock.now()
    await change($, s => resetStats(s, nowMs))
    return 'dope-tdd: the session counts start over; the reset is on the record.'
  }
  if (words[0] === 'receipt') {
    const root = await $.session.root()
    // The module id keeps its case: server/managers/RoomManager is not server/managers/roommanager.
    return await receiptText($, root, await loadConfig($, root), raw[1], await $.clock.now())
  }
  return await currentStatus($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(MINUTE, () => {
      void $.clock.now().then(async nowMs => {
        await endExpiredPauses($, await $.session.root(), nowMs)
        const s = await change($, s => expireCurrent(s, nowMs))
        return hasActivity(s) ? update($, tick, n => n + 1) : undefined
      })
    })
    const started = await next(e)
    await update($, attended, () => e.isInteractive)
    const build = await readBuild($)
    await update($, buildAtom, () => build)
    await rememberSessionId($)
    await seedFromStore($)
    await $.command.register({
      name: 'tdd',
      description:
        'Show the TDD guard status and recent events; /tdd why explains the words on the band; /tdd setup detects where your tests live; /tdd receipt prints the receipt for a pull request; /tdd approve and /tdd deny <why> decide an override request; /tdd pause <minutes> <reason> and /tdd resume; /tdd override end <module|pause>',
    })
    await $.tool.register({
      name: 'override_request',
      description:
        'Ask to pass the TDD guard, with a reason. Use it only when writing or pinning a test first does not fit. The approver this repo set decides: the person, or a reviewer model the repo opted into. The request and the decision are recorded in dope-tdd.overrides.json and shown on the receipt. If it waits for the person, stop and wait. scope: change (one edit), module (every edit to the module, until what "until" names), pause (every module, for "minutes").',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The source file, relative to the repo root (change and module scope).' },
          scope: { type: 'string', enum: ['change', 'module', 'pause'] },
          kind: { type: 'string', enum: ['spike', 'hotfix', 'generated', 'legacy', 'other'] },
          reason: { type: 'string', description: 'What, why, and what happens next.' },
          until: { type: 'string', description: 'What ends it (module scope).' },
          minutes: { type: 'integer', description: 'How long (pause scope).' },
        },
        required: ['scope', 'kind', 'reason'],
      },
    })
    await $.tool.register({
      name: 'status',
      description: 'Report the TDD guard state: paused or on, phase, current module, counts, and the recent event log.',
    })
    return started
  })

  // /clear, /resume and /branch reset $.state and do not fire session.start: without this, remembered unlocks are lost
  // and the next edit to a module whose test was already written is refused. A compaction keeps $.state.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await rememberSessionId($)
    await seedFromStore($)
    return next(e)
  }).catch(($, e, next) => {
    reportGuardFailure($, 'session re-seed', next.error)
    return next(e)
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
    try {
      await storeLeftRed($)
    } catch {
      // A note for the next session, not a gate.
    }
    return next(e)
  })

  // The app already names the plugin on a command's output (live trial: "dope-tdd: dope-tdd: ..."), so the text drops it.
  on('command.run', { command: 'tdd' }, async ($, e) => ({ text: (await tddCommand($, e.args)).replace(/^dope-tdd: /, '') }))

  // The briefing: the rules in Claude's system prompt, so the first refusal is an expected step, not a surprise.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = await briefing($)
    // Only the briefing: field guides from ~/.dope-tdd/guides were cut on 2026-10-20 (verified review B7).
    return text === null ? composed : { sections: [...composed.sections, { id: 'dope-tdd:briefing', text, scope: 'session' as const }] }
  })

  // #222 (tester round 6): prompt.compose reaches the main session's system prompt only, so a subagent learned the
  // rules from its first refusal. The briefing rides on the task it is spawned with. A fork inherits the parent's
  // context, briefing included; a workflow agent's prompt cannot be rewritten.
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.subagentType === 'fork' || e.workflow !== undefined) {
      return next(e)
    }
    const text = await briefing($)
    return next(text === null ? e : { ...e, prompt: `${e.prompt}\n\n${text}` })
  }).catch(($, e, next) => next(e))

  // Pin corrected (2026-10-18): the pin skill running, typed or called by the agent, is what tells a corrected pin from a
  // test bent to match a bug. Watched only; the skill's prompt passes through unchanged.
  on('skill.prompt', async ($, e, next) => {
    if (PIN_SKILL.test(e.skill)) {
      const nowMs = await $.clock.now()
      await change($, s => recordPinSkill(s, nowMs))
    }
    // Idea 19: the spike skill carries its question on a Question: line (spike.ts, spikeQuestion).
    if (SPIKE_SKILL.test(e.skill)) {
      const nowMs = await $.clock.now()
      await change($, s => recordSpike(s, spikeQuestion(e.text), nowMs))
    }
    return next(e)
  })

  on('tool.call', { tool: STATUS_TOOL }, async $ => ({ result: await currentStatus($) }) as ToolCallResult).catch(($, _e, next) => {
    reportGuardFailure($, 'status', next.error)
    return { result: `dope-tdd: the status could not be read (${next.error.kind}); try /tdd` } as ToolCallResult
  })

  on('tool.call', { tool: OVERRIDE_TOOL }, async ($, e) => ({ result: await requestOverride($, e as unknown as Record<string, unknown>, 'agent') }) as ToolCallResult).catch(($, _e, next) => {
    reportGuardFailure($, 'override', next.error)
    return { result: `dope-tdd: the override request could not be recorded (${next.error.kind}); stop and ask the user.` } as ToolCallResult
  })

  // The paths a subagent reads and searches say which worktree it works in, before it runs a command there (#198).
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.file_path)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Glob' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.path)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.path)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.file_path)
    return guardFileWrite($, 'Edit', e.file_path, () => next(e), e.agentId)
  }).catch(($, e, next) => {
    reportGuardFailure($, 'Edit', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.file_path)
    return guardFileWrite($, 'Write', e.file_path, () => next(e), e.agentId)
  }).catch(($, e, next) => {
    reportGuardFailure($, 'Write', next.error)
    return next(e)
  })

  // A notebook cell edit writes a file too, and an untested one is refused like an Edit (#195). Its path is notebook_path.
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    await placeAgent($, e.agentId, e.notebook_path)
    return guardFileWrite($, 'NotebookEdit', e.notebook_path, () => next(e), e.agentId)
  }).catch(($, e, next) => {
    reportGuardFailure($, 'NotebookEdit', next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => watchSessionLogs($, () => keepRecord($, e.command, () => guardShell($, e.command, () => next(e), 'bash', e.agentId)))).catch(($, e, next) => {
    reportGuardFailure($, 'Bash', next.error)
    return next(e)
  })

  // Windows sessions run their shell through this tool; test runs, writes and the git backstop are the same story.
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => watchSessionLogs($, () => keepRecord($, e.command, () => guardShell($, e.command, () => next(e), 'powershell', e.agentId)))).catch(($, e, next) => {
    reportGuardFailure($, 'PowerShell', next.error)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const current = await readStats($)
    const standingDown = await read($, gitOperation)
    const record = await read($, overrideRecord)
    // Band v3: always drawn, so a new user learns it is there; before any activity it says what it will do.
    if (e.props.hasSurvey) {
      return next(e)
    }

    const nowMs = await $.clock.now()
    const root = await $.session.root()
    const config = await configForRender($, root)
    const logo = e.surface === 'terminal' ? null : await loadLogo($)

    return drawBand($.ui.resolve(e), {
      stats: current,
      config,
      // #214: the session-start survey (layoutNotes) says when the default layout pairs none of the code.
      matchesNothing: config.layoutGuessed === true && (layoutNotes.get(root) ?? null) !== null,
      nowMs,
      logo,
      standingDown,
      saved: await read($, savedAtom),
      onViewTest: () => $.ui.open({ id: TEST_PANE, title: `Test · ${current.current === null ? '' : moduleLabel(config, current.current.module)}` }),
      onOpenLastRun: () => {
        const target = lastRunTarget(current)
        return $.ui.open({ id: LAST_RUN_PANE, title: `Last run · ${target === null ? '' : (target.replace(/\\/g, '/').split('/').pop() ?? target)}` })
      },
      overrides: record,
      session: await sessionIdForBand($),
      onApprove: async () => toast($, await decidePending($, true, null)),
      onDeny: async () => toast($, await decidePending($, false, null)),
      onResume: async () => {
        await resumeNow($)
      },
      onEnd: async (target: string) => toast($, await endNamed($, target)),
    })
  })

  on('ui.render', { component: 'Pane', requestId: TEST_PANE }, async ($, e) => {
    const { current } = await readStats($)
    const source = current ? await readSource($, current.testPath) : null
    const label = current === null ? undefined : moduleLabel(await configForRender($, await $.session.root()), current.module)
    return drawTestPane($.ui.resolve(e), { current, source, label })
  })

  // The test file the last run was: the same pane as VIEW TEST, for whichever test that run belonged to (2026-10-18).
  on('ui.render', { component: 'Pane', requestId: LAST_RUN_PANE }, async ($, e) => {
    const s = await readStats($)
    const target = lastRunTarget(s)
    const root = await $.session.root()
    const testPath = target === null ? null : absolutePath(root, target)
    const source = testPath === null ? null : await readSource($, testPath)
    const current = testPath === null ? null : { module: s.lastRun?.module ?? '', testPath }
    return drawTestPane($.ui.resolve(e), { current, source, ...(testPath === null ? {} : { label: relativePath(root, testPath) }) })
  })
}
