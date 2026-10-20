// Override with a reason (the standard, "Guardrails, not walls"; v1, 2026-10-18). Every guardrail can be passed, never
// silently: a request names its scope, kind, reason and what ends it, and no agent approves its own exception. In v1
// the approver is the person (a reviewer model is the next step). The record is a file in the repo, so who approved
// what shows in the pull request's diff. Pure: register.tsx reads and writes the file and asks the person.
import type { Decider, Override, OverrideRequest, OverrideStatus } from '../types'

export const OVERRIDES_FILE = 'dope-tdd.overrides.json'

export const KINDS = ['spike', 'hotfix', 'generated', 'legacy', 'other'] as const
export const SCOPES = ['change', 'module', 'pause'] as const
export type { Decider, Override, OverrideKind, OverrideRequest, OverrideScope, OverrideStatus } from '../types'

export type OverrideLimits = { pauseMaxMinutes: number }

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const AGED_MS = 7 * DAY
const MIN_REASON = 30
// Phrases that say only that the guard was in the way. A reason says what, why and what happens next.
const EMPTY_PHRASES = ['needed to proceed', 'need to proceed', 'to unblock myself', 'the guard is blocking', 'tdd is in the way']

/** Why a request is refused before anyone is asked, or null when it is complete. Checks form only; the approver judges the rest. */
export function checkRequest(request: OverrideRequest, limits: OverrideLimits): string | null {
  if (!(KINDS as readonly string[]).includes(request.kind)) {
    return `kind must be one of: ${KINDS.join(', ')}`
  }
  if (!(SCOPES as readonly string[]).includes(request.scope)) {
    return `scope must be one of: ${SCOPES.join(', ')}`
  }
  if (request.scope === 'pause') {
    if (limits.pauseMaxMinutes <= 0) {
      return 'pause is turned off for this repo (dope-tdd.json)'
    }
    if (request.minutes === null || !Number.isInteger(request.minutes) || request.minutes < 1) {
      return 'a pause needs minutes: how long, as a whole number'
    }
    if (request.minutes > limits.pauseMaxMinutes) {
      return `a pause is at most ${limits.pauseMaxMinutes} minutes`
    }
  } else if (request.module === null || request.module === '') {
    return 'a change or module override names the file it is for'
  }
  if (request.scope === 'module' && (request.until === null || request.until.trim() === '')) {
    return 'a module override needs "until": what ends it'
  }
  const reason = request.reason.trim()
  const empty = EMPTY_PHRASES.find(phrase => reason.toLowerCase().includes(phrase))
  if (empty !== undefined) {
    return `"${empty}" is not a reason: say what, why and what happens next`
  }
  if (reason.length < MIN_REASON) {
    return 'the reason must say what, why and what happens next'
  }
  return null
}

/**
 * Who decides, at the moment of asking. A person asking is the approver. An agent waits for a person, and with nobody
 * there it is denied: it stops and reports rather than approving itself. A hotfix waits too: it once passed by rule,
 * so an agent approved itself, a pause of the whole guard included, by choosing the word (verified review A5,
 * 2026-10-20). An agent's approval never counts as a person's. "hotfix rule" stays a Decider for older records.
 */
export function decideAtRequest(request: OverrideRequest, attended: boolean): { status: OverrideStatus; decidedBy: Decider | null } {
  if (request.by === 'human') {
    return { status: 'approved', decidedBy: 'human' }
  }
  return attended ? { status: 'pending', decidedBy: null } : { status: 'denied', decidedBy: 'unattended' }
}

function isOpen(o: Override): boolean {
  return o.status === 'approved' && o.endedAtMs === null
}

