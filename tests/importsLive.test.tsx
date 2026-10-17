import { describe, expect } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, test, writeAt } from './engine'
import type { FakeWorld } from './engine'

/**
 * Replays the A/B run on Project-RESEARCH: slugify lives in src/lib/io.ts, its
 * tests live in test/slugify.test.ts, and the layout pairs by name, so the two
 * names never meet. The agent wrote the failing test first and was blocked
 * anyway, then wrote duplicate tests in test/io.test.ts to get through.
 */
const IO = `${ROOT}/src/lib/io.ts`
const SLUG_TEST = 'test/slugify.test.ts'
const TEST_TEXT = 'import { describe, it, expect } from "vitest";\nimport { slugify } from "../src/lib/io.js";\nimport type { Meta } from "../src/types.js";\n\nit("keeps accents", () => { expect(slugify("Café")).toBe("cafe") })\n'
const FAIL = ' FAIL  test/slugify.test.ts > keeps accents\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'
const PASS = ' ✓ test/slugify.test.ts (1 test)\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n'

function project(world: FakeWorld) {
  world.fileContents.set(`${ROOT}/dope-tdd.json`, '{ "layout": "flat" }')
  world.fileContents.set(IO, 'export function slugify(t) { return t }')
  world.existingFiles.add(`${ROOT}/src/types.ts`)
}

