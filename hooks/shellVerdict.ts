// The decisions `checkShell` in register.tsx makes about a shell command, as plain data in and out (#59). The engine
// follows `$` only into functions declared in register.tsx, so that file gathers the inputs and carries out the
// result; what is decided lives here, where a unit test reaches it without the fake engine.
import { carriedOnAdvice, redUnlockAdvice, unreadableRunnerAdvice } from './advice.ts'
import type { GuardConfig, Policy } from './config.ts'
import { classifyPath, isInsideRoot, moduleLabel, relativePath, sameCheckout, sourcePathFor } from './mirror.ts'
import type { LayoutConfig } from './mirror.ts'
import { neverRan, runnerDidNotStart, unreadableRunner } from './runOutcome.ts'
import type { RunOutcome } from './runOutcome.ts'
import { filtersTests, namedTestFile, readRun } from './runners.ts'

/** `path`: the file written, so an unlock counts only in its own checkout (#198). */
export type ShellWrite = { readonly module: string | null; readonly policy: Policy; readonly path?: string }

/**
 * Which modules a shell command's writes may not reach yet: `locked`, enforced with no unlock; `waiting`, unlocked
 * only by a carry-over from an earlier session, whose run this session it waits for, as an Edit does (#54).
 * `root`, the session's: an unlock counts only for a write in the checkout its test is in (#198).
 */
export function gateShellWrites(
  writes: readonly ShellWrite[],
  unlocked: Readonly<Record<string, string>>,
  inherited: Readonly<Record<string, number>>,
  root?: string,
  mainCheckout?: string,
): { locked: string[]; waiting: string[] } {
  const isUnlocked = ({ module, path }: ShellWrite): boolean => {
    const testPath = module === null ? undefined : unlocked[module]
    return testPath !== undefined && (root === undefined || path === undefined || sameCheckout(root, path, testPath, mainCheckout))
  }
  const locked = writes.flatMap(write =>
    write.module !== null && write.policy === 'enforce' && !isUnlocked(write) ? [write.module] : [],
  )
  const waiting = writes.flatMap(write =>
    write.module !== null && write.policy === 'enforce' && isUnlocked(write) && inherited[write.module] !== undefined ? [write.module] : [],
  )
  return { locked, waiting }
}

export type ShellGateInput = {
  /** The command writes the override record, which only dope-tdd writes (overrides.ts). */
  readonly writesRecord: boolean
  /** From gateShellWrites, after the approved overrides that cover them are taken out. */
  readonly locked: readonly string[]
  readonly waiting: readonly string[]
  readonly paused: boolean
}

export type ShellGateVerdict = { kind: 'deny-record' } | { kind: 'refuse'; locked: string[]; waiting: string[] } | { kind: 'go' }

/** The verdict on a shell command's writes before it runs (#59, 2026-10-18); register.tsx words the refusal and records it. */
export function shellGate(input: ShellGateInput): ShellGateVerdict {
  // The record is evidence of who approved what: refused even while paused, as an Edit to it is (fileGate.ts).
  if (input.writesRecord) {
    return { kind: 'deny-record' }
  }
  if (input.paused || (input.locked.length === 0 && input.waiting.length === 0)) {
    return { kind: 'go' }
  }
  return { kind: 'refuse', locked: [...input.locked], waiting: [...new Set(input.waiting)] }
}

export type ShellRunReading = {
  /** What the run says for this project; 'none' for no run here, a runner that never started, or one not read yet. */
  readonly outcome: RunOutcome
  /** Why the runner never started, when it did not: the agent is told, and it is not an unread run. */
  readonly notStarted: string | null
  /** A runner dope-tdd recognises but cannot read yet: named once, its runs not counted. */
  readonly unreadable: string | null
}

/**
 * A shell command's output as a run of this project's tests. `runLocation` is where the run ran (null when the command
 * ran no tests): a run is this project's only when it executes inside the root, so `cd ../other && npx vitest run` is
 * another repository's. A command held for approval or refused never ran: no run to read, nothing to count.
 */
export function readShellRun(output: string, runLocation: string | null, root: string): ShellRunReading {
  const ran = runLocation !== null && isInsideRoot(root, runLocation) && !neverRan(output)
  const read = ran ? readRun(output) : 'none'
  const notStarted = read === 'unknown' ? runnerDidNotStart(output) : null
  const unreadable = read === 'unknown' && notStarted === null ? unreadableRunner(output) : null
  return { outcome: notStarted === null && unreadable === null ? read : 'none', notStarted, unreadable }
}

