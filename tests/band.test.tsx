import { describe, expect } from 'claude-code/testing'

import { ACCENT } from '../hooks/theme'
import { BAND, MINUTE, ROOT, SOURCE, TEST_SOURCE, editAt, fakeEngine, fixUnderGuard, runBash, runTests, startSession, test, touchTest, writeAt } from './engine'

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

  test('names the module and shows its open steps once a test is touched', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: 'red ·' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'dope-tdd' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a test named after no module, testing other modules, does not take over the band (2026-10-18)', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    world.fileContents.set(`${ROOT}/tests/band.test.ts`, "import { a } from '../src/utils/formatDuration'\nexpect(a).toBe(1)\n")
    await touchTest($, world, 'band')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^band$/ })).toBeUndefined()
  })

  test('a test named after no module that was on the band before an upgrade is let go when dope-tdd loads (2026-10-18)', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'band')
    world.fileContents.set(`${ROOT}/tests/band.test.ts`, "import { a } from '../src/utils/formatDuration'\nexpect(a).toBe(1)\n")

    await startSession($)

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /^band$/ })).toBeUndefined()
  })

  test('a new module written test-first, whose source does not exist yet, does take over the band', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    world.fileContents.set(`${ROOT}/tests/utils/slugify.test.ts`, "import { slugify } from '../../src/utils/slugify'\nexpect(slugify('A')).toBe('a')\n")
    await touchTest($, world, 'utils/slugify')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'utils/slugify' })).toBeDefined()
  })

  test('a reset keeps the module, with its steps open again', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await $.command.run({ command: 'tdd', args: 'reset yes' } as never)

    expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'green ·' })).toBeDefined()
  })

  test('the RED timer advances with the minute tick', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await world.clock.advance(3 * MINUTE)

    expect(await ui.find({ type: 'Text', text: 'RED 3M' })).toBeDefined()
  })

  // The band draws often: it asked the engine for this session's id on every draw until it kept it at the start (2026-10-18).
  test("the band reads this session's id once, at the session's start, not on every draw", async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const asked = world.sessionIdCalls
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    await world.clock.advance(3 * MINUTE)
    expect(await ui.find({ type: 'Text', text: 'RED 3M' })).toBeDefined()
    expect(world.sessionIdCalls).toBe(asked)
  })

  // A trail of ● and ✗ said nothing a person could act on: which test, which module, when (2026-10-18). The last run, in
  // words, does; the history stays in /tdd.
  test('shows the last run in words, not a trail of symbols; session totals live in /tdd', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'green ✓' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CYCLES|0 CAUGHT|0 BLOCKED/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'last run: formatDuration.test.ts passed · just now' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^[●✗]$/ })).toBeUndefined()
  })

  test('colors the phase: ember for red, functional green for green', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const red = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await red.find({ type: 'Text', text: /^RED/ }))?.props.color).toBe(ACCENT.ember)
    await red.unmount()

    await runTests($, world, 'pass')
    const green = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await green.find({ type: 'Text', text: 'green ✓' }))?.props.color).toBe(ACCENT.pass)
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
  test('a fix that saw red and is caught shows the whole chain done, PROVEN, and the next step', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    for (const step of ['red ✓', 'green ✓']) {
      expect((await ui.find({ type: 'Text', text: step }))?.props.color).toBe(ACCENT.pass)
    }
    expect((await ui.find({ type: 'Text', text: 'PROVEN' }))?.props.color).toBe(ACCENT.pass)
    expect(await ui.find({ type: 'Text', text: /refactor while the test guards it, then commit/ })).toBeDefined()
  })

  test('a test that misses the change is called out in ember', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  3 passed (3)\n', exitCode: 0 }
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'MISSED · passes without your change' }))?.props.color).toBe(ACCENT.ember)
    expect(await ui.find({ type: 'Text', text: '1 MISSED' })).toBeUndefined()
  })

  test('a test that went green without failing says NEVER SAW RED', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'UNPROVEN · never failed' }))?.props.color).toBe(ACCENT.paused)
    expect(await ui.find({ type: 'Text', text: '1 NEVER SAW RED' })).toBeUndefined()
  })

  test('green without red that the catch check caught shows red done by catch, and no hand proof to do (2026-10-18)', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await editAt($, 'src/utils/formatDuration.ts')
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'red ✓' }))?.props.color).toBe(ACCENT.pass)
    expect(await ui.find({ type: 'Text', text: /UNPROVEN/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /refactor while the test guards it, then commit/ })).toBeDefined()
  })

  test('a green module that went quiet stops being current: no GREEN and no trail without a module (2026-10-18)', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await runTests($, world, 'pass')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'green ✓' })).toBeDefined()

    await world.clock.advance(16 * MINUTE)

    expect(await ui.find({ type: 'Text', text: 'green ✓' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /write a failing test first/ })).toBeDefined()
  })

  test("the band's problems are this cycle's: an earlier cycle's block is gone once a new cycle passes", async ($, on) => {
    const world = fakeEngine(on)
    await editAt($, 'src/utils/formatDuration.ts')
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await runTests($, world, 'pass')
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /BLOCKED/ })).toBeUndefined()
    const status = await $.command.run({ command: 'tdd', args: '' } as never)
    expect(status.text).toMatch(/blocked 1/)
  })

  test('a refactor that kept the test green says REFACTOR, in plain text: a fact about the change, not credit', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    await runTests($, world, 'pass')
    world.fileContents.set(SOURCE, 'export const b = 1 // still b')
    await $.tool.call({ tool: 'Edit', file_path: SOURCE, old_string: ' // still b', new_string: ' // renamed' } as never)
    await runTests($, world, 'pass')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Text', text: 'refactor · not re-checked' }))?.props.color).not.toBe(ACCENT.pass)
  })

  test('shows the mode only when it is not plain enforce', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const plain = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await plain.find({ type: 'Text', text: /WARN ONLY|OBSERVING/ })).toBeUndefined()
    await plain.unmount()

    await writeAt($, 'dope-tdd.json', '{"mode":"warn"}')
    const warn = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await warn.find({ type: 'Text', text: 'WARN ONLY' })).toBeDefined()
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
    const module = await ui.find({ type: 'Text', text: 'utils/formatDuration' })
    const next = await ui.find({ type: 'Text', text: 'next' })
    expect(module?.props.color).toBeUndefined()
    expect(next?.props.color).toBeUndefined()
    expect(next?.props.dimColor).toBe(true)
  })
})

