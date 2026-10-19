import type { TddStats } from '../types'
import { staleUnlockNote } from './advice.ts'
import type { RunnerKind } from './catchCheck.ts'
import { CONFIG_FILE } from './config.ts'
import type { GuardConfig } from './config.ts'
import { extOf, sourcePathFor, testPathFor } from './mirror.ts'

// A name that says throwaway (`orig.index.tmp`, `scratch/compare`): the refusal also says where such a script belongs (#32).
export const LOOKS_THROWAWAY = /(?:^|[/._-])(?:tmp|temp|scratch|orig)(?:[/._-]|$)/i

// The cheap paths come first; the override is last, and says a person decides (the standard, "Guardrails, not walls").
export const OVERRIDE_HINT = '(3) neither fits: ask for an override with mcp__dope-tdd__override_request; a person decides, and it is recorded'

/**
 * The agent contract (2026-10-18): the ways past a refusal as a numbered menu, the first with the exact command, so an
 * agent acts on a line instead of interpreting prose. `offerOverride` is false after the module's first refusal: said
 * on every refusal, the override read as the expected path rather than the last resort.
 */
export function unblockSteps(testPath: string, command: string | undefined, offerOverride: boolean): string {
  return [
    'Unblock by one of:',
    `(1) write or edit ${testPath} so it fails, then run it${command === undefined ? '' : `: ${command}`}`,
    '(2) no test for this code yet: /dope-tdd:pin pins what it does now',
    ...(offerOverride ? [OVERRIDE_HINT] : []),
  ].join('\n')
}

export type LockedFacts = {
  /** How the project runs that one test file, when a runner is found. */
  command?: string
  /** An earlier refusal this session already offered the override for this module. */
  overrideOffered?: boolean
  /** The band's last-run line (bandModel.ts lastRunLine): one source of facts for the person and the agent. */
  lastRun?: string | null
}

/**
 * `staleAgeMs`: the module had a carried-over unlock, dropped because its test changed since (#54); the refusal says so.
 * `sourceExt`: the extension of the file being written, so the test named is one the project's runner runs (#53).
 */
export function lockedMessage(config: GuardConfig, module: string, staleAgeMs?: number, sourceExt?: string, facts: LockedFacts = {}): string {
  const guess = config.layoutGuessed === true ? ' That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.' : ''
  const scratch = LOOKS_THROWAWAY.test(module) ? ' One-off script? Put it outside the repo (your scratchpad or temp directory); dope-tdd guards project sources.' : ''
  const testPath = testPathFor(config, module, sourceExt)
  const stale = staleAgeMs === undefined ? '' : staleUnlockNote(testPath, staleAgeMs)
  const head = `dope-tdd: write the failing test first. Touch ${testPath}, or run it and see it fail, before editing ${sourcePathFor(config, module)}.${stale}${guess}${scratch}`
  const lastRun = facts.lastRun === undefined || facts.lastRun === null ? [] : [facts.lastRun]
  return [head, unblockSteps(testPath, facts.command, facts.overrideOffered !== true), ...lastRun].join('\n')
}

/** Whether this session already refused an edit to the module: the event log keeps its last 50 events, so an old one may have rolled off, and then the override is offered again. */
export function wasRefused(s: TddStats, module: string): boolean {
  return s.events.some(event => event.kind === 'blocked' && event.module === module)
}

/** A refused write to a locked module's file, with the stale note when a carried-over unlock was dropped for it. */
export function lockedFor(config: GuardConfig, s: TddStats, module: string, nowMs: number, writtenPath?: string, facts: LockedFacts = {}): string {
  const staleAt = s.stale[module]
  return lockedMessage(config, module, staleAt === undefined ? undefined : nowMs - staleAt, writtenPath === undefined ? undefined : extOf(writtenPath), {
    overrideOffered: wasRefused(s, module),
    ...facts,
  })
}

export function checkingMessage(module: string): string {
  return `dope-tdd is verifying that the test for ${module} catches the change; retry in a moment.`
}

export function experimentalCheckReason(kind: RunnerKind): string {
  return `${kind} is experimental, so its check would undo your change on disk; "catchCheck": true in ${CONFIG_FILE} allows it`
}

export function standingDownLine(operation: string): string {
  return `standing down: a git ${operation} is in progress; nothing is guarded, counted or checked until it ends`
}
