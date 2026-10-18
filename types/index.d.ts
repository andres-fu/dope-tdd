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
  | 'proven'
  | 'missed'
  | 'unverified'
  | 'refactor'
  | 'test-changed'
  | 'config'
  | 'skipped'
  | 'assertion-removed'
  | 'commented-out'
  | 'hollow-touch'
  /** #54: an edit refused because a carried-over unlock waits for one run of its test this session. */
  | 'needs-run'
  /** #54: that run happened; the carried-over unlock is active. */
  | 'carried-on'
  /** #54: a carried-over unlock dropped at session start because its test changed since. */
  | 'stale-unlock'
  /** #89: a problem found in another project, reported to its owner and never fixed from here. */
  | 'reported-elsewhere'

/** `slipped` on a miss: the lines of the change the test did not notice, as `+ line` and `- line`. */
/** `proven`: the code was broken on purpose, the test went red, and the code is back byte for byte: the red was the check. */
/** A new file's check: small changes made to it in a throwaway copy, how many turned the test red, and which did not. */
export type MutationResult = { tried: number; caught: number; survived: readonly string[] }

export type CatchOutcome =
  /** `by`: not the module's own test (`own`) but a test that imports it, both relative to the root (#25). */
  | { kind: 'caught'; by?: string; own?: string }
  /** `pinned`: proven by a deliberate break, and `mutation` is the small-change check run on the pinned file after it (#55). */
  /** `lineEndings`: the restored code matches the code from before the break except CRLF against LF (#57). */
  | { kind: 'proven'; mutation?: MutationResult; pinned?: boolean; lineEndings?: boolean }
  | { kind: 'missed'; slipped?: readonly string[]; mutation?: MutationResult }
  | { kind: 'unverified'; reason: string }

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
  /** The tests named as failing by this cycle's red runs of its test file. */
  redFailures?: readonly string[]
  /** Tests in its file that were failing before the change and still fail: they neither hide a red nor block a green. */
  knownFailures?: readonly string[]
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
  /** Tests seen importing a module, beside its own test: tried when its own test misses a change (#25). */
  importers: Readonly<Record<string, readonly string[]>>
  /**
   * Unlocks carried over from an earlier session, by when their test was touched. Pending (#54): the first edit waits
   * for one run of the test this session; that run removes the entry and the unlock is active.
   */
  inherited: Readonly<Record<string, number>>
  /** Carried-over unlocks dropped because the test changed since, by when they were stored: the refusal says why (#54). */
  stale: Readonly<Record<string, number>>
  reminded: readonly string[]
  changes: Readonly<Record<string, CycleChange>>
  checking: CheckLock | null
  caught: number
  proven: number
  missed: number
  unverified: number
  refactors: number
  /** Milliseconds spent in catch checks this session, baselines included. */
  checkMsTotal: number
  /** Catch checks that ran in a worktree, with the user's files untouched. */
  worktreeChecks: number
  /** `path` is the source file the check reverted, kept for the receipt after the change record is cleared. */
  lastCatch: { module: string; outcome: CatchOutcome | { kind: 'refactor' }; path?: string } | null
  lastCycle: CycleVerdict | null
  current: CurrentTest | null
  events: readonly TddEvent[]
  lastEventMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'dope-tdd': { stats: TddStats; tick: number; 'bash-cwd': string; 'powershell-cwd': string; 'git-operation': string; 'unread-runners': readonly string[] }
  }
}