describe('band honesty: whether dope-tdd is watching comes first (2026-10-18)', () => {
  // Where it looks never changes within a repo, so the band says only that it is watching; /tdd names the layout.
  // Band v3: while the guard enforces and watches, it says nothing about it; only the opposite earns a word.
  test('watching and enforcing is silent', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /WATCHING/ })).toBeUndefined()
  })

  test('code edited outside every layout, with nothing guarded, says NOT WATCHING and how to fix it', async ($, on) => {
    fakeEngine(on)
    await writeAt($, 'scripts/build.ts', 'export const x = 1')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect((await ui.find({ type: 'Text', text: 'NOT WATCHING' }))?.props.color).toBe(ACCENT.paused)
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
    expect((await ui.find({ type: 'Text', text: "CAN'T READ RUNS" }))?.props.color).toBe(ACCENT.paused)
    expect(await ui.find({ type: 'Text', text: /run one test file, so its summary line reaches the output/ })).toBeDefined()
  })
})

describe('band buttons', () => {
  test('a pause lets an untested source edit through, uncounted, and RESUME re-arms the guard', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      await $.command.run({ command: 'tdd', args: 'pause 30 pairing on the prod incident in #301 and back after' } as never)
      expect(await ui.find({ type: 'Text', text: /PAUSED/ })).toBeDefined()

      const paused = await editAt($, 'src/utils/calculateDuration.ts')
      expect(paused.deny).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /UNGUARDED/ })).toBeUndefined()

      await ui.press({ key: 'resume' })
      const guarded = await editAt($, 'src/utils/calculateDuration.ts')
      expect(guarded.deny).toBeDefined()
      await $.command.run({ command: 'tdd', args: 'reset yes' } as never)
      await ui.unmount()
    }
  })

  test('reset zeroes the numbers but keeps the module unlocked', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    await editAt($, 'src/utils/calculateDuration.ts')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    await $.command.run({ command: 'tdd', args: 'reset yes' } as never)

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

  // "last run" opens what that run was (2026-10-18), as VIEW TEST opens the current test: the band's words act.
  test('the last run opens the test it ran, in a pane of its own', async ($, on) => {
    const world = fakeEngine(on)
    const band = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })
    await touchTest($, world, 'utils/formatDuration')
    expect(await band.find({ type: 'Button', text: /^last run/ })).toBeUndefined()

    await runTests($, world, 'fail')
    expect(await band.find({ type: 'Button', text: 'last run: formatDuration.test.ts failed · just now' })).toBeDefined()
    await band.press({ key: 'last-run' })
    expect(world.openedPanes).toContain('dope-tdd-last-run')

    for (const surface of SURFACES) {
      const pane = await $.ui.mount({ plugin: 'dope-tdd', surface, component: 'Pane', requestId: 'dope-tdd-last-run', props: {} as never })
      const code = await pane.find({ type: 'Code' })
      expect(code?.props.source).toBe(TEST_SOURCE)
      expect(code?.props.path).toBe(`${ROOT}/tests/utils/formatDuration.test.ts`)
      await pane.unmount()
    }
  })

  test('a last run that failed elsewhere opens the first file that failed', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/tests/utils/other.test.ts`, 'expect(other()).toBe(1)\n')
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    world.bashText = ['tests\\utils\\formatDuration.test.ts:', '(pass) formatDuration > formats [1.00ms]', '', 'tests\\utils\\other.test.ts:', '(fail) other > works [1.00ms]', '', ' 1 pass', ' 1 fail', 'Ran 2 tests across 2 files. [2.01s]'].join('\n')
    await runBash($, 'claude plugin test .')

    const band = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })
    await band.press({ key: 'last-run' })
    const pane = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', component: 'Pane', requestId: 'dope-tdd-last-run', props: {} as never })
    expect((await pane.find({ type: 'Code' }))?.props.path).toBe(`${ROOT}/tests/utils/other.test.ts`)
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
      // Band v3 (2026-10-18)
      'UNPROVEN',
      'CHANGED',
      'STANDING DOWN',
      'WARN ONLY',
      'OBSERVING',
      'OVERRIDE ASKED',
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
      expect(await ui.find({ type: 'Text', text: 'dashboard/src/lib/pkce' })).toBeDefined()
      await ui.unmount()
    }
  })
})

// Band v3 (2026-10-18), as mocked and agreed: two lines (a third only when a person must act), silence while the guard
// enforces, the module as it is named, one verdict word, and a line before anything happens instead of no band at all.
describe('band v3', () => {
  const mount = ($: Parameters<typeof touchTest>[0]) => $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

  test('before anything happens: the name and what it will do, never an empty space', async ($, on) => {
    fakeEngine(on)
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'dope-tdd' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ready · write a failing test, or edit code, and this band follows/ })).toBeDefined()
  })

  test('writing: the module as named, both steps open, no WATCHING, no header, no RESET', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const ui = await mount($)
    expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'red ·' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'green ·' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /WATCHING|DOPE TDD/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'RESET' })).toBeUndefined()
  })

  test('RED in ember', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: /^RED/ }))?.props.color).toBe(ACCENT.ember)
  })

  test('PROVEN in green, after red and green', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: 'PROVEN' }))?.props.color).toBe(ACCENT.pass)
    expect(await ui.find({ type: 'Text', text: 'red ✓' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'green ✓' })).toBeDefined()
  })

  test('MISSED is its own word, in ember, the strongest colour', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  3 passed (3)\n', exitCode: 0 }
    await runTests($, world, 'pass')
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: 'MISSED · passes without your change' }))?.props.color).toBe(ACCENT.ember)
  })

  test('a guard that is not enforcing says one amber word and what it means', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"warn"}')
    await touchTest($, world, 'utils/formatDuration')
    const ui = await mount($)
    expect((await ui.find({ type: 'Text', text: 'WARN ONLY' }))?.props.color).toBe(ACCENT.paused)
    expect(await ui.find({ type: 'Text', text: 'untested edits go through, with a warning' })).toBeDefined()
  })

  test('/tdd reset asks first, then resets on the record', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const asked = (await $.command.run({ command: 'tdd', args: 'reset' } as never)) as { text: string }
    expect(asked.text).toMatch(/\/tdd reset yes/)
    await $.command.run({ command: 'tdd', args: 'reset yes' } as never)
    expect(((await $.command.run({ command: 'tdd', args: '' } as never)) as { text: string }).text).toMatch(/^JUST NOW: reset$/m)
  })
})
