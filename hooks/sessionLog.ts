import type { RunTime, Spike, StuckSpell, TddStats } from '../types'
import type { GuardConfig } from './config.ts'
import { redModules } from './leftRed.ts'
import type { LeftRed } from './leftRed.ts'

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
  /** One row per stuck spell (idea 16): the same failure on one module, STUCK_RUNS runs or more in a row. */
  stuck: StuckSpell[]
  /** The modules still red when the session ended (idea 15): the next session's briefing starts from them. */
  leftRed: LeftRed[]
  /** One row per spike (idea 19): when the spike skill ran, and its question. */
  spikes: Spike[]
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
    stuck: s.stuck,
    leftRed: redModules(s, meta.endedAtMs),
    spikes: s.spikes,
    receipt,
  }
}

/** `<home>/.dope-tdd/sessions/<yyyy-mm-dd>-<session id>.json`; the date sorts them, the id keeps them apart. */
export function sessionLogPath(home: string, endedAtMs: number, sessionId: string): string {
  const day = new Date(endedAtMs).toISOString().slice(0, 10)
  const safe = sessionId.replace(/[^\w.-]/g, '_')
  return `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/sessions/${day}-${safe}.json`
}

/** One file in the sessions folder, as `$.fs.list` gives it. */
export type RecordEntry = { name: string; size: number; mtimeMs: number }

/**
 * Records that existed before a shell command and changed while it ran (2026-10-26, integrity). Only dope-tdd writes
 * them, and only when a session ends, so such a change is an edit by the command. A new record is another session
 * ending, and a removed one is the 30-day cleanup a session start runs; neither is named.
 */
export function changedRecords(before: readonly RecordEntry[], after: readonly RecordEntry[]): string[] {
  const was = new Map(before.map(entry => [entry.name, entry]))
  return after.filter(entry => {
    const old = was.get(entry.name)
    return old !== undefined && (old.size !== entry.size || old.mtimeMs !== entry.mtimeMs)
  }).map(entry => entry.name)
}

/** Keys sorted at every level, so the digest is the same whatever the order or spacing of the file. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** cyrb53, a fast 53-bit string hash: enough to show an edit, and deliberately not called a signature. */
function cyrb53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

function digestOf(record: object): string {
  const { digest: _digest, ...rest } = record as Record<string, unknown>
  return `cyrb53:${cyrb53(canonical(rest))}`
}

/**
 * The record with a digest of its own content (2026-10-26). It shows a hand edit; it cannot stop an agent that reads
 * this code from recomputing it, and no local key could, since the agent can read any file the plugin can. What an
 * agent cannot write is the pull-request check in CI, which is where proof lives.
 */
export function sealRecord<T extends object>(record: T): T & { digest: string } {
  return { ...record, digest: digestOf(record) }
}

/** `sealed`: the digest matches. `edited`: it does not, or the text is no record. `unsealed`: written before digests. */
export function verifyRecord(text: string): 'sealed' | 'edited' | 'unsealed' {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'edited'
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'edited'
  }
  const digest = (parsed as Record<string, unknown>).digest
  if (digest === undefined) {
    return 'unsealed'
  }
  return digest === digestOf(parsed) ? 'sealed' : 'edited'
}
