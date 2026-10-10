import type { TddStats } from '../types'
import type { GuardConfig } from './config'

/**
 * One session's record, left on this machine when the session ends: the counts
 * and the receipt, so nothing a session learned is thrown away. It lives under
 * the user's home, never in the repository, one file per session so no two
 * sessions ever write the same file.
 */
export type SessionRecord = {
  sessionId: string
  endedAt: string
  reason: string
  repo: string
  root: string
  mode: GuardConfig['mode']
  stack: GuardConfig['stack']
  layout: string
  runs: number
  cycles: number
  neverSawRed: number
  testFirst: number
  blocked: number
  unguarded: number
  caught: number
  proven: number
  missed: number
  unverified: number
  refactors: number
  workarounds: number
  /** Milliseconds spent in catch checks, baselines included. */
  checkMs: number
  /** Catch checks that ran in a worktree, never in the user's files. */
  worktreeChecks: number
  receipt: string
}

export type SessionMeta = { sessionId: string; reason: string; root: string; endedAtMs: number }

export function sessionRecord(s: TddStats, config: GuardConfig, meta: SessionMeta, receipt: string): SessionRecord {
  const root = meta.root.replace(/\\/g, '/').replace(/\/$/, '')
  return {
    sessionId: meta.sessionId,
    endedAt: new Date(meta.endedAtMs).toISOString(),
    reason: meta.reason,
    repo: root.slice(root.lastIndexOf('/') + 1),
    root,
    mode: config.mode,
    stack: config.stack,
    layout: config.layout.name,
    runs: s.passes + s.fails,
    cycles: s.cycles,
    neverSawRed: s.neverSawRed,
    testFirst: s.testFirst,
    blocked: s.blocked,
    unguarded: s.unguarded,
    caught: s.caught,
    proven: s.proven,
    missed: s.missed,
    unverified: s.unverified,
    refactors: s.refactors,
    workarounds: s.workarounds,
    checkMs: s.checkMsTotal,
    worktreeChecks: s.worktreeChecks,
    receipt,
  }
}

/** `<home>/.dope-tdd/sessions/<yyyy-mm-dd>-<session id>.json`; the date sorts them, the id keeps them apart. */
export function sessionLogPath(home: string, endedAtMs: number, sessionId: string): string {
  const day = new Date(endedAtMs).toISOString().slice(0, 10)
  const safe = sessionId.replace(/[^\w.-]/g, '_')
  return `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/sessions/${day}-${safe}.json`
}
