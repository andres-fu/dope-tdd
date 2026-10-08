export type Phase = 'idle' | 'writing' | 'red' | 'green'
export type RunOutcome = 'pass' | 'fail'
export type EventKind =
  | 'touched'
  | 'edited'
  | 'unguarded'
  | 'blocked'
  | 'pass'
  | 'fail'
  | 'paused'
  | 'resumed'
  | 'caught'
  | 'missed'
  | 'unverified'
  | 'refactor'

export type CatchOutcome = { kind: 'caught' } | { kind: 'missed' } | { kind: 'unverified'; reason: string }

export type ChangeKind = 'fix' | 'refactor'

export type CycleChange = { path: string; before: string | null; after: string; kind: ChangeKind }

export type CycleVerdict = { module: string; sawRed: boolean }

export type CurrentTest = {
  module: string
  testPath: string
}

export type TddEvent = {
  atMs: number
  kind: EventKind
  module?: string
}

export type TddStats = {
  phase: Phase
  paused: boolean
  passes: number
  fails: number
  history: readonly RunOutcome[]
  cycles: number
  cycleMsTotal: number
  cycleStartMs: number | null
  sawRed: boolean
  neverSawRed: number
  unproven: readonly string[]
  testFirst: number
  unguarded: number
  blocked: number
  unlocked: Readonly<Record<string, string>>
  inherited: Readonly<Record<string, number>>
  reminded: readonly string[]
  changes: Readonly<Record<string, CycleChange>>
  checking: boolean
  caught: number
  missed: number
  unverified: number
  refactors: number
  lastCatch: { module: string; outcome: CatchOutcome | { kind: 'refactor' } } | null
  lastCycle: CycleVerdict | null
  current: CurrentTest | null
  events: readonly TddEvent[]
  lastEventMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'red-first': { stats: TddStats; tick: number }
  }
}