/** The hard part of the rising bar: one request waits at a time, and an override left open past a week blocks the next. */
export function refuseByBar(record: readonly Override[], _request: OverrideRequest, nowMs: number): string | null {
  if (record.some(o => o.status === 'pending')) {
    return 'another override request is already waiting for a decision'
  }
  const aged = record.find(o => isOpen(o) && o.scope === 'module' && nowMs - o.atMs > AGED_MS)
  if (aged !== undefined) {
    const days = Math.floor((nowMs - aged.atMs) / DAY)
    return `an override on ${aged.module} has been open ${days} days: end it (/tdd override end ${aged.module}) before asking for another`
  }
  return null
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** The soft part: what the approver is told about this request's history, so a repeat is seen as one. */
export function requestNotes(record: readonly Override[], request: OverrideRequest, nowMs: number): string[] {
  const sameModule = request.module === null ? 0 : record.filter(o => o.module === request.module && nowMs - o.atMs < 7 * DAY).length
  const lastDay = record.filter(o => nowMs - o.atMs < DAY).length
  return [
    ...(sameModule > 0 ? [`${ordinal(sameModule + 1)} override request on ${request.module} this week`] : []),
    ...(lastDay > 0 ? [`${ordinal(lastDay + 1)} override request in the last day`] : []),
  ]
}

/**
 * The override that lets a locked edit to this module through now, or null. Only the session that asked may use it:
 * another agent in the same folder sees it on the band but cannot spend it (own your space, 2026-10-18).
 */
export function coveringOverride(record: readonly Override[], module: string, nowMs: number, session?: string): Override | null {
  return (
    record.find(o => {
      if (!isOpen(o) || (o.session !== undefined && session !== undefined && o.session !== session)) {
        return false
      }
      if (o.scope === 'pause') {
        return nowMs < o.atMs + (o.minutes ?? 0) * MINUTE
      }
      return o.module === module && (o.scope === 'module' || o.edits.length === 0)
    }) ?? null
  )
}

export function recordEdit(record: readonly Override[], id: string, path: string): Override[] {
  return record.map(o => (o.id === id ? { ...o, edits: [...o.edits, path] } : o))
}

/** Ends a module's open overrides, or with `pause`, ends and settles every pause. */
export function endOverride(record: readonly Override[], target: string, nowMs: number): Override[] {
  return record.map(o => {
    if (target === 'pause' && o.scope === 'pause' && o.status === 'approved') {
      return { ...o, endedAtMs: o.endedAtMs ?? nowMs, settledAtMs: o.settledAtMs ?? nowMs }
    }
    return o.module === target && o.status !== 'denied' && o.endedAtMs === null ? { ...o, endedAtMs: nowMs } : o
  })
}

/** Resuming early: open pauses stop letting edits through now; their untested edits stay debt until settled. */
export function closePauses(record: readonly Override[], nowMs: number): Override[] {
  return record.map(o => (isOpen(o) && o.scope === 'pause' ? { ...o, endedAtMs: nowMs } : o))
}

/**
 * Whether a person can answer a request now. `isInteractive` is false for every SDK host, the desktop app among them
 * (live trial, 2026-10-18), so a surface drawing the session counts too; a plain -p run has none.
 */
export function isAttended(isInteractive: boolean, surfaces: readonly string[]): boolean {
  return isInteractive || surfaces.length > 0
}

/** What an approved override still lets through now, for the band; null once it is spent, ended or out of time. */
export function overrideLeft(o: Override, nowMs: number): string | null {
  if (!isOpen(o)) {
    return null
  }
  if (o.scope === 'pause') {
    const leftMs = o.atMs + (o.minutes ?? 0) * MINUTE - nowMs
    return leftMs > 0 ? `${Math.ceil(leftMs / MINUTE)}m left` : null
  }
  if (o.scope === 'change') {
    return o.edits.length === 0 ? '1 edit left' : null
  }
  return `until ${o.until ?? 'it is ended'}`
}

/** For an /tdd override end that matched nothing: what is open, and how to end it. */
export function endHint(record: readonly Override[], nowMs: number): string {
  const open = record.filter(o => overrideLeft(o, nowMs) !== null)
  if (open.length === 0) {
    return 'Nothing is open.'
  }
  const listed = open.map(o => `${o.module ?? 'pause'} (${o.scope} · ${o.kind}, ${overrideLeft(o, nowMs)})`).join('; ')
  return `Open: ${listed}. End one with /tdd override end <module>, or /tdd override end pause.`
}

export function expiredPauses(record: readonly Override[], nowMs: number): Override[] {
  return record.filter(o => isOpen(o) && o.scope === 'pause' && nowMs >= o.atMs + (o.minutes ?? 0) * MINUTE)
}

export function pauseSummary(pause: Override): string {
  const head = `dope-tdd is back on after ${pause.minutes ?? 0}m (${pause.reason.trim()})`
  if (pause.edits.length === 0) {
    return `${head}: no edits while paused.`
  }
  const files = new Set(pause.edits).size
  const edits = `${pause.edits.length} edit${pause.edits.length === 1 ? '' : 's'}`
  return `${head}: ${edits} to ${files} file${files === 1 ? '' : 's'} while paused, none tested. Pin them with /dope-tdd:pin.`
}

/** What the receipt keeps showing until someone deals with it: open module overrides, hotfixes, and paused edits. */
export function openDebt(record: readonly Override[]): Override[] {
  return record.filter(o => {
    if (o.status !== 'approved') {
      return false
    }
    if (o.scope === 'pause') {
      return o.edits.length > 0 && o.settledAtMs === null
    }
    return o.endedAtMs === null && (o.scope === 'module' || o.kind === 'hotfix')
  })
}

function isOverride(value: unknown): value is Override {
  const o = value as Partial<Override> | null
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.id === 'string' &&
    typeof o.atMs === 'number' &&
    typeof o.reason === 'string' &&
    (KINDS as readonly string[]).includes(o.kind ?? '') &&
    (SCOPES as readonly string[]).includes(o.scope ?? '') &&
    ['pending', 'approved', 'denied'].includes(o.status ?? '')
  )
}

