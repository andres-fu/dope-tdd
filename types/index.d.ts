export type Phase = 'idle' | 'writing' | 'red' | 'green'
export type HistoryEntry = 'pass' | 'fail'
export type EventKind =
  | 'touched'
  | 'edited'
  | 'unguarded'
  | 'blocked'
  | 'pass'
  | 'fail'
  | 'elsewhere'
  | 'unread'
  | 'paused'
  | 'resumed'
  | 'caught'
  | 'missed'
  | 'unverified'
  | 'refactor'
  | 'test-changed'
  | 'config'
  | 'skipped'
  | 'assertion-removed'
  | 'commented-out'
  | 'hollow-touch'

/** `slipped` on a miss: the lines of the change the test did not notice, as `+ line` and `- line`. */
export type CatchOutcome = { kind: 'caught' } | { kind: 'missed'; slipped?: readonly string[] } | { kind: 'unverified'; reason: string }

export type ChangeKind = 'fix' | 'refactor'

/** Why `before` is null: the file did not exist, or it existed and could not be read (too large, locked). */
export type BeforeState = 'missing' | 'unreadable'

export type CycleChange = { path: string; before: string | null; after: string; kind: ChangeKind; beforeState?: BeforeState }

export type CycleVerdict = { module: string; sawRed: boolean; testChanged: boolean }

/** Held while the catch check has a source file reverted on disk. Expires, so a crash cannot leave it stuck. */
export type CheckLock = { module: string; sinceMs: number }

/**
 * One module's own cycle. The band shows the current module and the global
 * phase fields mirror it; every verdict word is computed from this record,
 * so a red on one module is never charged to another.
 */
export type ModuleState = {
  phase: Phase
  cycleStartMs: number | null
  /** This module's test failed in its open cycle. */
  sawRed: boolean
  /** Its test was edited after that red. */
  testTouchedAfterRed: boolean
  /** Its test has failed at some point: a change while it is green can be a refactor. */
  everSawRed: boolean
  /** A source edit, captured or not, since its last run. */
  editedSinceRun: boolean
}

export type CurrentTest = {
  module: string
  testPath: string
}

export type TddEvent = {
  atMs: number
  kind: EventKind
  module?: string
  detail?: string
}

export type TddStats = {
  phase: Phase
  paused: boolean
  passes: number
  fails: number
  unreadRuns: number
  history: readonly HistoryEntry[]
  cycles: number
  cycleMsTotal: number
  cycleStartMs: number | null
  sawRed: boolean
  redElsewhere: readonly string[]
  testChangedAfterRed: boolean
  neverSawRed: number
  testChanged: number
  /** Ways around the guard, on the record: total and by kind. */
  workarounds: number
  workaroundsBy: Readonly<Record<string, number>>
  modules: Readonly<Record<string, ModuleState>>
  unproven: readonly string[]
  testFirst: number
  unguarded: number
  blocked: number
  unlocked: Readonly<Record<string, string>>
  inherited: Readonly<Record<string, number>>
  reminded: readonly string[]
  changes: Readonly<Record<string, CycleChange>>
  checking: CheckLock | null
  caught: number
  missed: number
  unverified: number
  refactors: number
  /** `path` is the source file the check reverted, kept for the receipt after the change record is cleared. */
  lastCatch: { module: string; outcome: CatchOutcome | { kind: 'refactor' }; path?: string } | null
  lastCycle: CycleVerdict | null
  current: CurrentTest | null
  events: readonly TddEvent[]
  lastEventMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'dope-tdd': { stats: TddStats; tick: number }
  }
}
