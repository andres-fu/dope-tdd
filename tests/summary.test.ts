import { describe, expect, test } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import { formatGlossary, formatStatus } from '../hooks/summary'
import { INITIAL_STATS, recordRun, recordTestTouch, recordWorkaround, seedUnlocks, togglePause } from '../hooks/stats'

const T0 = 1_000_000

describe('formatStatus', () => {
  test('says plainly when nothing has happened yet', () => {
    const text = formatStatus(INITIAL_STATS, T0)
    expect(text).toMatch(/guard: ON/)
    expect(text).toMatch(/phase: IDLE/)
    expect(text).toMatch(/^recent events: none yet$/m)
  })

  test('reports pause, phase, counts and recent events with relative times', () => {
    let s = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'C:/w/tests/utils/a.test.ts' }, T0)
    s = recordRun(s, false, T0 + 5_000)
    s = togglePause(s, T0 + 10_000)
    const text = formatStatus(s, T0 + 65_000)

    expect(text).toMatch(/guard: PAUSED/)
    expect(text).toMatch(/phase: RED/)
    expect(text).toMatch(/module: utils\/a/)
    expect(text).toMatch(/runs: 1 \(0 pass, 1 fail\)/)
    expect(text).toMatch(/^1M AGO: touched utils\/a$/m)
    expect(text).toMatch(/^JUST NOW: paused$/m)
  })
})

describe('unlocks from earlier sessions', () => {
  test('are listed with their age so the agent and the person know where the unlock came from', () => {
    const s = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'C:/w/tests/utils/a.test.ts', atMs: T0 - 3 * 60 * 60_000 } })
    const text = formatStatus(s, T0)

    expect(text).toMatch(/unlocked earlier: utils\/a \(3H AGO\)/)
  })
})

describe('a module in a folder with a layout of its own is named by its source path (#24)', () => {
  test('in the open modules and the unlocks from earlier sessions too', () => {
    const config = parseConfig('{"layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"},"layouts":{"dashboard":"colocated"}}')
    let s = seedUnlocks(INITIAL_STATS, { 'dashboard//lib/pkce': { testPath: 'C:/w/dashboard/src/lib/pkce.test.ts', atMs: T0 - 60 * 60_000 } })
    s = recordTestTouch(s, { module: 'dashboard//lib/toasts', testPath: 'C:/w/dashboard/src/lib/toasts.test.ts' }, T0)
    s = recordTestTouch(s, { module: 'queueOps', testPath: 'C:/w/test/queueOps.test.js' }, T0)
    const text = formatStatus(s, T0, config)

    expect(text).toMatch(/also open: dashboard\/src\/lib\/toasts \(writing\)/)
    expect(text).toMatch(/unlocked earlier: dashboard\/src\/lib\/pkce \(1H AGO\)/)
    expect(text).toMatch(/module: queueOps/)
  })
})

// One verdict vocabulary (2026-10-18): /tdd counts in the band's words, so the band's PROVEN never sits beside "proven 0".
describe('the catch check counts in the band\'s words', () => {
  test('caught and proven add up to proven; unverified is not checked', () => {
    const s = { ...INITIAL_STATS, caught: 2, proven: 1, missed: 1, unverified: 3 }
    expect(formatStatus(s, T0)).toMatch(/^catch check: proven 3 · missed 1 · not checked 3$/m)
    expect(formatStatus(s, T0)).not.toMatch(/caught|unverified/)
  })

  test('a green that never failed is counted as never failed', () => {
    const s = { ...INITIAL_STATS, cycles: 2, cycleMsTotal: 120_000, neverSawRed: 1 }
    expect(formatStatus(s, T0)).toMatch(/^cycles: 2 \(avg 1M, never failed 1\)$/m)
  })
})

