import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { guideKey } from '../hooks/fieldGuide'
import { FIXTURE_DRIVE, ROOT, fakeEngine, startSession } from './engine'

const HOME = `${FIXTURE_DRIVE}Users/tester`
const GUIDE = `${HOME}/.dope-tdd/guides/Atom-Powell__Roadhouse-Game.md`
const RULES = '- When you add tests, bump EXPECTED_MIN_TOTAL and all three counts in the ARCHITECTURE.md paragraph.\n- `bash test/run-tests.sh` is the only trusted full run.\n'

type Sections = { sections: { id: string; text: string; scope: string }[] }

async function compose($: Engine): Promise<Sections> {
  return (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Bash'], outputStyle: null, traits: [] })) as Sections
}

describe('guideKey', () => {
  test('names the repository from its remote, https or ssh, with or without .git', () => {
    expect(guideKey('https://github.com/Atom-Powell/Roadhouse-Game.git', 'C:/x/clone')).toBe('Atom-Powell__Roadhouse-Game')
    expect(guideKey('git@github.com:Ironwright-Labs/DungeonLobby.git', 'C:/x/clone')).toBe('Ironwright-Labs__DungeonLobby')
    expect(guideKey('https://gitlab.com/group/sub/app', 'C:/x/clone')).toBe('sub__app')
  })

  test('with no remote, the folder name', () => {
    expect(guideKey(null, 'C:/work/throughline')).toBe('throughline')
    expect(guideKey(null, 'C:\\work\\throughline\\')).toBe('throughline')
  })
})

describe("a repository's field guide in the briefing", () => {
  test('the house rules from the guide are a section of their own, found through the upstream remote, so a fork and its worktrees share one guide', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.remotes.set('origin', 'https://github.com/andres-fu/Roadhouse-Game.git')
    world.remotes.set('upstream', 'https://github.com/Atom-Powell/Roadhouse-Game.git')
    world.fileContents.set(GUIDE, RULES)
    await startSession($)

    const guide = (await compose($)).sections.find(section => section.id === 'dope-tdd:field-guide')

    expect(guide?.scope).toBe('session')
    expect(guide?.text).toMatch(/House rules for Atom-Powell\/Roadhouse-Game/)
    expect(guide?.text).toContain('EXPECTED_MIN_TOTAL')
    expect(guide?.text).toContain('bash test/run-tests.sh')
  })

  test('the remote is asked once per session, not on every prompt', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.remotes.set('upstream', 'https://github.com/Atom-Powell/Roadhouse-Game.git')
    world.fileContents.set(GUIDE, RULES)
    await startSession($)

    await compose($)
    await compose($)
    await compose($)

    expect(world.gitCalls.filter(argv => argv[1] === 'config').length).toBe(1)
  })

  test('no guide, no section; the briefing is unchanged', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.remotes.set('origin', 'https://github.com/Atom-Powell/Roadhouse-Game.git')
    await startSession($)

    const sections = (await compose($)).sections

    expect(sections.some(section => section.id === 'dope-tdd:field-guide')).toBe(false)
    expect(sections.some(section => section.id === 'dope-tdd:briefing')).toBe(true)
  })

  test('observe mode measures the agent on its own, so it gets no guide either', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.remotes.set('origin', 'https://github.com/Atom-Powell/Roadhouse-Game.git')
    world.fileContents.set(GUIDE, RULES)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"observe"}')
    await startSession($)

    expect((await compose($)).sections.some(section => section.id === 'dope-tdd:field-guide')).toBe(false)
  })

  test('a project with no remote is found by its folder name', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${HOME}/.dope-tdd/guides/throughline.md`, '- Money is always in cents.\n')
    await startSession($)

    const guide = (await compose($)).sections.find(section => section.id === 'dope-tdd:field-guide')

    expect(guide?.text).toContain('Money is always in cents.')
  })
})
