import { describe, expect } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, test, touchTest } from './engine'
import type { FakeWorld } from './engine'

function configure(world: FakeWorld, json: string) {
  world.fileContents.set(`${ROOT}/dope-tdd.json`, json)
}

describe('a guessed layout says how to fix it', () => {
  test('with no layout in dope-tdd.json the refusal names /tdd setup; with one it does not', async ($, on) => {
    const world = fakeEngine(on)
    const guessed = await editAt($, 'src/utils/a.ts')
    configure(world, '{"layout":"mirror"}')
    const chosen = await editAt($, 'src/utils/b.ts')

    expect(guessed.deny).toMatch(/\/tdd setup/)
    expect(chosen.deny).toMatch(/write the failing test first/)
    expect(chosen.deny).not.toMatch(/\/tdd setup/)
  })
})

describe('guard modes from dope-tdd.json', () => {
  test('observe: nothing is denied, nothing is said, everything is counted', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"observe"}')

    const edit = await editAt($, 'src/utils/a.ts')
    const touch = await touchTest($, world, 'utils/b')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeUndefined()
    expect(edit.context).toBeUndefined()
    expect(touch.context).toBeUndefined()
    expect(status.text).toMatch(/unguarded 1/)
    expect(status.text).toMatch(/mode: observe/)
  })

  test('warn: nothing is denied, and the agent is told what to do next', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"warn"}')

    const edit = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeUndefined()
    expect(edit.context?.join(' ')).toMatch(/src\/utils\/a was edited with no test touched first/)
    expect(status.text).toMatch(/unguarded 1/)
    expect(status.text).toMatch(/mode: warn/)
  })

  test('exempt paths are never guarded or counted, and the status lists them', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"exempt":["src/main.tsx","src/generated/**"]}')

    const entry = await editAt($, 'src/main.tsx')
    const generated = await editAt($, 'src/generated/api/types.ts')
    const other = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(entry.deny).toBeUndefined()
    expect(generated.deny).toBeUndefined()
    expect(other.deny).toBeDefined()
    expect(status.text).toMatch(/test-first: 0\/1 · unguarded 0 · blocked 1/)
    expect(status.text).toMatch(/exempt: src\/main\.tsx, src\/generated\/\*\*/)
  })

  test('scope: enforced inside, observed outside', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"enforce","scope":["src/billing/**"]}')

    const inside = await editAt($, 'src/billing/invoice.ts')
    const outside = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(inside.deny).toBeDefined()
    expect(outside.deny).toBeUndefined()
    expect(outside.context).toBeUndefined()
    expect(status.text).toMatch(/mode: enforce in src\/billing\/\*\*/)
    expect(status.text).toMatch(/unguarded 1 · blocked 1/)
  })

  test('a broken config file falls back to enforce and the status says why', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode": "strict"}')

    const edit = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeDefined()
    expect(status.text).toMatch(/config: dope-tdd\.json: mode must be one of/)
  })

  test('shell writes follow the same policy', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"warn"}')

    const result = await runBash($, "sed -i 's/a/b/' src/utils/a.ts")

    expect(result.deny).toBeUndefined()
  })

  test('without a config file the guard enforces everywhere, as before', async ($, on) => {
    fakeEngine(on)

    const edit = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeDefined()
    expect(status.text).toMatch(/mode: enforce\n/)
  })
})

describe('observe touches nothing on disk', () => {
  test('a red, a fix and a green are recorded, but the catch check never reverts the file or starts a runner', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"observe"}')
    world.fileContents.set(`${ROOT}/src/utils/formatDuration.ts`, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    await runBash($, 'npx vitest run')
    await editAt($, 'src/utils/formatDuration.ts')
    world.bashFails = false
    const writesBefore = world.writes.length

    const green = await runBash($, 'npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(world.writes.length).toBe(writesBefore)
    expect(world.gitCalls.some(argv => argv.some(arg => arg.includes('vitest.mjs')))).toBe(false)
    expect(green.context).toBeUndefined()
    expect(status.text).toMatch(/cycles: 1/)
    expect(status.text).toMatch(/mode: observe \(records only: no refusals, no advice, no briefing, no catch check; nothing on disk is touched\)/)
    expect(status.text).not.toMatch(/caught|missed/)
  })

  test('a module outside the scope is only watched, so its fix is not reverted either', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"scope":["src/money/**"]}')
    world.fileContents.set(`${ROOT}/src/utils/formatDuration.ts`, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    await runBash($, 'npx vitest run')
    await editAt($, 'src/utils/formatDuration.ts')
    world.bashFails = false

    await runBash($, 'npx vitest run')

    expect(world.gitCalls.some(argv => argv.some(arg => arg.includes('vitest.mjs')))).toBe(false)
  })

  test('the agent is not briefed in observe mode, so the record is of how it works on its own', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"observe"}')
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)

    const composed = (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })) as { sections: readonly { id: string }[] }

    expect(composed.sections.some(section => section.id === 'dope-tdd:briefing')).toBe(false)
  })
})
