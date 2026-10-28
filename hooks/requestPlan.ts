// The override decisions (#59, 2026-10-18): out of register.tsx, so the gate's own catch check covers them. Given the
// request, the record and what the shell found out (whether a person is there, the model's review, this session),
// it says what to record, what to tell the person, and what to answer the agent. register.tsx reads and writes the
// record, asks the model, and shows the notices.
import type { Override, OverrideKind, OverrideRequest, OverrideScope, Review } from '../types'
import {
  OVERRIDES_FILE,
  checkRequest,
  closePauses,
  coveringOverride,
  decideAtRequest,
  endHint,
  endOverride,
  expiredPauses,
  pauseSummary,
  recordEdit,
  refuseByBar,
  requestNotes,
} from './overrides.ts'
import type { OverrideLimits } from './overrides.ts'
import { decideAfterReview } from './reviewer.ts'

/** `toast`: shown to the person as well as logged. */
export type Notice = { toast: boolean; text: string }
export type RequestPlan = { entry: Override; notices: Notice[]; reply: string; pause: boolean }

function textOf(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' ? value : null
}

/** The request a tool input or /tdd pause makes; `target` is the module and path its file resolved to, if any. */
export function requestFrom(input: Record<string, unknown>, by: 'agent' | 'human', target: { module: string | null; path: string | null }): OverrideRequest {
  const scope = (textOf(input, 'scope') ?? '') as OverrideScope
  const pause = scope === 'pause'
  return {
    by,
    scope,
    kind: (textOf(input, 'kind') ?? '') as OverrideKind,
    module: pause ? null : target.module,
    path: pause ? null : target.path,
    reason: textOf(input, 'reason') ?? '',
    until: textOf(input, 'until'),
    minutes: typeof input.minutes === 'number' ? input.minutes : null,
  }
}

/** Why the request is refused before anyone is asked: an incomplete form, or the rising bar. Null when it may go on. */
export function refusal(request: OverrideRequest, record: readonly Override[], nowMs: number, limits: OverrideLimits): string | null {
  const why = checkRequest(request, limits) ?? refuseByBar(record, request, nowMs)
  return why === null ? null : `dope-tdd: override refused: ${why}.`
}

/**
 * A hotfix, a pause and a person's own request never go to the model: the first is recovery, the last is the approver.
 * A pause switches off every module at once (#194), so an agent's pause waits for a person, or is denied when nobody
 * is there, like any request the model does not see.
 */
export function sendsToModel(request: OverrideRequest, approver: 'human' | 'model'): boolean {
  return approver === 'model' && request.by === 'agent' && request.kind !== 'hotfix' && request.scope !== 'pause'
}

export function planRequest(args: {
  request: OverrideRequest
  record: readonly Override[]
  nowMs: number
  present: boolean
  labelOf: (module: string | null) => string
  review?: Review
  session?: string
}): RequestPlan {
  const { request, record, nowMs, present, review, session } = args
  const decision = review === undefined ? decideAtRequest(request, present) : decideAfterReview(review.verdict, present)
  const entry: Override = {
    ...request,
    ...(session === undefined ? {} : { session }),
    id: `o${nowMs.toString(36)}-${record.length + 1}`,
    atMs: nowMs,
    status: decision.status,
    decidedBy: decision.decidedBy,
    decidedAtMs: decision.status === 'pending' ? null : nowMs,
    endedAtMs: null,
    settledAtMs: null,
    note: review !== undefined && decision.decidedBy === 'model' && decision.status === 'denied' ? review.reason : null,
    edits: [],
    ...(review === undefined ? {} : { review }),
  }
  const label = args.labelOf(request.module)
  const reason = request.reason.trim()
  const pause = entry.status === 'approved' && entry.scope === 'pause'

  if (entry.decidedBy === 'model' && review !== undefined) {
    const byModel = `model ${review.model} (${review.effort})`
    const approved = entry.status === 'approved'
    return {
      entry,
      pause,
      notices: [{ toast: true, text: `⚑ dope-tdd: override ${approved ? 'approved' : 'denied'} by ${byModel} for ${request.kind} on ${label}: "${reason}". ${review.reason}` }],
      reply: approved
        ? `dope-tdd: override approved by ${byModel}: ${review.reason} ${request.scope} on ${label}, recorded in ${OVERRIDES_FILE}.`
        : `dope-tdd: override denied by ${byModel}: ${review.reason} Do that instead; do not work around the guard.`,
    }
  }
  if (entry.status === 'pending') {
    const notes = requestNotes(record, request, nowMs)
    const history = notes.length === 0 ? '' : ` (${notes.join('; ')})`
    const escalated = review === undefined ? '' : ` (the reviewer model escalated: ${review.reason})`
    return {
      entry,
      pause,
      notices: [{ toast: true, text: `⚑ dope-tdd: override needs you. ${request.kind} on ${label}: "${reason}"${history}${escalated}. /tdd approve, or /tdd deny <why>` }],
      reply:
        'dope-tdd: override requested; waiting for a person to approve it. Stop here: tell the user what you asked for and why, and wait for their answer. Do not retry or work around the guard.',
    }
  }
  if (entry.status === 'denied') {
    return {
      entry,
      pause,
      notices: [{ toast: false, text: `dope-tdd: override denied, nobody is here to approve it: ${request.kind} on ${label}: "${reason}"` }],
      reply: 'dope-tdd: override denied: nobody is here to approve it. Stop and report what you needed and why; do not work around the guard.',
    }
  }
  return {
    entry,
    pause,
    notices: pause ? [{ toast: true, text: `TDD guard paused for ${request.minutes ?? 0}m` }] : [],
    reply: pause
      ? `dope-tdd is paused for ${request.minutes ?? 0} minutes (${reason}). It comes back on by itself; /tdd resume ends it sooner. The pause is on the record.`
      : `dope-tdd: override approved: ${request.scope} on ${label}, recorded in ${OVERRIDES_FILE}.`,
  }
}

