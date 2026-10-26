// What to tell the agent after an edit or a run: the decisions. The words are in the catalogue (messages.ts, 2026-10-18).
import type { CatchOutcome, TddStats } from '../types'
import { say } from './messages.ts'

export type Check = CatchOutcome | 'refactor'

export type RunContext = {
  /** Test files that failed when the current module's own test did not. */
  elsewhere?: readonly string[]
  /** The test was edited after this cycle's red and the code did not change. */
  testChanged?: boolean
  /** How messages name the module's source under the project's layout; `src/<module>` by default. */
  sourcePath?: string
  /** How messages name the module itself, when not by its id (a folder with a layout of its own, #24). */
  label?: string
  /** This run closed the current module's own cycle; cycles it closed for other modules do not count (#41). */
  cycleCompleted?: boolean
  /** The open module whose own test this run was, when the band stayed on the current one (runPlan.ts, ownTestOf). */
  ownTestOf?: string
  /** The red never reached an assertion (runners.ts, failedOnlyOnErrors). */
  errorsOnly?: boolean
}

function defaultSource(module: string): string {
  return `src/${module}`
}

function defaultTest(module: string): string {
  return `tests/${module}.test.ts(x)`
}

export function touchAdvice(module: string, sourcePath = defaultSource(module), command?: string): string {
  return say('touch.unlocked', { module, sourcePath, command })
}

/** Warn mode only: there the edit under a carried-over unlock goes through, and this reminder follows it. */
export function inheritedAdvice(module: string, testPath: string, ageMs: number, sourcePath = defaultSource(module)): string {
  return say('inherited.reminder', { sourcePath, testPath, ageMs })
}

/** #54: the first edit under a carried-over unlock, refused until its test runs once this session. */
export function carryWaitMessage(sourcePath: string, testPath: string, ageMs: number, command?: string): string {
  return say('carry.wait', { sourcePath, testPath, ageMs, command })
}

/** That run happened: the unlock is active, and a red is named as already there, not the agent's. */
export function carriedOnAdvice(sourcePath: string, testPath: string, passed: boolean): string {
  return say(passed ? 'carry.onGreen' : 'carry.onRed', { sourcePath, testPath })
}

/** Appended to the ordinary refusal when the module had a carried-over unlock that was dropped because its test changed. */
export function staleUnlockNote(testPath: string, ageMs: number): string {
  return say('note.staleUnlock', { testPath, ageMs })
}

export function redUnlockAdvice(module: string, sourcePath = defaultSource(module)): string {
  return say('red.unlocked', { module, sourcePath })
}

export function hollowTouchAdvice(testPath: string): string {
  return say('touch.unchanged', { testPath })
}

export function importAdvice(testPath: string, modules: readonly string[]): string {
  return say('touch.imports', { testPath, modules })
}

export function commentsOnlyAdvice(testPath: string, module: string): string {
  return say('touch.commentsOnly', { testPath, module })
}

export function hollowAdvice(testPath: string): string {
  return say('test.noAssertion', { testPath })
}

export function unguardedAdvice(module: string, sourcePath = defaultSource(module), testPath = defaultTest(module)): string {
  return say('edit.unguarded', { sourcePath, testPath })
}

/** `runner` is the one that ran, when the command says (node --test prints its summary before the failures). */
export function unreadRunAdvice(truncated: boolean, runner?: 'node-test', crashed = false): string {
  if (crashed) {
    return say('run.crashed', {})
  }
  return truncated ? say('run.truncated', {}) : say('run.unread', { nodeTest: runner === 'node-test' })
}

export function unreadableRunnerAdvice(runner: string): string {
  return say('run.unreadable', { runner })
}

export function configChangedAdvice(detail: string): string {
  return say('config.changed', { detail })
}

export function skippedAdvice(testPath: string, added: number): string {
  return say('workaround.skipped', { testPath, added })
}

