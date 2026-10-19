export type Phase = 'idle' | 'writing' | 'red' | 'green'
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
  /** The override record changed outside dope-tdd and was put back (override v1, 2026-10-18). */
  | 'record-edited'
  /** #54: an edit refused because a carried-over unlock waits for one run of its test this session. */
  | 'needs-run'
  /** #54: that run happened; the carried-over unlock is active. */
  | 'carried-on'
  /** #54: a carried-over unlock dropped at session start because its test changed since. */
  | 'stale-unlock'
  /** A person reset the session's counts with /tdd reset: on the record, never silent (band v3, 2026-10-18). */
  | 'reset'
  /** #89: a problem found in another project, reported to its owner and never fixed from here. */
  | 'reported-elsewhere'
  /** The pin skill ran this session (pin corrected, 2026-10-18). */
  | 'pinning'
  /** A pin fixed after its red, code unchanged, with the pin skill in use: not a workaround. */
  | 'pin-corrected'

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

export type CycleVerdict = { module: string; sawRed: boolean; testChanged: boolean; pinCorrected?: boolean }

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
  cycles: number
  cycleMsTotal: number
  cycleStartMs: number | null
  sawRed: boolean
  redElsewhere: readonly string[]
  testChangedAfterRed: boolean
  neverSawRed: number
  testChanged: number
  /** The pin skill ran this session: a test changed after red then reads as a pin correction (2026-10-18). */
  pinning: boolean
  pinsCorrected: number
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
  /** Code files edited this session that the layout pairs with no test, newest last, at most 20: what it is not watching. */
  unwatched: readonly string[]
  lastCatch: { module: string; outcome: CatchOutcome | { kind: 'refactor' }; path?: string } | null
  lastCycle: CycleVerdict | null
  current: CurrentTest | null
  events: readonly TddEvent[]
  lastEventMs: number | null
  /** The last test run, read or not (2026-10-18): the one fact the band's "last run" line renders. */
  lastRun: LastRun | null
}

/** `module`: the module the run was about (the current one, or another's own test); `files`: for elsewhere, what failed. */
export type LastRun = { module: string | null; outcome: 'pass' | 'fail' | 'elsewhere' | 'unread'; files: string[]; atMs: number }

export type OverrideKind = 'spike' | 'hotfix' | 'generated' | 'legacy' | 'other'
/** `change`: one edit. `module`: until a condition the request names. `pause`: every module, for some minutes. */
export type OverrideScope = 'change' | 'module' | 'pause'
export type OverrideStatus = 'pending' | 'approved' | 'denied'
/** A role, never a name: the record goes into the repo. */
export type Decider = 'human' | 'hotfix rule' | 'unattended' | 'model'

export type Verdict = 'approve' | 'deny' | 'escalate'
/** What the reviewer model said, kept with the override so a person can second-guess it: never a human sign-off. */
export type Review = { model: string; effort: string; verdict: Verdict; reason: string }

export type OverrideRequest = {
  by: 'agent' | 'human'
  scope: OverrideScope
  kind: OverrideKind
  /** The module id, for change and module scope; null for a pause. */
  module: string | null
  path: string | null
  reason: string
  until: string | null
  minutes: number | null
}

export type Override = OverrideRequest & {
  id: string
  atMs: number
  status: OverrideStatus
  decidedBy: Decider | null
  decidedAtMs: number | null
  /** When it stopped letting edits through: ended by a person, or a pause whose minutes ran out. */
  endedAtMs: number | null
  /** A pause's untested edits stay debt after the pause is over, until a person settles them. */
  settledAtMs: number | null
  /** Why it was denied, when it was. */
  note: string | null
  /** Files edited under it, relative to the root. */
  edits: string[]
  /** The reviewer model's answer, when the repo's approver is a model. */
  review?: Review
  /** The session that asked: only it may use the override (own your space). Absent on records from before. */
  session?: string
}

declare module 'claude-code' {
  interface PluginState {
    'dope-tdd': {
      stats: TddStats
      tick: number
      'bash-cwd': string
      'powershell-cwd': string
      'git-operation': string
      'unread-runners': readonly string[]
      /** Which dope-tdd is running (build.ts), read once at session start. */
      build: string
      /** The repo's override record, as last read from or written to dope-tdd.overrides.json. */
      overrides: readonly Override[]
      /** Whether a person is there to approve a request: from session.start. */
      attended: boolean
      /** This session's id, read once at session start for the band; '' until read. */
      'session-id': string
      /** Whether the current module's work is committed or pushed (bandModel.ts, Saved); '' module before git is asked. */
      saved: { module: string; state: 'uncommitted' | 'committed' | 'pushed' }
    }
  }
}
