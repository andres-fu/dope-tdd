import { describe, expect, test } from 'claude-code/testing'

import { BAND, ROOT, SOURCE, editAt, fakeEngine, fixUnderGuard, runBash, runCommand, runTests } from './engine'
import type { FakeWorld } from './engine'

/** A checkout whose .git is a folder, as a person's clone has it, with these markers in it. */
function inProgress(world: FakeWorld, ...markers: string[]) {
  world.existingFiles.add(`${ROOT}/.git/HEAD`)
  for (const marker of markers) {
    world.existingFiles.add(`${ROOT}/.git/${marker}`)
  }
}

function finish(world: FakeWorld, ...markers: string[]) {
  for (const marker of markers) {
    world.existingFiles.delete(`${ROOT}/.git/${marker}`)
  }
}

describe('the guard stands down while a git operation is in progress', () => {
  test('during a rebase an edit to untested source goes through, is not counted, and the agent is told once', async ($, on) => {
    const world = fakeEngine(on)
    inProgress(world, 'rebase-merge')

    const first = await editAt($, 'src/utils/a.ts')
    const second = await editAt($, 'src/utils/b.ts')
    const status = await runCommand($, 'tdd')

    expect(first.deny).toBeUndefined()
    expect(first.context?.join(' ')).toMatch(/git rebase is in progress/)
    expect(second.deny).toBeUndefined()
    expect(second.context).toBeUndefined()
    expect(status.text).toMatch(/standing down: a git rebase is in progress/)
    expect(status.text).toMatch(/unguarded 0 · blocked 0/)
    expect(world.toasts.join(' ')).toMatch(/git rebase/)
  })

  test('during a merge a green run reverts nothing: no catch check, no baseline', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    inProgress(world, 'MERGE_HEAD')

    await runTests($, world, 'pass')

    expect(world.writes.filter(([path]) => path === SOURCE)).toEqual([])
    expect(world.baselineCalls).toBe(0)
    expect((await runCommand($, 'tdd')).text).not.toMatch(/CAUGHT|caught 1/)
  })

  test('when the operation ends the guard is back, and says so once', async ($, on) => {
    const world = fakeEngine(on)
    inProgress(world, 'CHERRY_PICK_HEAD')
    await editAt($, 'src/utils/a.ts')
    finish(world, 'CHERRY_PICK_HEAD')

    const back = await runBash($, 'git status')
    const again = await runBash($, 'git log -1')
    const edit = await editAt($, 'src/utils/b.ts')

    expect(back.context?.join(' ')).toMatch(/git cherry-pick is over; the guard is back on/)
    expect((again.context ?? []).join(' ')).not.toMatch(/back on/)
    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('a linked worktree is read through its .git file', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/.git`, 'gitdir: C:/work/main/.git/worktrees/throughline\n')
    world.existingFiles.add('C:/work/main/.git/worktrees/throughline/BISECT_LOG')

    const edit = await editAt($, 'src/utils/a.ts')

    expect(edit.deny).toBeUndefined()
    expect(edit.context?.join(' ')).toMatch(/git bisect is in progress/)
  })

  test('in observe mode it stands down without saying anything to the agent', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"observe"}')
    inProgress(world, 'rebase-apply', 'rebase-apply/applying')

    const edit = await editAt($, 'src/utils/a.ts')

    expect(edit.context).toBeUndefined()
    expect((await runCommand($, 'tdd')).text).toMatch(/standing down: a git am is in progress/)
  })

  test('the band shows the guard standing down, on both surfaces, even before anything was counted', async ($, on) => {
    const world = fakeEngine(on)
    inProgress(world, 'rebase-merge')
    await runBash($, 'git status')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'dope-tdd', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: '⏸ GIT REBASE' })).toBeDefined()
      await ui.unmount()
    }
  })
})