export function assertionsRemovedAdvice(testPath: string, before: number, after: number): string {
  return say('workaround.assertionsRemoved', { testPath, before, after })
}

export function commentedOutAdvice(sourcePath: string, lines: number): string {
  return say('workaround.commentedOut', { sourcePath, lines })
}

function greenAdvice(
  module: string,
  sawRed: boolean,
  check: Check | undefined,
  cycleCompleted: boolean,
  testChanged: boolean,
  sourcePath: string,
  /** The pin skill is in use this session: a test changed after red is a pin correction (2026-10-18). */
  pinning = false,
  /** This red proved a module that went green first: a pin broken on purpose and put back (2026-10-19). */
  pinBroken = false,
): string | null {
  if (check === 'refactor') {
    return say('green.refactor', { module })
  }
  if (check?.kind === 'proven' && check.pinned === true && check.mutation !== undefined) {
    const { tried, caught, survived } = check.mutation
    return say('green.pinProven', { module, tried, caught, survived, lineEndings: check.lineEndings === true })
  }
  if (check?.kind === 'missed' && check.mutation !== undefined) {
    return say('green.newFileMissed', { module, tried: check.mutation.tried, survived: check.mutation.survived })
  }
  if (check?.kind === 'proven' && check.mutation !== undefined) {
    const { tried, caught, survived } = check.mutation
    return say('green.newFileProven', { module, tried, caught, survived })
  }
  if (check?.kind === 'missed') {
    return say('green.missed', { module, sawRed, slipped: check.slipped ?? [] })
  }
  if (check?.kind === 'proven') {
    return say('green.brokenProven', { module, lineEndings: check.lineEndings === true })
  }
  if (check?.kind === 'caught' && check.by !== undefined) {
    return say('green.provenBy', { module, sawRed, own: check.own ?? 'its paired test', by: check.by })
  }
  if (check?.kind === 'caught') {
    return say('green.caught', { module, sawRed, ...(check.message === undefined ? {} : { message: check.message }) })
  }
  if (check?.kind === 'unverified') {
    return say('green.notChecked', { module, sawRed, reason: check.reason })
  }
  if (testChanged) {
    return say(pinning ? 'green.pinCorrected' : 'green.testChanged', { module, sourcePath })
  }
  if (!cycleCompleted) {
    return null
  }
  return say(pinBroken ? 'green.pinBreakProven' : sawRed ? 'green.sawRed' : 'green.neverRed', { module })
}

export function runAdvice(before: TddStats, after: TddStats, check?: Check, context: RunContext = {}): string | null {
  const id = after.current?.module
  if (id === undefined) {
    return null
  }
  const module = context.label ?? id
  const sourcePath = context.sourcePath ?? defaultSource(module)
  if (context.elsewhere !== undefined && context.elsewhere.length > 0) {
    return say('red.elsewhere', { module, sourcePath, files: context.elsewhere, sawRed: before.sawRed })
  }
  const red = after.phase === 'red'
  // Before any code change this cycle, a red is the bug or a pin that guessed today's behaviour wrongly (VibeCast field
  // test, 2026-10-18: a wrong pin was told to "make it pass", which would mean changing code that was right).
  // A red where no assertion ran is neither (Karl's round 4, 2026-10-20): "fix the assertion" was wrong advice there.
  const line = red
    ? say(context.errorsOnly === true ? 'red.errorsOnly' : after.changes[id] === undefined ? 'red.first' : 'red.again', { module })
    : greenAdvice(module, before.sawRed, check, context.cycleCompleted ?? after.cycles > before.cycles, context.testChanged === true, sourcePath, after.pinning, before.pinBroken)
  const errorsNote = red && context.errorsOnly === true && before.unproven.includes(id) ? say('note.errorsOnly', { module }) : ''
  const other = context.ownTestOf
  const said = line === null ? null : line + errorsNote
  return said === null || other === undefined ? said : said + say('note.ownTestToo', { module, other, outcome: red ? 'red' : 'green' })
}
