import { describe, expect } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, test } from './engine'

// #53: the test a refusal names is the file the agent will create. In a plain-JS repo it must end in .js, or the
// agent writes a .ts test that `node --test` never runs.
describe('a refusal names the test with the extension of the source being edited', () => {
  test('an Edit to a .js source names a .js test', async ($, on) => {
    fakeEngine(on)

    const result = await editAt($, 'src/utils/a.js')

    expect(result.deny).toMatch(/Touch tests\/utils\/a\.test\.js,/)
    expect(result.deny).not.toMatch(/ts\(x\)/)
  })

  test('an Edit to a .tsx source names a .tsx test', async ($, on) => {
    fakeEngine(on)

    const result = await editAt($, 'src/components/Clock.tsx')

    expect(result.deny).toMatch(/Touch tests\/components\/Clock\.test\.tsx,/)
  })

  test('a shell write names the test with that file\'s extension', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, "sed -i 's/a/b/' src/utils/a.mjs")

    expect(result.deny).toMatch(/tests\/utils\/a\.test\.mjs/)
    expect(result.deny).not.toMatch(/ts\(x\)/)
  })

  test('under a custom layout with tests in test/, a root-level .js file names test/<name>.test.js', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"stack":"node","layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"}}')

    const result = await editAt($, 'helpers.js')

    expect(result.deny).toMatch(/Touch test\/helpers\.test\.js,/)
  })

  test('in warn mode the reminder after the edit names the .js test too', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"warn"}')

    const result = await editAt($, 'src/utils/a.js')

    expect(result.context?.join(' ')).toMatch(/Write tests\/utils\/a\.test\.js next/)
  })
})
