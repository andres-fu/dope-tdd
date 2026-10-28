import { describe, expect, test } from 'claude-code/testing'

import { planDecision, planEnd, planExpiry, planRequest, planResume, planShellCover, refusal, requestFrom, sendsToModel } from '../hooks/requestPlan'
import type { Override, OverrideRequest, Review } from '../types'

// #59: the override decisions, out of register.tsx and under the gate's own catch check (2026-10-18).
const T0 = 1_000_000_000
const REASON = 'trying two parsers for the run summary to see which handles Windows output; the loser is deleted'
const labelOf = (module: string | null) => module ?? 'every module'

const ask = (over: Partial<OverrideRequest> = {}): OverrideRequest => ({
  by: 'agent',
  scope: 'change',
  kind: 'spike',
  module: 'runPlan',
  path: 'hooks/runPlan.ts',
  reason: REASON,
  until: null,
  minutes: null,
  ...over,
})

const plan = (over: Partial<Parameters<typeof planRequest>[0]> = {}) =>
  planRequest({ request: ask(), record: [], nowMs: T0, present: true, labelOf, ...over })

const review = (verdict: Review['verdict'], reason: string): Review => ({ model: 'claude-sonnet-5-5', effort: 'high', verdict, reason })

describe('requestFrom: the request a tool input or a /tdd pause makes', () => {
  test('a change or module request names its module and path', () => {
    expect(requestFrom({ scope: 'module', kind: 'spike', reason: REASON, until: 'the spike PR closes' }, 'agent', { module: 'runPlan', path: 'hooks/runPlan.ts' })).toEqual(
      ask({ scope: 'module', until: 'the spike PR closes' }),
    )
  })

  test('a pause names no module, and minutes must be a number', () => {
    expect(requestFrom({ scope: 'pause', kind: 'other', reason: REASON, minutes: 30 }, 'human', { module: 'x', path: 'x.ts' })).toEqual(
      ask({ by: 'human', scope: 'pause', kind: 'other', module: null, path: null, minutes: 30 }),
    )
    expect(requestFrom({ scope: 'pause', kind: 'other', reason: REASON, minutes: '30' }, 'human', { module: null, path: null }).minutes).toBeNull()
  })
})

describe('refusal: the form and the bar, before anyone is asked', () => {
  test('an incomplete request', () => {
    expect(refusal(ask({ reason: 'blocked' }), [], T0, { pauseMaxMinutes: 120 })).toBe('dope-tdd: override refused: the reason must say what, why and what happens next.')
  })

  test('one already waiting', () => {
    const waiting = plan().entry
    expect(refusal(ask(), [waiting], T0, { pauseMaxMinutes: 120 })).toBe('dope-tdd: override refused: another override request is already waiting for a decision.')
  })

  test('a complete first request', () => {
    expect(refusal(ask(), [], T0, { pauseMaxMinutes: 120 })).toBeNull()
  })
})

describe('sendsToModel: only an agent request, never a hotfix or a pause, and only when the repo opted in', () => {
  test('each case', () => {
    expect(sendsToModel(ask(), 'model')).toBe(true)
    expect(sendsToModel(ask({ scope: 'module' }), 'model')).toBe(true)
    expect(sendsToModel(ask({ kind: 'hotfix' }), 'model')).toBe(false)
    expect(sendsToModel(ask({ by: 'human' }), 'model')).toBe(false)
    expect(sendsToModel(ask(), 'human')).toBe(false)
  })

  // #194: an approved pause switches off every module, so an agent's pause request goes to a person, never the model.
  test("an agent's pause request never goes to the model", () => {
    expect(sendsToModel(ask({ scope: 'pause', module: null, path: null, minutes: 30 }), 'model')).toBe(false)
  })

  test('with nobody there, an agent pause that skipped the model is denied, not approved', () => {
    const { entry, pause } = plan({ request: ask({ scope: 'pause', module: null, path: null, minutes: 30 }), present: false })
    expect(entry).toMatchObject({ status: 'denied', decidedBy: 'unattended' })
    expect(pause).toBe(false)
  })
})

