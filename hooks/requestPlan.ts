// The override decisions (#59, 2026-10-18): out of register.tsx, so the gate's own catch check covers them. Given the
// request, the record and what the shell found out (whether a person is there, the model's review, this session),
// it says what to record, what to tell the person, and what to answer the agent. register.tsx reads and writes the
// record, asks the model, and shows the notices.
import type { Override, OverrideKind, OverrideRequest, OverrideScope, Review } from '../types'
import { OVERRIDES_FILE, checkRequest, decideAtRequest, refuseByBar, requestNotes } from './overrides.ts'
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

/** A hotfix and a person's own request never go to the model: the first is recovery, the second is the approver. */
export function sendsToModel(request: OverrideRequest, approver: 'human' | 'model'): boolean {
  return approver === 'model' && request.by === 'agent' && request.kind !== 'hotfix'
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
  if (entry.decidedBy === 'hotfix rule') {
    return {
      entry,
      pause,
      notices: [
        ...(pause ? [{ toast: true, text: `TDD guard paused for ${request.minutes ?? 0}m` }] : []),
        { toast: true, text: `⚑ dope-tdd: hotfix override on ${label}: "${reason}". Recorded as debt until a test is written.` },
      ],
      reply: `dope-tdd: override approved (hotfix rule): ${request.scope} on ${label}. It is debt in ${OVERRIDES_FILE} until a test is written; end it with /tdd override end ${request.module ?? 'pause'} once one is.`,
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