/** A person's decision on the waiting request: the record with it decided, the reply, and whether it pauses now. */
export function planDecision(
  record: readonly Override[],
  approve: boolean,
  why: string | null,
  nowMs: number,
  labelOf: (module: string | null) => string,
): { record: Override[]; reply: string; pause: boolean } {
  const pending = record.find(o => o.status === 'pending')
  if (pending === undefined) {
    return { record: [...record], reply: 'dope-tdd: no override request is waiting.', pause: false }
  }
  const decided: Override = { ...pending, status: approve ? 'approved' : 'denied', decidedBy: 'human', decidedAtMs: nowMs, note: approve ? null : why }
  return {
    record: record.map(o => (o.id === pending.id ? decided : o)),
    reply: approve
      ? `dope-tdd: override approved: ${decided.scope} on ${labelOf(decided.module)}. Tell the agent to go on.`
      : `dope-tdd: override denied${why === null ? '' : `: ${why}`}. Tell the agent what to do instead.`,
    pause: approve && decided.scope === 'pause',
  }
}

// The override lifecycle (#59, second slice): what the record becomes, and what is said, when a pause runs out, a person
// resumes or ends one, or a shell write spends one. `resume` asks the shell to turn the guard back on.
const MINUTE = 60_000

/** Pauses whose minutes ran out end at their own end time, and each says what happened while it was on. */
export function planExpiry(record: readonly Override[], nowMs: number): { record: Override[]; resume: boolean; summaries: string[] } {
  const expired = expiredPauses(record, nowMs)
  if (expired.length === 0) {
    return { record: [...record], resume: false, summaries: [] }
  }
  const ids = new Set(expired.map(pause => pause.id))
  return {
    record: record.map(o => (ids.has(o.id) ? { ...o, endedAtMs: o.atMs + (o.minutes ?? 0) * MINUTE } : o)),
    resume: true,
    summaries: expired.map(pauseSummary),
  }
}

/** /tdd resume: open pauses close now; a guard paused with none on record (from before) resumes all the same. */
export function planResume(record: readonly Override[], paused: boolean, nowMs: number): { record: Override[]; resume: boolean; reply: string } {
  const open = record.filter(o => o.status === 'approved' && o.scope === 'pause' && o.endedAtMs === null)
  if (open.length === 0 && !paused) {
    return { record: [...record], resume: false, reply: 'dope-tdd is already on.' }
  }
  // Said as the time it actually ran, not the time it was asked for.
  const summaries = open.map(pause => pauseSummary({ ...pause, minutes: Math.max(1, Math.round((nowMs - pause.atMs) / MINUTE)) }))
  return {
    record: open.length === 0 ? [...record] : closePauses(record, nowMs),
    resume: true,
    reply: ['dope-tdd is on: an edit to untested source is refused until its test is written.', ...summaries].join('\n'),
  }
}

/** /tdd override end <module|pause>: a miss lists what is open; ending the pause resumes the guard. */
export function planEnd(record: readonly Override[], target: string | undefined, nowMs: number): { record: Override[]; resume: boolean; reply: string } {
  if (target === undefined || target === '') {
    return { record: [...record], resume: false, reply: 'Name what to end: /tdd override end <module>, or /tdd override end pause.' }
  }
  const ended = endOverride(record, target, nowMs)
  if (ended.every((o, index) => o === record[index])) {
    return { record: [...record], resume: false, reply: `No open override on ${target}. ${endHint(record, nowMs)}` }
  }
  return { record: ended, resume: target === 'pause', reply: `dope-tdd: ended the override on ${target}; the guard is back on it.` }
}

/** Locked modules a shell command writes: one this session's override covers passes and is counted on it. */
export function planShellCover(
  record: readonly Override[],
  locked: readonly string[],
  writes: readonly { path: string; module: string | null }[],
  nowMs: number,
  session: string | undefined,
): { record: Override[]; stillLocked: string[] } {
  let next = [...record]
  const stillLocked: string[] = []
  for (const module of locked) {
    const covering = coveringOverride(next, module, nowMs, session)
    const path = writes.find(write => write.module === module)?.path
    if (covering === null || path === undefined) {
      stillLocked.push(module)
    } else {
      next = recordEdit(next, covering.id, path)
    }
  }
  return { record: next, stillLocked }
}