describe('planRequest: the decision, the record entry, and what is said', () => {
  test('an agent with a person there waits; the person is told, the agent told to stop', () => {
    const { entry, notices, reply, pause } = plan({ session: 'A' })
    expect(entry).toMatchObject({ status: 'pending', decidedBy: null, decidedAtMs: null, id: `o${T0.toString(36)}-1`, session: 'A' })
    expect(notices).toEqual([{ toast: true, text: `⚑ dope-tdd: override needs you. spike on runPlan: "${REASON}". /tdd approve, or /tdd deny <why>` }])
    expect(reply).toBe('dope-tdd: override requested; waiting for a person to approve it. Stop here: tell the user what you asked for and why, and wait for their answer. Do not retry or work around the guard.')
    expect(pause).toBe(false)
  })

  test('the history goes with the request to the person', () => {
    const earlier: Override = { ...plan().entry, status: 'denied', atMs: T0 - 60_000 }
    expect(plan({ record: [earlier] }).notices[0]?.text).toMatch(/\(2nd override request on runPlan this week; 2nd override request in the last day\)/)
  })

  test('with nobody there it is denied, logged, not toasted', () => {
    const { entry, notices, reply } = plan({ present: false })
    expect(entry).toMatchObject({ status: 'denied', decidedBy: 'unattended' })
    expect(notices).toEqual([{ toast: false, text: `dope-tdd: override denied, nobody is here to approve it: spike on runPlan: "${REASON}"` }])
    expect(reply).toBe('dope-tdd: override denied: nobody is here to approve it. Stop and report what you needed and why; do not work around the guard.')
  })

  test('a hotfix waits for a person like any request, and with nobody there it is denied (verified review A5)', () => {
    expect(plan({ request: ask({ kind: 'hotfix' }) }).entry).toMatchObject({ status: 'pending', decidedBy: null })
    expect(plan({ request: ask({ kind: 'hotfix' }), present: false }).entry).toMatchObject({ status: 'denied', decidedBy: 'unattended' })
  })

  test("a person's own pause pauses now", () => {
    const { entry, notices, reply, pause } = plan({ request: ask({ by: 'human', scope: 'pause', kind: 'other', module: null, path: null, minutes: 30 }) })
    expect(entry).toMatchObject({ status: 'approved', decidedBy: 'human' })
    expect(pause).toBe(true)
    expect(notices).toEqual([{ toast: true, text: 'TDD guard paused for 30m' }])
    expect(reply).toBe(`dope-tdd is paused for 30 minutes (${REASON}). It comes back on by itself; /tdd resume ends it sooner. The pause is on the record.`)
  })

  test("a model's approval is the model's, with its reason", () => {
    const { entry, notices, reply } = plan({ review: review('approve', 'Low risk.') })
    expect(entry).toMatchObject({ status: 'approved', decidedBy: 'model', note: null, review: review('approve', 'Low risk.') })
    expect(notices).toEqual([{ toast: true, text: `⚑ dope-tdd: override approved by model claude-sonnet-5-5 (high) for spike on runPlan: "${REASON}". Low risk.` }])
    expect(reply).toBe('dope-tdd: override approved by model claude-sonnet-5-5 (high): Low risk. change on runPlan, recorded in dope-tdd.overrides.json.')
  })

  test("a model's denial keeps its reason as the note", () => {
    const { entry, reply } = plan({ review: review('deny', 'Write the test first.') })
    expect(entry).toMatchObject({ status: 'denied', decidedBy: 'model', note: 'Write the test first.' })
    expect(reply).toBe('dope-tdd: override denied by model claude-sonnet-5-5 (high): Write the test first. Do that instead; do not work around the guard.')
  })

  test("a model's escalation waits for the person, with why", () => {
    const { entry, notices } = plan({ review: review('escalate', 'Payments code; a person should decide.') })
    expect(entry.status).toBe('pending')
    expect(notices[0]?.text).toMatch(/\(the reviewer model escalated: Payments code; a person should decide\.\)\. \/tdd approve/)
  })
})

describe('planDecision: a person decides the waiting request', () => {
  const waiting = plan().entry

  test('approve', () => {
    const decided = planDecision([waiting], true, null, T0 + 1, labelOf)
    expect(decided.record[0]).toMatchObject({ status: 'approved', decidedBy: 'human', decidedAtMs: T0 + 1, note: null })
    expect(decided.reply).toBe('dope-tdd: override approved: change on runPlan. Tell the agent to go on.')
    expect(decided.pause).toBe(false)
  })

  test('deny, with why', () => {
    const decided = planDecision([waiting], false, 'write the test first', T0 + 1, labelOf)
    expect(decided.record[0]).toMatchObject({ status: 'denied', decidedBy: 'human', note: 'write the test first' })
    expect(decided.reply).toBe('dope-tdd: override denied: write the test first. Tell the agent what to do instead.')
  })

  test('approving a waiting pause pauses', () => {
    const pause = plan({ request: ask({ scope: 'pause', kind: 'other', module: null, path: null, minutes: 30 }) }).entry
    expect(planDecision([pause], true, null, T0 + 1, labelOf).pause).toBe(true)
  })

  test('nothing waiting', () => {
    expect(planDecision([], true, null, T0, labelOf)).toEqual({ record: [], reply: 'dope-tdd: no override request is waiting.', pause: false })
  })
})

