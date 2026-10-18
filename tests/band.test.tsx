import { describe, expect } from 'claude-code/testing'

import { ACCENT } from '../hooks/theme'
import { BAND, MINUTE, ROOT, SOURCE, TEST_SOURCE, editAt, fakeEngine, fixUnderGuard, runTests, startSession, test, touchTest, writeAt } from './engine'

const SURFACES = ['terminal', 'desktop'] as const

describe('band content', () => {
  test('stays hidden before any TDD activity', async ($, on) => {
    fakeEngine(on)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /RED|GREEN|PAUSED|IDLE/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('names the module and says WRITING once a test is touched', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: /WRITING/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'DOPE TDD' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('says IDLE, not WRITING, when a reset keeps the module but no cycle is open', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await ui.press({ key: 'reset' })

    expect(await ui.find({ type: 'Text', text: 'IDLE' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /WRITING/ })).toBeUndefined()
  })

  test('the cycle timer advances with the minute tick', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await world.clock.advance(3 * MINUTE)

    expect(await ui.find({ type: 'Text', text: 'WRITING 3M' })).toBeDefined()
  })

  test('shows the run trail; session totals live in /tdd, never as calm zeros on the band', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /GREEN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CYCLES|0 CAUGHT|0 BLOCKED/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: '✗' }))?.props.color).toBe(ACCENT.ember)
    expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe(ACCENT.pass)
  })

  test('colors the phase: ember for red, functional green for green', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const red = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await red.find({ type: 'Text', text: /■ RED/ }))?.props.color).toBe(ACCENT.ember)
    await red.unmount()

    await runTests($, world, 'pass')
    const green = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await green.find({ type: 'Text', text: /GREEN/ }))?.props.color).toBe(ACCENT.pass)
  })

  test('draws the skull logo on desktop and a skull glyph on the terminal', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const desktop = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })
    expect(await desktop.find({ type: 'Svg' })).toBeDefined()
    await desktop.unmount()

    const terminal = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await terminal.find({ type: 'Text', text: '☠' }))?.props.color).toBe(ACCENT.ember)
  })
})

describe('band verdict', () => {
  test('a fix that saw red and is caught shows the whole chain done, CAUGHT, and the next step', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    for (const step of ['test ✓', 'red ✓', 'green ✓']) {
      expect((await ui.find({ type: 'Text', text: step }))?.props.color).toBe(ACCENT.pass)
    }
    expect((await ui.find({ type: 'Text', text: 'CAUGHT' }))?.props.color).toBe(ACCENT.pass)
    expect(await ui.find({ type: 'Text', text: /refactor while the test guards it, then commit/ })).toBeDefined()
  })

  test('a test that misses the change is called out in ember', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  3 passed (3)\n', exitCode: 0 }
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'MISSED' }))?.props.color).toBe(ACCENT.ember)
    expect((await ui.find({ type: 'Text', text: '1 MISSED' }))?.props.bold).toBe(true)
  })

  test('a test that went green without failing says NEVER SAW RED', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'NEVER SAW RED' }))?.props.color).toBe(ACCENT.paused)
    expect(await ui.find({ type: 'Text', text: '1 NEVER SAW RED' })).toBeDefined()
  })

  test('a refactor that kept the test green says REFACTOR, in plain text: a fact about the change, not credit', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    await runTests($, world, 'pass')
    world.fileContents.set(SOURCE, 'export const b = 1 // still b')
    await $.tool.call({ tool: 'Edit', file_path: SOURCE, old_string: ' // still b', new_string: ' // renamed' } as never)
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'REFACTOR' }))?.props.color).not.toBe(ACCENT.pass)
  })

  test('shows the mode only when it is not plain enforce', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const plain = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await plain.find({ type: 'Text', text: /MODE/ })).toBeUndefined()
    await plain.unmount()

    await writeAt($, 'dope-tdd.json', '{"mode":"warn"}')
    const warn = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await warn.find({ type: 'Text', text: 'MODE WARN' })).toBeDefined()
  })
})

