import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { editAt, fakeEngine, runCommand, test } from './engine'

function tdd($: Engine, args: string) {
  return $.command.run({ command: 'tdd', args } as never)
}

const PAUSE = 'pause 30 pairing on the prod incident in #301 and back after'

// There is no off switch (override v1, 2026-10-18): a pause takes a time and a reason, and ends by itself.
describe('/tdd off, /tdd pause and /tdd on', () => {
  test('off changes nothing and says how to pause instead', async ($, on) => {
    fakeEngine(on)

    const off = await tdd($, 'off')
    const edit = await editAt($, 'src/utils/a.ts')

    expect(off.text).toMatch(/no off switch/)
    expect(off.text).toMatch(/\/tdd pause <minutes> <reason>/)
    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('a pause lets an untested edit through, uncounted, with the pause on the record', async ($, on) => {
    fakeEngine(on)

    await tdd($, PAUSE)
    const edit = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeUndefined()
    expect(status.text).toMatch(/guard: PAUSED/)
    expect(status.text).toMatch(/unguarded 0 · blocked 0/)
    expect(status.text).toMatch(/workarounds: 1 \(paused 1\)/)
    expect(status.text).toMatch(/pause {2}pause · other {2}approved by human/)
  })

  test('on ends the pause early, and the next untested edit is refused', async ($, on) => {
    fakeEngine(on)

    await tdd($, PAUSE)
    const back = await tdd($, 'ON')
    const edit = await editAt($, 'src/utils/a.ts')

    expect(back.text).toMatch(/dope-tdd is on/)
    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('saying on twice changes nothing and counts nothing twice', async ($, on) => {
    fakeEngine(on)

    const alreadyOn = await tdd($, 'on')
    await tdd($, PAUSE)
    await tdd($, 'on')
    const again = await tdd($, 'resume')
    const status = await runCommand($, 'tdd')

    expect(alreadyOn.text).toMatch(/already on/)
    expect(again.text).toMatch(/already on/)
    expect(status.text).toMatch(/workarounds: 1 \(paused 1\)/)
  })
})
