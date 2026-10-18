import { describe, expect, test } from 'claude-code/testing'

import {
  OVERRIDES_FILE,
  checkRequest,
  closePauses,
  coveringOverride,
  decideAtRequest,
  endOverride,
  expiredPauses,
  formatOverrides,
  openDebt,
  parseRecord,
  pauseSummary,
  recordEdit,
  refuseByBar,
  requestNotes,
  serializeRecord,
} from '../hooks/overrides'
import type { Override, OverrideRequest } from '../hooks/overrides'

const T0 = 1_000_000_000
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const LIMITS = { pauseMaxMinutes: 120 }

const ask = (over: Partial<OverrideRequest> = {}): OverrideRequest => ({
  by: 'agent',
  scope: 'module',
  kind: 'spike',
  module: 'runPlan',
  path: 'hooks/runPlan.ts',
  reason: 'trying two parsers for the run summary to see which handles Windows output; the loser is deleted',
  until: 'the spike PR closes',
  minutes: null,
  ...over,
})

const entry = (over: Partial<Override> = {}): Override => ({
  ...ask(),
  id: 'o1',
  atMs: T0,
  status: 'approved',
  decidedBy: 'human',
  decidedAtMs: T0,
  endedAtMs: null,
  settledAtMs: null,
  note: null,
  edits: [],
  ...over,
})

describe('checkRequest: the mechanical part, before anyone is asked', () => {
  test('a complete request passes', () => {
    expect(checkRequest(ask(), LIMITS)).toBeNull()
  })

  test('an unknown kind or scope is refused, naming the ones there are', () => {
    expect(checkRequest(ask({ kind: 'temporary-mock' as never }), LIMITS)).toMatch(/kind must be one of: spike, hotfix, generated, legacy, other/)
    expect(checkRequest(ask({ scope: 'session' as never }), LIMITS)).toMatch(/scope must be one of: change, module, pause/)
  })

  test('a reason too short to say what, why and what next is refused', () => {
    expect(checkRequest(ask({ reason: 'blocked' }), LIMITS)).toMatch(/what, why and what happens next/)
  })

  test('a long reason that is only an empty phrase is refused', () => {
    expect(checkRequest(ask({ reason: 'needed to proceed with the task as quickly as possible' }), LIMITS)).toMatch(/"needed to proceed"/)
  })

  test('a module override names what ends it', () => {
    expect(checkRequest(ask({ until: null }), LIMITS)).toMatch(/needs "until"/)
    expect(checkRequest(ask({ until: '  ' }), LIMITS)).toMatch(/needs "until"/)
  })

  test('a change or module override names its module', () => {
    expect(checkRequest(ask({ module: null, scope: 'change' }), LIMITS)).toMatch(/names the file/)
  })

  test('a pause has minutes within the limit, and is refused when the team locked pause out', () => {
    const pause = ask({ scope: 'pause', module: null, path: null, until: null, minutes: 30 })
    expect(checkRequest(pause, LIMITS)).toBeNull()
    expect(checkRequest({ ...pause, minutes: null }, LIMITS)).toMatch(/minutes/)
    expect(checkRequest({ ...pause, minutes: 121 }, LIMITS)).toMatch(/at most 120 minutes/)
    expect(checkRequest(pause, { pauseMaxMinutes: 0 })).toMatch(/pause is turned off/)
  })
})

describe('decideAtRequest: no agent approves its own exception', () => {
  test('an agent asking, with a person there, waits for that person', () => {
    expect(decideAtRequest(ask(), true)).toEqual({ status: 'pending', decidedBy: null })
  })

  test('an agent asking, with nobody there, is denied: it stops and reports', () => {
    expect(decideAtRequest(ask(), false)).toEqual({ status: 'denied', decidedBy: 'unattended' })
  })

  test('a hotfix always passes, attended or not, and is recorded as debt', () => {
    expect(decideAtRequest(ask({ kind: 'hotfix', scope: 'change' }), false)).toEqual({ status: 'approved', decidedBy: 'hotfix rule' })
  })

  test('a person asking is the approver', () => {
    expect(decideAtRequest(ask({ by: 'human' }), true)).toEqual({ status: 'approved', decidedBy: 'human' })
  })
})