describe('/tdd why explains the words the band and /tdd use, and only those', () => {
  test('the verdicts in the one vocabulary; the retired words are gone', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}PROVEN +the test fails without your change \(dope-tdd undid it, or you broke the code on purpose\): it guards this change/m)
    expect(text).toMatch(/^ {2}MISSED +with your change undone the test still passes/m)
    expect(text).toMatch(/^ {2}red ✓ green ✓ +the steps of this cycle: ✓ done, · not yet, ✗ the test went green without failing first/m)
    expect(text).toMatch(/^ {2}RED 4M +the test fails now, and how long since the cycle opened/m)
    expect(text).toMatch(/^ {2}last run +which test ran last, how it went, and when; click it to open that test/m)
    for (const retired of ['CAUGHT', 'UNVERIFIED', 'NEVER SAW RED', 'TEST CHANGED', 'SAW RED', 'WRITING', 'RED ELSEWHERE', 'GIT REBASE', 'UNWATCHED', '  WATCHING']) {
      expect(text).not.toContain(retired)
    }
  })

  test('watching, not watching, runs it cannot read, and the next step', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}NOT WATCHING {3}code was edited that no test layout pairs/m)
    expect(text).toMatch(/^ {2}CAN'T READ RUNS test runs happened and none could be read/m)
    expect(text).toMatch(/^ {2}next {11}the one step to take now/m)
    // Override with a reason, v1 (2026-10-18): no off switch, so PAUSED points at a time and a reason.
    expect(text).toMatch(/^ {2}OVERRIDE ASKED +the agent asked to pass the guard and waits: \/tdd approve, or \/tdd deny <why>/m)
    // Band v3 (2026-10-18): the verdict and guard words the band now uses.
    expect(text).toMatch(/^ {2}UNPROVEN +green, but not proven by a test that failed first: the reason follows the word/m)
    expect(text).toMatch(/^ {2}CHANGED +the code changed since it went green: run the test again/m)
    expect(text).toMatch(/^ {2}STANDING DOWN +a git rebase, merge, cherry-pick, revert, am or bisect is in progress/m)
    expect(text).toMatch(/^ {2}WARN ONLY +the mode lets untested edits through, with a warning/m)
    expect(text).toMatch(/^ {2}OBSERVING +the mode refuses nothing; dope-tdd only records/m)
    // Live trial: one row for every override still open, whichever module is current, with END (2026-10-18).
    expect(text).toMatch(/^ {2}OVERRIDE OPEN +an approved override that still lets edits through: what is left and who approved it; END closes it/m)
    expect(text).not.toMatch(/OVERRIDDEN/)
    expect(text).toMatch(/^ {2}OVERRIDES OPEN +overrides not yet ended, and hotfixes or paused edits with no test yet: debt on the receipt/m)
    expect(text).toMatch(/^ {2}PAUSED +\/tdd pause <minutes> <reason>: edits are not counted until it ends by itself, or \/tdd resume/m)
    expect(text).not.toMatch(/\/tdd off/)
  })
})

describe('formatStatus names an edited override record (2026-10-18)', () => {
  test('as its own workaround word', () => {
    const s = recordWorkaround(INITIAL_STATS, 'record-edited', '', 'dope-tdd.overrides.json', T0)
    expect(formatStatus(s, T0)).toMatch(/workarounds: 1 \(override record edited 1\)/)
  })
})

describe('formatStatus as rows the app can show as a table (2026-10-18)', () => {
  test('the first row is the build, not the plugin name twice', () => {
    expect(formatStatus(INITIAL_STATS, T0, undefined, '#99 · a6b93d4 · 2026-10-18').split('\n')[0]).toBe('#99 · a6b93d4 · 2026-10-18')
  })

  test('each recent event is a "when: what" row under a header row', () => {
    const s = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'C:/m/tests/utils/a.test.ts' }, T0)
    const text = formatStatus(s, T0 + 60_000)
    expect(text).toMatch(/^recent events: newest first$/m)
    expect(text).not.toMatch(/^ {2}\S/m)
  })

  test('no events is one row', () => {
    expect(formatStatus(INITIAL_STATS, T0)).toMatch(/^recent events: none yet$/m)
  })
})
