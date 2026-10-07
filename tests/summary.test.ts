import { describe, expect, test } from 'claude-code/testing'

import { formatStatus } from '../hooks/summary'
import { INITIAL_STATS, recordRun, recordTestTouch, togglePause } from '../hooks/stats'

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