// #59, second slice: the override lifecycle (2026-10-18).
const MINUTE = 60_000
const PAUSE_REASON = 'pairing on the prod incident in #301 and back after'
const pauseEntry = (over: Partial<Override> = {}): Override => ({
  ...plan({ request: ask({ by: 'human', scope: 'pause', kind: 'other', module: null, path: null, minutes: 30, reason: PAUSE_REASON }) }).entry,
  ...over,
})
const approvedChange = (over: Partial<Override> = {}): Override => ({ ...plan({ request: ask({ kind: 'hotfix' }) }).entry, status: 'approved', decidedBy: 'human', decidedAtMs: T0, ...over })

describe('planExpiry: a pause whose minutes ran out', () => {
  test('ends at its own end time, resumes the guard, and says what happened while it was on', () => {
    const expired = planExpiry([pauseEntry({ edits: ['hooks/a.ts'] })], T0 + 31 * MINUTE)
    expect(expired.record[0]?.endedAtMs).toBe(T0 + 30 * MINUTE)
    expect(expired.resume).toBe(true)
    expect(expired.summaries).toEqual([`dope-tdd is back on after 30m (${PAUSE_REASON}): 1 edit to 1 file while paused, none tested. Pin them with /dope-tdd:pin.`])
  })

  test('nothing to do while it still runs', () => {
    expect(planExpiry([pauseEntry()], T0 + 29 * MINUTE)).toEqual({ record: [pauseEntry()], resume: false, summaries: [] })
  })
})

describe('planResume: /tdd resume ends a pause early', () => {
  test('closes it now and says how long it ran', () => {
    const resumed = planResume([pauseEntry()], true, T0 + 5 * MINUTE)
    expect(resumed.record[0]?.endedAtMs).toBe(T0 + 5 * MINUTE)
    expect(resumed.resume).toBe(true)
    expect(resumed.reply).toBe(
      `dope-tdd is on: an edit to untested source is refused until its test is written.\ndope-tdd is back on after 5m (${PAUSE_REASON}): no edits while paused.`,
    )
  })

  test('a guard paused with no pause on record (from before) is resumed all the same', () => {
    expect(planResume([], true, T0)).toEqual({
      record: [],
      resume: true,
      reply: 'dope-tdd is on: an edit to untested source is refused until its test is written.',
    })
  })

  test('nothing paused: already on', () => {
    expect(planResume([], false, T0)).toEqual({ record: [], resume: false, reply: 'dope-tdd is already on.' })
  })
})

describe('planEnd: /tdd override end <module|pause>', () => {
  test('ends the named module and says the guard is back', () => {
    const ended = planEnd([approvedChange()], 'runPlan', T0 + MINUTE)
    expect(ended.record[0]?.endedAtMs).toBe(T0 + MINUTE)
    expect(ended).toMatchObject({ resume: false, reply: 'dope-tdd: ended the override on runPlan; the guard is back on it.' })
  })

  test('ending the pause resumes the guard', () => {
    expect(planEnd([pauseEntry()], 'pause', T0 + MINUTE).resume).toBe(true)
  })

  test('a miss lists what is open; nothing named says how', () => {
    expect(planEnd([approvedChange({ scope: 'module', kind: 'spike', until: 'the spike PR closes', decidedBy: 'human' })], 'stats', T0).reply).toBe(
      'No open override on stats. Open: runPlan (module · spike, until the spike PR closes). End one with /tdd override end <module>, or /tdd override end pause.',
    )
    expect(planEnd([], undefined, T0).reply).toBe('Name what to end: /tdd override end <module>, or /tdd override end pause.')
  })
})

describe('planShellCover: a shell write to a locked module that an override covers', () => {
  test('passes and counts on the override; the rest stay locked', () => {
    const covered = planShellCover([approvedChange({ session: 'A' })], ['runPlan', 'stats'], [{ path: 'hooks/runPlan.ts', module: 'runPlan' }, { path: 'hooks/stats.ts', module: 'stats' }], T0, 'A')
    expect(covered.stillLocked).toEqual(['stats'])
    expect(covered.record[0]?.edits).toEqual(['hooks/runPlan.ts'])
  })

  test("another session's override covers nothing", () => {
    const covered = planShellCover([approvedChange({ session: 'A' })], ['runPlan'], [{ path: 'hooks/runPlan.ts', module: 'runPlan' }], T0, 'B')
    expect(covered.stillLocked).toEqual(['runPlan'])
    expect(covered.record[0]?.edits).toEqual([])
  })
})
