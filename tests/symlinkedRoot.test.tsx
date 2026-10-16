import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FIXTURE_DRIVE, ROOT, fakeEngine, runBash } from './engine'
import type { FakeWorld } from './engine'

/** The project reached through a symbolic link, as macOS reaches /private/tmp through /tmp, or a symlinked checkout. */
const LINKED = `${FIXTURE_DRIVE}link/throughline`

function linked(world: FakeWorld) {
  world.links.set(LINKED, ROOT)
}

function editThrough($: Engine, path: string) {
  return $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' } as never)
}

describe('a file reached through a symbolic link is still the project\'s', () => {
  test('an edit to untested source through the link is refused, not let through as outside the project', async ($, on) => {
    linked(fakeEngine(on))

    const edit = await editThrough($, `${LINKED}/src/utils/a.ts`)

    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('a new file written through the link is refused the same way', async ($, on) => {
    linked(fakeEngine(on))

    const write = await $.tool.call({ tool: 'Write', file_path: `${LINKED}/src/utils/fresh.ts`, content: 'x' } as never)

    expect(write.deny).toMatch(/write the failing test first/)
  })

  test('a test touched through the link unlocks its module for an edit through the root', async ($, on) => {
    const world = fakeEngine(on)
    linked(world)
    world.existingFiles.add(`${ROOT}/tests/utils/a.test.ts`)

    await editThrough($, `${LINKED}/tests/utils/a.test.ts`)
    const edit = await editThrough($, `${ROOT}/src/utils/a.ts`)

    expect(edit.deny).toBeUndefined()
  })

  test('a shell write through the link is refused', async ($, on) => {
    linked(fakeEngine(on))

    const sed = await runBash($, `sed -i 's/a/b/' ${LINKED}/src/App.tsx`)

    expect(sed.deny).toMatch(/write the failing test first/)
  })

  test('a path that really is elsewhere stays elsewhere', async ($, on) => {
    linked(fakeEngine(on))

    const edit = await editThrough($, `${FIXTURE_DRIVE}other/repo/src/utils/a.ts`)

    expect(edit.deny).toBeUndefined()
  })
})
