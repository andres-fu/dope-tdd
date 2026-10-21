import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ROOT, fakeEngine, test } from './engine'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

async function editAt($: Engine, root: string, relative: string) {
  return $.tool.call({
    tool: 'Edit',
    file_path: `${root}/${relative}`,
    old_string: 'a',
    new_string: 'b',
  } as never)
}

async function writeAt($: Engine, root: string, relative: string) {
  return $.tool.call({
    tool: 'Write',
    file_path: `${root}/${relative}`,
    content: 'x',
  } as never)
}

async function runBash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command } as never)
}

describe('guard', () => {
  test('blocks a src edit whose mirrored test was not touched', async ($, on) => {
    fakeEngine(on)
    const root = ROOT

    const result = await editAt($, root, 'src/utils/formatDuration.ts')

    expect(result.deny).toBeDefined()
    expect(result.deny).toMatch(/tests\/utils\/formatDuration\.test\.ts/)
  })

  test('allows a src edit after its mirrored test was edited', async ($, on) => {
    fakeEngine(on)
    const root = ROOT

    await editAt($, root, 'tests/utils/formatDuration.test.ts')
    const result = await editAt($, root, 'src/utils/formatDuration.ts')

    expect(result.deny).toBeUndefined()
  })

  test('accepts a .tsx test mirroring a .tsx source written fresh', async ($, on) => {
    fakeEngine(on)
    const root = ROOT

    await writeAt($, root, 'tests/components/StatsCard.test.tsx')
    const result = await writeAt($, root, 'src/components/StatsCard.tsx')

    expect(result.deny).toBeUndefined()
  })

  test('accepts Windows-style backslash paths', async ($, on) => {
    fakeEngine(on)
    const root = ROOT.replace(/\//g, '\\')

    await $.tool.call({
      tool: 'Edit',
      file_path: `${root}\\tests\\App.test.tsx`,
      old_string: 'a',
      new_string: 'b',
    } as never)
    const result = await $.tool.call({
      tool: 'Edit',
      file_path: `${root}\\src\\App.tsx`,
      old_string: 'a',
      new_string: 'b',
    } as never)

    expect(result.deny).toBeUndefined()
  })

  test('never blocks files outside src/', async ($, on) => {
    fakeEngine(on)
    const root = ROOT

    const docs = await editAt($, root, 'docs/decisions/note.md')
    const config = await editAt($, root, 'vite.config.ts')

    expect(docs.deny).toBeUndefined()
    expect(config.deny).toBeUndefined()
  })

  test('a test for one module does not unlock another', async ($, on) => {
    fakeEngine(on)
    const root = ROOT

    await editAt($, root, 'tests/utils/formatDuration.test.ts')
    const result = await editAt($, root, 'src/utils/calculateDuration.ts')

    expect(result.deny).toBeDefined()
  })
})
