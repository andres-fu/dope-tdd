// The decisions `checkShell` in register.tsx makes about a shell command, as plain data in and out (#59). The engine
// follows `$` only into functions declared in register.tsx, so that file gathers the inputs and carries out the
// result; what is decided lives here, where a unit test reaches it without the fake engine.
import { carriedOnAdvice, redUnlockAdvice, unreadableRunnerAdvice } from './advice.ts'
import type { Policy } from './config.ts'
import { moduleLabel, relativePath, sourcePathFor } from './mirror.ts'
import type { LayoutConfig } from './mirror.ts'

export type ShellWrite = { readonly module: string | null; readonly policy: Policy }

/**
 * Which modules a shell command's writes may not reach yet: `locked`, enforced with no unlock; `waiting`, unlocked
 * only by a carry-over from an earlier session, whose run this session it waits for, as an Edit does (#54).
 */
export function gateShellWrites(
  writes: readonly ShellWrite[],
  unlocked: Readonly<Record<string, string>>,
  inherited: Readonly<Record<string, number>>,
): { locked: string[]; waiting: string[] } {
  const locked = writes.flatMap(({ module, policy }) =>
    module !== null && policy === 'enforce' && unlocked[module] === undefined ? [module] : [],
  )
  const waiting = writes.flatMap(({ module, policy }) =>
    module !== null && policy === 'enforce' && unlocked[module] !== undefined && inherited[module] !== undefined ? [module] : [],
  )
  return { locked, waiting }
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
