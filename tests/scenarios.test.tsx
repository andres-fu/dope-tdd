import { describe, expect, test } from 'claude-code/testing'

import { BAND, editAt, fakeEngine, runCommand, runTests, touchTest } from './engine'

describe('scenario: fixing a bug in code that has no tests', () => {
  test('reproduce it red, fix it green, and the status tells that story', async ($, on) => {
    const world = fakeEngine(on)

    const blocked = await editAt($, 'src/money/formatCents.ts')
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'fail')
    const red = await runCommand($, 'tdd')
    const allowed = await editAt($, 'src/money/formatCents.ts')
    await runTests($, world, 'pass')
    const green = await runCommand($, 'tdd')

    expect(blocked.deny).toMatch(/write the failing test first/)
    expect(red.text).toMatch(/phase: RED/)
    expect(allowed.deny).toBeUndefined()
    expect(green.text).toMatch(/phase: GREEN/)
    expect(green.text).toMatch(/cycles: 1 \(avg .*never saw red 0\)/)
    expect(green.text).toMatch(/test-first: 1\/2 · unguarded 0 · blocked 1/)
  })
})

describe('scenario: pinning behaviour before a refactor', () => {
  test('a test that goes green without ever failing is called out', async ($, on) => {
    const world = fakeEngine(on)

    await touchTest($, world, 'text/wrapLines')
    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/never saw red 1/)
  })

  test('breaking the code on purpose, then restoring it, proves the pin and clears the doubt', async ($, on) => {
    const world = fakeEngine(on)

    await touchTest($, world, 'text/wrapLines')
    await editAt($, 'src/text/wrapLines.ts')
    await runTests($, world, 'fail')
    await editAt($, 'src/text/wrapLines.ts')
    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/cycles: 1 \(avg .*never saw red 0\)/)
    expect(status.text).toMatch(/test-first: 2\/2/)
  })
})

describe('scenario: the escape hatch', () => {
  test('a paused guard allows edits but does not call them test-first', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await ui.press({ key: 'pause' })
    const edit = await editAt($, 'src/cart/applyDiscount.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeUndefined()
    expect(status.text).toMatch(/guard: PAUSED/)
    expect(status.text).toMatch(/test-first: 0\/0/)
  })
})