describe('a test covers what it imports', () => {
  test('touching a test that imports io unlocks io, says so, and leaves the type-only import alone', async ($, on) => {
    const world = fakeEngine(on)
    project(world)

    const touched = await writeAt($, SLUG_TEST, TEST_TEXT)
    const edit = await editAt($, 'src/lib/io.ts')
    const types = await editAt($, 'src/types.ts')

    expect(touched.context?.join(' ')).toMatch(/test\/slugify\.test\.ts imports io, so it is the test for that module too/)
    expect(edit.deny).toBeUndefined()
    expect(types.deny).toMatch(/write the failing test first/)
  })

  test('the whole fix, red, edit, green: no block, no duplicate test, caught on the right file, nothing left red', async ($, on) => {
    const world = fakeEngine(on)
    project(world)

    await writeAt($, SLUG_TEST, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL
    await runBash($, `npx vitest run ${SLUG_TEST}`)
    const edit = await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = PASS
    world.catchRun = { text: FAIL, exitCode: 1 }
    const green = await runBash($, `npx vitest run ${SLUG_TEST}`)
    const status = await runCommand($, 'tdd')

    expect((edit as { deny?: string }).deny).toBeUndefined()
    expect(green.context?.join(' ')).toMatch(/GREEN on io, saw red, and its test catches the change/)
    expect(status.text).toMatch(/module: io/)
    expect(status.text).toMatch(/caught 1/)
    expect(status.text).not.toMatch(/also open/)
    expect(status.text).not.toMatch(/blocked [1-9]/)
    const check = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(check?.slice(-1)).toEqual([SLUG_TEST])
  })

  test('a green whole-suite run closes every red cycle: nothing is left open behind it', async ($, on) => {
    const world = fakeEngine(on)
    project(world)

    await writeAt($, SLUG_TEST, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL
    await runBash($, `npx vitest run ${SLUG_TEST}`)
    await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = PASS
    world.catchRun = { text: FAIL, exitCode: 1 }
    await runBash($, 'npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(status.text).not.toMatch(/also open/)
  })

  test('a green run filtered by test name is not the whole suite and closes nothing', async ($, on) => {
    const world = fakeEngine(on)
    project(world)

    await writeAt($, SLUG_TEST, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL
    await runBash($, `npx vitest run ${SLUG_TEST}`)
    await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = PASS
    world.catchRun = { text: FAIL, exitCode: 1 }
    await runBash($, 'npx vitest run -t "something else"')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/also open: slugify \(red\)/)
  })

  test('a failing run of an existing test that imports io unlocks io with no touch at all', async ($, on) => {
    const world = fakeEngine(on)
    project(world)
    world.fileContents.set(`${ROOT}/${SLUG_TEST}`, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL

    const red = await runBash($, `npx vitest run ${SLUG_TEST}`)
    const edit = await editAt($, 'src/lib/io.ts')

    expect(red.context?.join(' ')).toMatch(/io unlocked by a red run of its own test/)
    expect(edit.deny).toBeUndefined()
  })
})

describe('a module with its own test (#25)', () => {
  const IO_TEST = 'test/io.test.ts'
  const IO_FAIL = ' FAIL  test/io.test.ts > writes\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'
  const IO_PASS = ' ✓ test/io.test.ts (1 test)\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n'
  const withOwnTest = (world: FakeWorld) => {
    project(world)
    world.fileContents.set(`${ROOT}/${IO_TEST}`, 'import { slugify } from "../src/lib/io.js";\nit("writes", () => { expect(slugify("a")).toBe("a") })\n')
  }

  test('is not unlocked by another test that imports it: its own test comes first', async ($, on) => {
    const world = fakeEngine(on)
    withOwnTest(world)

    const touched = await writeAt($, SLUG_TEST, TEST_TEXT)
    const edit = await editAt($, 'src/lib/io.ts')

    expect(touched.context?.join(' ') ?? '').not.toMatch(/the test for that module too/)
    expect(edit.deny).toMatch(/write the failing test first\. Touch test\/io\.test\.ts/)
  })

  test('is not unlocked by a red run of another test that imports it', async ($, on) => {
    const world = fakeEngine(on)
    withOwnTest(world)
    world.fileContents.set(`${ROOT}/${SLUG_TEST}`, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL

    await runBash($, `npx vitest run ${SLUG_TEST}`)
    const edit = await editAt($, 'src/lib/io.ts')

    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('when its own test misses the change, a test that imports it is tried, and the one that caught it is named', async ($, on) => {
    const world = fakeEngine(on)
    withOwnTest(world)
    // The session saw slugify.test.ts import io, then works on io through io's own test.
    await writeAt($, SLUG_TEST, TEST_TEXT)
    await writeAt($, IO_TEST, 'import { slugify } from "../src/lib/io.js";\nit("writes", () => { expect(slugify("Café")).toBe("cafe") })\n')
    world.bashFails = true
    world.bashText = IO_FAIL
    await runBash($, `npx vitest run ${IO_TEST}`)
    await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = IO_PASS
    // With the change undone, io's own test still passes; slugify's fails.
    world.onCatchRun = () => {
      const ran = world.gitCalls.at(-1)?.at(-1)
      world.catchRun = ran === SLUG_TEST ? { text: FAIL, exitCode: 1 } : { text: IO_PASS, exitCode: 0 }
    }
    const green = await runBash($, `npx vitest run ${IO_TEST}`)
    const status = await runCommand($, 'tdd')

    expect(green.context?.join(' ')).toMatch(/its own test, test\/io\.test\.ts, does not catch the change, but test\/slugify\.test\.ts does: CAUGHT by test\/slugify\.test\.ts\./)
    expect(status.text).toMatch(/caught 1/)
    expect(status.text).toMatch(/missed 0/)
  })

  test('a test that imports it is known from a red run too, not only from a touch', async ($, on) => {
    const world = fakeEngine(on)
    withOwnTest(world)
    world.fileContents.set(`${ROOT}/${SLUG_TEST}`, TEST_TEXT)
    world.bashFails = true
    world.bashText = FAIL
    await runBash($, `npx vitest run ${SLUG_TEST}`)
    await writeAt($, IO_TEST, 'import { slugify } from "../src/lib/io.js";\nit("writes", () => { expect(slugify("Café")).toBe("cafe") })\n')
    world.bashText = IO_FAIL
    await runBash($, `npx vitest run ${IO_TEST}`)
    await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = IO_PASS
    world.onCatchRun = () => {
      const ran = world.gitCalls.at(-1)?.at(-1)
      world.catchRun = ran === SLUG_TEST ? { text: FAIL, exitCode: 1 } : { text: IO_PASS, exitCode: 0 }
    }
    const green = await runBash($, `npx vitest run ${IO_TEST}`)

    expect(green.context?.join(' ')).toMatch(/CAUGHT by test\/slugify\.test\.ts/)
  })

  test('when neither its own test nor a test that imports it catches the change, it is MISSED', async ($, on) => {
    const world = fakeEngine(on)
    withOwnTest(world)
    await writeAt($, SLUG_TEST, TEST_TEXT)
    await writeAt($, IO_TEST, 'import { slugify } from "../src/lib/io.js";\nit("writes", () => { expect(slugify("Café")).toBe("cafe") })\n')
    world.bashFails = true
    world.bashText = IO_FAIL
    await runBash($, `npx vitest run ${IO_TEST}`)
    await $.tool.call({ tool: 'Edit', file_path: IO, old_string: 'return t', new_string: 'return t.normalize("NFD")' } as never)
    world.bashFails = false
    world.bashText = IO_PASS
    world.catchRun = { text: IO_PASS, exitCode: 0 }
    await runBash($, `npx vitest run ${IO_TEST}`)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/missed 1/)
    const checked = world.gitCalls.filter(argv => argv.some(arg => arg.includes('vitest.mjs'))).map(argv => argv.at(-1))
    expect(checked).toContain(SLUG_TEST)
    // Its own test runs once for the baseline and once for the check, never again as one of its importers.
    expect(checked.filter(test => test === IO_TEST)).toHaveLength(2)
  })
})
