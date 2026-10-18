import { describe, expect, test } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import { formatGlossary, formatStatus } from '../hooks/summary'
import { INITIAL_STATS, recordRun, recordTestTouch, seedUnlocks, togglePause } from '../hooks/stats'

const T0 = 1_000_000

describe('formatStatus', () => {
  test('says plainly when nothing has happened yet', () => {
    const text = formatStatus(INITIAL_STATS, T0)
    expect(text).toMatch(/guard: ON/)
    expect(text).toMatch(/phase: IDLE/)
    expect(text).toMatch(/no events yet/)
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
    expect(text).toMatch(/1M AGO\s+touched\s+utils\/a/)
    expect(text).toMatch(/JUST NOW\s+paused/)
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

describe('/tdd why explains the band words of the 2026-10-18 redesign', () => {
  test('watching, not watching, runs it cannot read, unwatched edits and the next step', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}WATCHING {7}the edited code matches the layout/m)
    expect(text).toMatch(/^ {2}NOT WATCHING {3}code was edited that no test layout pairs/m)
    expect(text).toMatch(/^ {2}CAN'T READ RUNS test runs happened and none could be read/m)
    expect(text).toMatch(/^ {2}UNWATCHED {6}code files edited outside the layout/m)
    expect(text).toMatch(/^ {2}NEXT {11}the one step to take now/m)
  })
})
