import { describe, expect, test } from 'claude-code/testing'

import { ACCENT } from '../hooks/theme'
import {
  BAND,
  MINUTE,
  ROOT,
  T0,
  TEST_SOURCE,
  editAt,
  fakeEngine,
  runTests,
  startSession,
  touchTest,
} from './engine'

const SURFACES = ['terminal', 'desktop'] as const

describe('band content', () => {
  test('stays hidden before any TDD activity', async ($, on) => {
    fakeEngine(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'red-first', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /RED|GREEN|PAUSED/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('names the module, its layer and language once a test is touched', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'red-first', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /WRITING/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'LOGIC · TS' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('labels a .tsx component test as frontend', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'components/CareerTimeline', 'tsx')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'FRONTEND · TSX' })).toBeDefined()
  })

  test('shows when the test file was last modified on disk', async ($, on) => {
    const world = fakeEngine(on)
    world.testModifiedAt = T0 - 2 * MINUTE
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'UPDATED 2M AGO' })).toBeDefined()
  })

  test('the cycle timer and the updated time advance with the minute tick', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })

    await world.clock.advance(3 * MINUTE)

    expect(await ui.find({ type: 'Text', text: 'WRITING 3M' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'UPDATED 3M AGO' })).toBeDefined()
  })

  test('shows the run trail, cycles and average cycle time', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await world.clock.advance(2 * MINUTE)
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /GREEN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'CYCLES 1 · AVG 2M' })).toBeDefined()
    const fail = await ui.find({ type: 'Text', text: '✗' })
    const pass = await ui.find({ type: 'Text', text: '●' })
    expect(fail?.props.color).toBe(ACCENT.ember)
    expect(pass?.props.color).toBe(ACCENT.pass)
  })

  test('colors the phase: ember for red, functional green for green', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const red = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect((await red.find({ type: 'Text', text: /RED/ }))?.props.color).toBe(ACCENT.ember)
    await red.unmount()

    await runTests($, world, 'pass')
    const green = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect((await green.find({ type: 'Text', text: /GREEN/ }))?.props.color).toBe(ACCENT.pass)
  })

  test('draws the skull logo on desktop and a skull glyph on the terminal', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const desktop = await $.ui.mount({ plugin: 'red-first', surface: 'desktop', ...BAND })
    expect(await desktop.find({ type: 'Svg' })).toBeDefined()
    await desktop.unmount()

    const terminal = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect((await terminal.find({ type: 'Text', text: '☠' }))?.props.color).toBe(ACCENT.ember)
  })
})

describe('band theming', () => {
  test('sits on the app background instead of painting its own slab', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'red-first', surface, ...BAND })
      const root = await ui.drawn()
      const props: Record<string, unknown> = 'props' in root && root.props ? { ...root.props } : {}
      expect(props.backgroundColor).toBeUndefined()
      await ui.unmount()
    }
  })

  test('draws neutral text in the theme color so it adapts to dark and light', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'desktop', ...BAND })
    const module = await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })
    const updated = await ui.find({ type: 'Text', text: /UPDATED/ })
    expect(module?.props.color).toBeUndefined()
    expect(updated?.props.color).toBeUndefined()
    expect(updated?.props.dimColor).toBe(true)
  })
})

describe('band buttons', () => {
  test('pause lets an untested source edit through, uncounted, and resume re-arms the guard', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'red-first', surface, ...BAND })
      await ui.press({ key: 'pause' })
      expect(await ui.find({ type: 'Text', text: /PAUSED/ })).toBeDefined()

      const paused = await editAt($, 'src/utils/calculateDuration.ts')
      expect(paused.deny).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /TEST-FIRST 0\/0/ })).toBeDefined()

      await ui.press({ key: 'pause' })
      const guarded = await editAt($, 'src/utils/calculateDuration.ts')
      expect(guarded.deny).toBeDefined()
      await ui.press({ key: 'reset' })
      await ui.unmount()
    }
  })

  test('reset zeroes the numbers but keeps the module unlocked', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    await editAt($, 'src/utils/calculateDuration.ts')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    await ui.press({ key: 'reset' })

    expect(await ui.find({ type: 'Text', text: /1 BLOCKED/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'CYCLES 0' })).toBeDefined()
    const stillUnlocked = await editAt($, 'src/utils/formatDuration.ts')
    expect(stillUnlocked.deny).toBeUndefined()
  })

  test('view test opens a pane showing the current test source', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const band = await $.ui.mount({ plugin: 'red-first', surface: 'desktop', ...BAND })
    await band.press({ key: 'view-test' })
    expect(world.openedPanes).toContain('red-first-test')

    for (const surface of SURFACES) {
      const pane = await $.ui.mount({
        plugin: 'red-first',
        surface,
        component: 'Pane',
        requestId: 'red-first-test',
        props: {} as never,
      })
      const code = await pane.find({ type: 'Code' })
      expect(code?.props.source).toBe(TEST_SOURCE)
      expect(code?.props.path).toBe(`${ROOT}/tests/utils/formatDuration.test.ts`)
      await pane.unmount()
    }
  })

  test('the test pane says so when the file is gone instead of failing', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    world.existingFiles.clear()

    const pane = await $.ui.mount({
      plugin: 'red-first',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'red-first-test',
      props: {} as never,
    })
    expect(await pane.find({ type: 'Text', text: /NOT FOUND/ })).toBeDefined()
  })
})