describe('band theming', () => {
  test('sits on the app background instead of painting its own slab', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      const root = await ui.drawn()
      const props: Record<string, unknown> = 'props' in root && root.props ? { ...root.props } : {}
      expect(props.backgroundColor).toBeUndefined()
      await ui.unmount()
    }
  })

  test('draws neutral text in the theme color so it adapts to dark and light', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })
    const module = await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })
    const next = await ui.find({ type: 'Text', text: 'NEXT' })
    expect(module?.props.color).toBeUndefined()
    expect(next?.props.color).toBeUndefined()
    expect(next?.props.dimColor).toBe(true)
  })
})

describe('band honesty: whether dope-tdd is watching comes first (2026-10-18)', () => {
  test('watching names where it looks', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: '● WATCHING src/ · node' }))?.props.color).toBe(ACCENT.pass)
  })

  test('code edited outside every layout, with nothing guarded, says NOT WATCHING and how to fix it', async ($, on) => {
    fakeEngine(on)
    await writeAt($, 'scripts/build.ts', 'export const x = 1')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: '⚠ NOT WATCHING' }))?.props.color).toBe(ACCENT.paused)
      expect(await ui.find({ type: 'Text', text: /1 edited code file matches no test layout: scripts\/build\.ts/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /run \/tdd setup, or add a layout to dope-tdd\.json/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /GREEN|IDLE/ })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('test runs that cannot be read say so, instead of looking like a calm start', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    world.bashText = 'Error: Cannot find module vitest\n'
    await runTests($, world, 'fail')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: "⚠ CAN'T READ RUNS" }))?.props.color).toBe(ACCENT.paused)
    expect(await ui.find({ type: 'Text', text: /run one test file, so its summary line reaches the output/ })).toBeDefined()
  })
})

describe('band buttons', () => {
  test('pause lets an untested source edit through, uncounted, and resume re-arms the guard', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      await ui.press({ key: 'pause' })
      expect(await ui.find({ type: 'Text', text: /PAUSED/ })).toBeDefined()

      const paused = await editAt($, 'src/utils/calculateDuration.ts')
      expect(paused.deny).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /UNGUARDED/ })).toBeUndefined()

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

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    await ui.press({ key: 'reset' })

    expect(await ui.find({ type: 'Text', text: '1 BLOCKED' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /BLOCKED|MISSED|WORKAROUNDS/ })).toBeUndefined()
    const stillUnlocked = await editAt($, 'src/utils/formatDuration.ts')
    expect(stillUnlocked.deny).toBeUndefined()
  })

  test('view test opens a pane showing the current test source', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const band = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })
    await band.press({ key: 'view-test' })
    expect(world.openedPanes).toContain('dope-tdd-test')

    for (const surface of SURFACES) {
      const pane = await $.ui.mount({
        plugin: 'dope-tdd',
        surface,
        component: 'Pane',
        requestId: 'dope-tdd-test',
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
      plugin: 'dope-tdd',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'dope-tdd-test',
      props: {} as never,
    })
    expect(await pane.find({ type: 'Text', text: /NOT FOUND/ })).toBeDefined()
  })
})

describe('/tdd why', () => {
  test('explains every word that can appear on the band', async ($, on) => {
    fakeEngine(on)

    const result = await $.command.run({ command: 'tdd', args: 'why' } as never)

    for (const word of [
      'WRITING',
      'RED',
      'RED ELSEWHERE',
      'GREEN',
      'SAW RED',
      'NEVER SAW RED',
      'TEST CHANGED',
      'CAUGHT',
      'MISSED',
      'UNVERIFIED',
      'REFACTOR',
      'UNGUARDED',
      'WORKAROUNDS',
      'BLOCKED',
      'PAUSED',
      'MODE',
      'WATCHING',
      'NOT WATCHING',
      "CAN'T READ RUNS",
      'UNWATCHED',
      'NEXT',
    ]) {
      expect(result.text).toMatch(new RegExp(`^  ${word} `, 'm'))
    }
  })
})

describe('a module in a folder with a layout of its own (#24)', () => {
  test('the band names it by its source path', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"},"layouts":{"dashboard":"colocated"}}')
    await writeAt($, 'dashboard/src/lib/pkce.test.ts', "it('x', () => { expect(1).toBe(2) })")

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: 'DASHBOARD/SRC/LIB/PKCE' })).toBeDefined()
      await ui.unmount()
    }
  })
})