describe('the rising bar: exceptions stay rare', () => {
  test('a request while another waits is refused', () => {
    expect(refuseByBar([entry({ status: 'pending', decidedBy: null })], ask(), T0)).toMatch(/already waiting/)
  })

  test('an open override older than a week blocks new requests until it is ended or renewed', () => {
    const aged = entry({ module: 'stats', atMs: T0 - 8 * DAY })
    expect(refuseByBar([aged], ask(), T0)).toMatch(/stats has been open 8 days/)
    expect(refuseByBar([{ ...aged, endedAtMs: T0 - DAY }], ask(), T0)).toBeNull()
  })

  test('a first request is judged on its merits', () => {
    expect(requestNotes([], ask(), T0)).toEqual([])
  })

  test('the approver sees the history: same module this week, and the last day across modules', () => {
    const record = [entry({ atMs: T0 - 2 * HOUR, scope: 'change' }), entry({ id: 'o2', module: 'stats', atMs: T0 - HOUR, status: 'denied' })]
    expect(requestNotes(record, ask(), T0)).toEqual(['2nd override request on runPlan this week', '3rd override request in the last day'])
  })
})

describe('coveringOverride: what lets a locked edit through', () => {
  test('an approved, open module override covers its module', () => {
    expect(coveringOverride([entry()], 'runPlan', T0)?.id).toBe('o1')
    expect(coveringOverride([entry()], 'stats', T0)).toBeNull()
  })

  test('a pending, denied or ended one does not', () => {
    expect(coveringOverride([entry({ status: 'pending' })], 'runPlan', T0)).toBeNull()
    expect(coveringOverride([entry({ status: 'denied' })], 'runPlan', T0)).toBeNull()
    expect(coveringOverride([entry({ endedAtMs: T0 })], 'runPlan', T0)).toBeNull()
  })

  test('a change override covers one edit: once it has an edit, it is spent', () => {
    const change = entry({ scope: 'change' })
    expect(coveringOverride([change], 'runPlan', T0)?.id).toBe('o1')
    expect(coveringOverride(recordEdit([change], 'o1', 'hooks/runPlan.ts'), 'runPlan', T0)).toBeNull()
  })

  test('a pause covers every module until its minutes run out', () => {
    const pause = entry({ scope: 'pause', module: null, path: null, minutes: 30 })
    expect(coveringOverride([pause], 'stats', T0 + 29 * 60_000)?.id).toBe('o1')
    expect(coveringOverride([pause], 'stats', T0 + 30 * 60_000)).toBeNull()
  })
})

describe('ending and expiring', () => {
  test('ending names the module, and only the open overrides on it end', () => {
    const record = [entry(), entry({ id: 'o2', module: 'stats' })]
    const ended = endOverride(record, 'runPlan', T0 + HOUR)
    expect(ended.map(o => o.endedAtMs)).toEqual([T0 + HOUR, null])
  })

  test('a pause whose minutes ran out is expired, with what happened while it was on', () => {
    const pause = entry({ scope: 'pause', module: null, path: null, minutes: 30, reason: 'pairing on the prod incident in #301 and back after', edits: ['hooks/a.ts', 'hooks/b.ts', 'hooks/a.ts'] })
    expect(expiredPauses([pause], T0 + 29 * 60_000)).toEqual([])
    expect(expiredPauses([pause], T0 + 30 * 60_000).map(o => o.id)).toEqual(['o1'])
    expect(pauseSummary(pause)).toBe(
      'dope-tdd is back on after 30m (pairing on the prod incident in #301 and back after): 3 edits to 2 files while paused, none tested. Pin them with /dope-tdd:pin.',
    )
  })

  test('resuming early closes open pauses, but leaves their untested edits as debt', () => {
    const pause = entry({ scope: 'pause', module: null, minutes: 30, edits: ['hooks/a.ts'] })
    const closed = closePauses([pause, entry({ id: 'o2' })], T0 + 5 * 60_000)
    expect(closed.map(o => o.endedAtMs)).toEqual([T0 + 5 * 60_000, null])
    expect(openDebt(closed).map(o => o.id)).toEqual(['o1', 'o2'])
  })

  test('a pause with no edits says so', () => {
    expect(pauseSummary(entry({ scope: 'pause', minutes: 15, reason: 'reading the logs of the incident before touching code' }))).toBe(
      'dope-tdd is back on after 15m (reading the logs of the incident before touching code): no edits while paused.',
    )
  })
})

