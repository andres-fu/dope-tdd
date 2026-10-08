export type Phase = 'idle' | 'writing' | 'red' | 'green'
export type Layer = 'frontend' | 'backend' | 'logic'
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
  current: CurrentTest | null
  events: readonly TddEvent[]
  lastEventMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'red-first': { stats: TddStats; tick: number }
  }
}
