import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MINUTE, ROOT, SOURCE, T0, editAt, fakeEngine, test } from './engine'
import type { FakeOptions } from './engine'

const TEST = `${ROOT}/tests/utils/formatDuration.test.ts`
const REMEMBERED: FakeOptions = {
  store: { [`unlocks:${ROOT}`]: { 'utils/formatDuration': { testPath: TEST, atMs: T0 - 10 * MINUTE } } },
}

/** The engine with the settings-hook event a /clear raises answered, as Claude Code answers it. */
function engineAfterClear(on: On, options: FakeOptions = {}) {
  const world = fakeEngine(on, options)
  world.existingFiles.add(TEST)
  on('classic.SessionStart', () => ({}) as never)
  return world
}

/** What Claude Code fires after /clear, /resume or /branch: every $.state value is back at its default, and session.start does not run. */
function cleared($: Engine, source: 'clear' | 'resume' | 'fork' | 'compact' = 'clear') {
  return $.classic.SessionStart({ source } as never)
}

describe('after /clear the guard picks up what it remembered', () => {
  test('without the re-seed a remembered unlock is lost and the edit is refused', async ($, on) => {
    engineAfterClear(on, REMEMBERED)

    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toMatch(/write the failing test first/)
  })

  for (const source of ['clear', 'resume', 'fork'] as const) {
    test(`after ${source}, a test touched before is still remembered, so its source can be edited`, async ($, on) => {
      engineAfterClear(on, REMEMBERED)

      await cleared($, source)
      const edit = await editAt($, 'src/utils/formatDuration.ts')

      expect(edit.deny).toBeUndefined()
    })
  }

  test('a compaction keeps $.state, so it re-seeds nothing', async ($, on) => {
    engineAfterClear(on, REMEMBERED)

    await cleared($, 'compact')
    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('a check interrupted before the /clear is repaired', async ($, on) => {
    const world = engineAfterClear(on, {
      store: { [`catch-journal:${ROOT}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await cleared($)

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(world.toasts.some(text => /restored 1 file/.test(text))).toBe(true)
  })
})