describe('debt: what the receipt keeps showing until someone deals with it', () => {
  test('an open module override, a hotfix and a pause with edits are debt; a spent change override is not', () => {
    const record = [
      entry(),
      entry({ id: 'o2', scope: 'change', kind: 'hotfix', module: 'mirror', decidedBy: 'hotfix rule', edits: ['hooks/mirror.ts'] }),
      entry({ id: 'o3', scope: 'change', module: 'stats', edits: ['hooks/stats.ts'] }),
      entry({ id: 'o4', scope: 'pause', module: null, minutes: 30, edits: ['hooks/a.ts'], endedAtMs: T0 + HOUR }),
      entry({ id: 'o5', status: 'denied', module: 'draw' }),
    ]
    expect(openDebt(record).map(o => o.id)).toEqual(['o1', 'o2', 'o4'])
  })

  test('an ended hotfix is no longer debt; a pause is debt until it is settled, not just over', () => {
    expect(openDebt([entry({ kind: 'hotfix', scope: 'change', endedAtMs: T0 })])).toEqual([])
    const pause = entry({ scope: 'pause', module: null, minutes: 30, edits: ['hooks/a.ts'], endedAtMs: T0 + HOUR })
    expect(openDebt(endOverride([pause], 'pause', T0 + 2 * HOUR))).toEqual([])
  })
})

describe('a model decision on the record (2026-10-18)', () => {
  const review = { model: 'claude-sonnet-5-5', effort: 'high', verdict: 'approve' as const, reason: 'low risk: the module keeps its proven test' }

  test('names the model and effort and its reason, so it never reads as a person', () => {
    expect(formatOverrides([entry({ decidedBy: 'model', review })], 10)[1]).toBe(
      '  runPlan  module · spike  approved by model claude-sonnet-5-5 (high): low risk: the module keeps its proven test  until the spike PR closes  OPEN',
    )
  })

  test('a model denial reads the same way', () => {
    const denied = entry({ status: 'denied', decidedBy: 'model', note: 'write the test; it is one cycle', review: { ...review, verdict: 'deny', reason: 'write the test; it is one cycle' } })
    expect(formatOverrides([denied], 10)[1]).toBe('  runPlan  module · spike  denied by model claude-sonnet-5-5 (high): write the test; it is one cycle')
  })

  test('the review survives the file', () => {
    const record = [entry({ decidedBy: 'model', review })]
    expect(parseRecord(serializeRecord(record))).toEqual(record)
  })
})

describe('the record file', () => {
  test('is named for the repo, next to dope-tdd.json', () => {
    expect(OVERRIDES_FILE).toBe('dope-tdd.overrides.json')
  })

  test('round-trips, and reads a missing or broken file as empty', () => {
    const record = [entry(), entry({ id: 'o2', status: 'denied', note: 'write the test; it is one cycle' })]
    expect(parseRecord(serializeRecord(record))).toEqual(record)
    expect(parseRecord(null)).toEqual([])
    expect(parseRecord('{ not json')).toEqual([])
    expect(parseRecord('{"overrides": [{"id": 3}]}')).toEqual([])
  })

  test('holds no names: the decider is a role', () => {
    expect(serializeRecord([entry()])).toContain('"decidedBy": "human"')
  })
})

describe('formatOverrides: for /tdd and the receipt', () => {
  test('nothing on record says nothing', () => {
    expect(formatOverrides([], 10)).toEqual([])
  })

  test('the rate per cycle, then one line per override with its state', () => {
    const record = [
      entry(),
      entry({ id: 'o2', scope: 'change', kind: 'hotfix', module: 'mirror', decidedBy: 'hotfix rule', until: null, reason: 'null check for the prod crash in #301, test in the follow-up' }),
      entry({ id: 'o3', scope: 'change', module: 'stats', status: 'denied', until: null, note: 'write the test; it is one cycle' }),
    ]
    expect(formatOverrides(record, 40)).toEqual([
      'OVERRIDES  2 approved in 40 cycles · 1 denied',
      '  runPlan  module · spike  approved by human  until the spike PR closes  OPEN',
      '  mirror  change · hotfix  approved by hotfix rule  DEBT: no test yet',
      '  stats  change · spike  denied by human: write the test; it is one cycle',
    ])
  })
})
