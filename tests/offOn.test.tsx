import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { editAt, fakeEngine, runCommand, test } from './engine'

function tdd($: Engine, args: string) {
  return $.command.run({ command: 'tdd', args } as never)
}

describe('/tdd off and /tdd on', () => {
  test('off lets an untested edit through, uncounted, with the pause on the record', async ($, on) => {
    fakeEngine(on)

    const off = await tdd($, 'off')
    const edit = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(off.text).toMatch(/dope-tdd is off for this conversation/)
    expect(off.text).toMatch(/\/tdd on/)
    expect(edit.deny).toBeUndefined()
    expect(status.text).toMatch(/guard: PAUSED/)
    expect(status.text).toMatch(/unguarded 0 · blocked 0/)
    expect(status.text).toMatch(/workarounds: 1 \(paused 1\)/)
  })

  test('on turns the guard back on, and the next untested edit is refused', async ($, on) => {
    fakeEngine(on)

    await tdd($, 'off')
    const back = await tdd($, 'ON')
    const edit = await editAt($, 'src/utils/a.ts')

    expect(back.text).toMatch(/dope-tdd is on/)
    expect(edit.deny).toMatch(/write the failing test first/)
  })

  test('saying it twice changes nothing and counts nothing twice', async ($, on) => {
    fakeEngine(on)

    const alreadyOn = await tdd($, 'on')
    await tdd($, 'off')
    const alreadyOff = await tdd($, 'off')
    const status = await runCommand($, 'tdd')

    expect(alreadyOn.text).toMatch(/already on/)
    expect(alreadyOff.text).toMatch(/already off/)
    expect(status.text).toMatch(/workarounds: 1 \(paused 1\)/)
  })
})
