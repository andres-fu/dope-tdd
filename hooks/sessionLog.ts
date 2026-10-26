import type { RunTime, TddStats } from '../types'
import type { GuardConfig } from './config.ts'

/**
 * One session's record, left on this machine when the session ends: the counts
 * and the receipt, so nothing a session learned is thrown away. It lives under
 * the user's home, never in the repository, one file per session so no two
 * sessions ever write the same file.
 */
export type SessionRecord = {
  build?: string
  sessionId: string
  endedAt: string
  reason: string
  repo: string
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
  /** One row per timed one-file run (idea 17): the rows a dashboard would query (running tab, observability). */
  runTimes: RunTime[]
  receipt: string
}

/**
 * `build`: which dope-tdd guarded the session (build.ts), so a receipt says which rules applied. `gitDir`: the
 * checkout's git directory, which in a linked worktree names the main checkout.
 */
export type SessionMeta = { sessionId: string; reason: string; root: string; endedAtMs: number; build?: string; gitDir?: string | null }

/** The repository's folder name: a linked worktree's git dir is `<main>/.git/worktrees/<name>`, so it names `<main>` (debt `log`). */
function repoName(root: string, gitDir: string | null | undefined): string {
  const main = gitDir?.replace(/\\/g, '/').match(/^(.*)\/\.git\/worktrees\/[^/]+\/?$/)?.[1]
  const folder = main ?? root
  return folder.slice(folder.lastIndexOf('/') + 1)
}

export function sessionRecord(s: TddStats, config: GuardConfig, meta: SessionMeta, receipt: string): SessionRecord {
  const root = meta.root.replace(/\\/g, '/').replace(/\/$/, '')
  return {
    ...(meta.build === undefined ? {} : { build: meta.build }),
    sessionId: meta.sessionId,
    endedAt: new Date(meta.endedAtMs).toISOString(),
    reason: meta.reason,
    repo: repoName(root, meta.gitDir),
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
    runTimes: s.runTimes,
    receipt,
  }
}

/** `<home>/.dope-tdd/sessions/<yyyy-mm-dd>-<session id>.json`; the date sorts them, the id keeps them apart. */
export function sessionLogPath(home: string, endedAtMs: number, sessionId: string): string {
  const day = new Date(endedAtMs).toISOString().slice(0, 10)
  const safe = sessionId.replace(/[^\w.-]/g, '_')
  return `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/sessions/${day}-${safe}.json`
}
