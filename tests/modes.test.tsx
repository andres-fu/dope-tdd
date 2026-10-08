import { describe, expect, test } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, touchTest } from './engine'
import type { FakeWorld } from './engine'

function configure(world: FakeWorld, json: string) {
  world.fileContents.set(`${ROOT}/red-first.json`, json)
}

describe('guard modes from red-first.json', () => {
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
    expect(status.text).toMatch(/config: red-first\.json: mode must be one of/)
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