/** A missing or broken file reads as no overrides: the record is evidence, and a broken one is not trusted. */
export function parseRecord(text: string | null): Override[] {
  if (text === null) {
    return []
  }
  try {
    const parsed = JSON.parse(text) as { overrides?: unknown }
    const list = Array.isArray(parsed.overrides) ? parsed.overrides : []
    return list.filter(isOverride).map(o => ({ ...o, settledAtMs: o.settledAtMs ?? null, edits: Array.isArray(o.edits) ? o.edits : [] }))
  } catch {
    return []
  }
}

export function serializeRecord(record: readonly Override[]): string {
  return `${JSON.stringify({ overrides: record }, null, 2)}\n`
}

/** A model's decision names the model and its effort, so it never reads as a person's sign-off. */
export function deciderLabel(o: Override): string {
  if (o.decidedBy === 'model' && o.review !== undefined) {
    return `model ${o.review.model} (${o.review.effort})`
  }
  return o.decidedBy ?? 'unknown'
}

// One "key: value" row per override, so the app can show /tdd as a table (2026-10-18).
function lineFor(o: Override): string {
  const head = `override ${o.module ?? 'pause'}: ${o.scope} · ${o.kind}`
  if (o.status === 'pending') {
    return `${head} · waiting for a person`
  }
  if (o.status === 'denied') {
    return `${head} · denied by ${deciderLabel(o)}${o.note === null ? '' : `: ${o.note}`}`
  }
  const why = o.decidedBy === 'model' && o.review !== undefined && o.review.reason !== '' ? `: ${o.review.reason}` : ''
  const state =
    o.scope === 'pause'
      ? o.edits.length > 0 && o.settledAtMs === null
        ? `DEBT: ${o.edits.length} edit${o.edits.length === 1 ? '' : 's'} untested`
        : null
      : o.endedAtMs !== null
        ? 'ENDED'
        : o.kind === 'hotfix'
          ? 'DEBT: no test yet'
          : o.scope === 'module'
            ? 'OPEN'
            : null
  const parts = [
    `approved by ${deciderLabel(o)}${why}`,
    ...(o.until === null ? [] : [`until ${o.until}`]),
    ...(o.scope === 'pause' ? [`${o.minutes ?? 0}m`] : []),
    ...(state === null ? [] : [state]),
  ]
  return `${head} · ${parts.join(' · ')}`
}

/** For /tdd and the receipt: the rate per cycle first, so 2 in 40 reads differently from 2 in 3. */
export function formatOverrides(record: readonly Override[], cycles: number): string[] {
  if (record.length === 0) {
    return []
  }
  const approved = record.filter(o => o.status === 'approved').length
  const denied = record.filter(o => o.status === 'denied').length
  const waiting = record.filter(o => o.status === 'pending').length
  const header = [
    `overrides: ${approved} approved in ${cycles} cycles`,
    ...(denied > 0 ? [`${denied} denied`] : []),
    ...(waiting > 0 ? [`${waiting} waiting`] : []),
  ].join(' · ')
  return [header, ...record.map(lineFor)]
}