/**
 * The red run of one named test file, which is judged by which tests fail (judgeFailures): the module whose test file
 * the command names, whichever was touched last. A run filtered to some tests by name says nothing about the rest, so
 * it is never judged this way. `start` is where the shell is; `root` is the checkout the file is classified against.
 * `foreign`: the modules unlocked in another checkout, whose failures this run cannot add to (#250).
 */
export function ownTestRun(command: string, outcome: RunOutcome, start: string, root: string, config: GuardConfig, foreign: readonly string[] = []): { module: string; testPath: string } | null {
  const ownFile = outcome === 'fail' && !filtersTests(command) ? namedTestFile(command, config.stack, start) : null
  const ownTarget = ownFile === null ? null : classifyPath(root, ownFile, config)
  return ownFile !== null && ownTarget?.kind === 'test' && !foreign.includes(ownTarget.module) ? { module: ownTarget.module, testPath: ownFile } : null
}

export type FailureJudgement = {
  readonly outcome: 'pass' | 'fail'
  /** The failing tests that were failing before the change, named to the agent when the run counts as green. */
  readonly alreadyFailing: string[]
  /** What the caller records: the names as the module's known failures, as its red, or nothing. */
  readonly record: 'known' | 'red' | null
}

/**
 * A red run of the module's own test file, judged by which tests fail. Tests that were failing before the change
 * neither hide a red nor block a green: only the known failures, or fewer than the red with none new, is green.
 */
export function judgeFailures(
  names: readonly string[],
  state: { readonly knownFailures?: readonly string[]; readonly redFailures?: readonly string[] },
): FailureJudgement {
  const within = (set: readonly string[]) => names.length > 0 && set.length > 0 && names.every(name => set.includes(name))
  if (within(state.knownFailures ?? [])) {
    return { outcome: 'pass', alreadyFailing: [...names], record: null }
  }
  if (within(state.redFailures ?? []) && names.length < (state.redFailures ?? []).length) {
    return { outcome: 'pass', alreadyFailing: [...names], record: 'known' }
  }
  return { outcome: 'fail', alreadyFailing: [], record: names.length > 0 ? 'red' : null }
}

export type ShellReminderFacts = {
  readonly paused: boolean
  /** Sources the command changed with no test touched first. */
  readonly unguardedPaths: readonly string[]
  readonly alreadyFailing: readonly string[]
  /** The module whose own test those failures are in; null says "this module". */
  readonly alreadyFailingModule: string | null
  /** Why the runner did not start, when it did not. */
  readonly notStarted: string | null
  /** A runner dope-tdd cannot read, given only the first time it is seen, since it is said once. */
  readonly unreadableRunner: string | null
  /** Sources changed while a command that cannot write them ran. */
  readonly bystanders: readonly string[]
  /** The commented-out-code notes, already worded. */
  readonly commented: readonly string[]
  readonly redUnlocked: readonly string[]
  /** Modules whose carried-over unlock this run made active again, each with its test's absolute path. */
  readonly carriedOn: readonly { readonly module: string; readonly testPath: string }[]
  readonly passed: boolean
  /** The run's own advice line, last. */
  readonly advice: string | null
}

/** The lines appended to a shell command's result, in their fixed order; none while the guard is paused. */
export function shellReminders(facts: ShellReminderFacts, config: LayoutConfig, root: string): string[] {
  const { alreadyFailing } = facts
  return facts.paused
    ? []
    : [
        ...facts.unguardedPaths.map(path => `dope-tdd: ${path} changed through a shell command without a test touched first.`),
        ...(alreadyFailing.length === 0
          ? []
          : [
              `dope-tdd: ${facts.alreadyFailingModule === null ? 'this module' : moduleLabel(config, facts.alreadyFailingModule)} is green apart from ${alreadyFailing.length} test${alreadyFailing.length === 1 ? ' that was' : 's that were'} already failing before your change: ${alreadyFailing.slice(0, 3).join('; ')}${alreadyFailing.length > 3 ? '; …' : ''}.`,
            ]),
        ...(facts.notStarted === null ? [] : [`dope-tdd: the test runner did not start (${facts.notStarted}); nothing was counted. Run it the way this project runs its tests.`]),
        ...(facts.unreadableRunner === null ? [] : [unreadableRunnerAdvice(facts.unreadableRunner)]),
        ...facts.bystanders.map(path => `dope-tdd: ${path} changed while the command ran, but the command cannot have changed it (another editor or session?); not counted.`),
        ...facts.commented,
        ...facts.redUnlocked.map(module => redUnlockAdvice(moduleLabel(config, module), sourcePathFor(config, module))),
        ...facts.carriedOn.map(({ module, testPath }) => carriedOnAdvice(sourcePathFor(config, module), relativePath(root, testPath), facts.passed)),
        ...(facts.advice === null ? [] : [facts.advice]),
      ]
}
