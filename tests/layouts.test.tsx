import { describe, expect } from 'claude-code/testing'

import { OVERRIDE_HINT } from '../hooks/refusals'

import { ROOT, editAt, fakeEngine, runBash, runCommand, runTests, test, writeAt } from './engine'
import type { FakeWorld } from './engine'

function configure(world: FakeWorld, json: string) {
  world.fileContents.set(`${ROOT}/dope-tdd.json`, json)
}

async function setup($: Parameters<typeof runCommand>[0], args: string) {
  return $.command.run({ command: 'tdd', args } as never)
}

describe('colocated tests', () => {
  test('the deny names the test next to the source, and that test unlocks it', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"colocated"}')

    const blocked = await editAt($, 'src/utils/a.ts')
    const touched = await writeAt($, 'src/utils/a.test.ts', "it('x', () => { expect(1).toBe(1) })")
    const allowed = await editAt($, 'src/utils/a.ts')

    expect(blocked.deny.split('\n')[0]).toBe('dope-tdd: write the failing test first. Touch src/utils/a.test.ts, or run it and see it fail, before editing src/utils/a.')
    expect(blocked.deny.split('\n')).toContain(OVERRIDE_HINT)
    expect(touched.context?.join(' ')).toMatch(/utils\/a unlocked\. Run its test and see it fail before editing src\/utils\/a\./)
    expect(allowed.deny).toBeUndefined()
  })

  test('a run that names the colocated test file makes its module current, and the catch check runs that file', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"colocated"}')
    world.fileContents.set(`${ROOT}/src/utils/a.ts`, 'export const a = 1')
    await writeAt($, 'src/utils/a.test.ts', 'expect(a).toBe(2)')
    await runTests($, world, 'fail')
    await editAt($, 'src/utils/a.ts')
    world.bashFails = false

    await runBash($, 'npx vitest run src/utils/a.test.ts')
    const status = await runCommand($, 'tdd')

    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run?.[3]).toBe('src/utils/a.test.ts')
    expect(status.text).toMatch(/caught 1/)
  })

  test('git is asked about src only', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"colocated"}')

    await runBash($, './scripts/codemod.sh')

    const numstat = world.gitCalls.find(argv => argv.includes('--numstat'))
    expect(numstat?.slice(-1)).toEqual(['src'])
  })
})

describe('__tests__ folders', () => {
  test('a test in __tests__ beside the source unlocks it, and the deny names that path', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"__tests__"}')

    const blocked = await editAt($, 'src/utils/a.ts')
    await writeAt($, 'src/utils/__tests__/a.test.ts', 'expect(a).toBe(1)')
    const allowed = await editAt($, 'src/utils/a.ts')

    expect(blocked.deny).toMatch(/Touch src\/utils\/__tests__\/a\.test\.ts, or run it and see it fail, before editing src\/utils\/a\./)
    expect(allowed.deny).toBeUndefined()
  })
})

describe('a runner installed in the package, not hoisted', () => {
  test('is found from the test file, and the check runs from that package with the path relative to it', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    configure(world, '{"roots":["server"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.existingFiles.add(`${ROOT}/server/node_modules/vitest/vitest.mjs`)
    world.fileContents.set(`${ROOT}/server/src/utils/dice.ts`, 'export const a = 1')

    await writeAt($, 'server/src/__tests__/utils/dice.test.ts', "it('x', () => { expect(1).toBe(2) })")
    world.bashFails = true
    await runBash($, 'npx vitest run server/src/__tests__/utils/dice.test.ts')
    await editAt($, 'server/src/utils/dice.ts')
    world.bashFails = false
    await runBash($, 'npx vitest run server/src/__tests__/utils/dice.test.ts')
    const status = await runCommand($, 'tdd')

    const at = world.gitCalls.findIndex(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(world.gitCalls[at]).toEqual(['node', `${ROOT}/server/node_modules/vitest/vitest.mjs`, 'run', 'src/__tests__/utils/dice.test.ts'])
    expect(world.runCwds[at]).toBe(`${ROOT}/server`)
    expect(status.text).toMatch(/caught 1/)
  })
})

describe('a workspace run names its package', () => {
  const FAIL_IN_PACKAGE = ' FAIL  src/__tests__/utils/dice.test.ts > rolls\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'

  test('npm test -w server: the failed path is the server package’s, so the red lands on its module', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["client","server"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.existingFiles.add(`${ROOT}/server/package.json`)
    world.existingFiles.add(`${ROOT}/server/src/__tests__/utils/dice.test.ts`)
    world.bashFails = true
    world.bashText = FAIL_IN_PACKAGE

    const red = await runBash($, 'npm test -w server')
    const status = await runCommand($, 'tdd')

    expect(red.context?.join(' ')).toMatch(/server\/utils\/dice unlocked by a red run/)
    expect(status.text).not.toMatch(/elsewhere/)
  })

  test('pnpm --filter by package name: found through each package’s package.json', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["packages/*"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.fileContents.set(`${ROOT}/packages/game-server/package.json`, '{ "name": "@acme/server" }')
    world.fileContents.set(`${ROOT}/packages/web/package.json`, '{ "name": "@acme/web" }')
    world.existingFiles.add(`${ROOT}/packages/game-server/src/__tests__/utils/dice.test.ts`)
    world.bashFails = true
    world.bashText = FAIL_IN_PACKAGE

    const red = await runBash($, 'pnpm --filter @acme/server test')

    expect(red.context?.join(' ')).toMatch(/packages\/game-server\/utils\/dice unlocked by a red run/)
  })
})

describe('package roots', () => {
  test('each package is its own project; a test in one does not unlock the same module in another', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["packages/*"]}')

    await writeAt($, 'packages/app/tests/utils/a.test.ts', 'expect(a).toBe(1)')
    const app = await editAt($, 'packages/app/src/utils/a.ts')
    const web = await editAt($, 'packages/web/src/utils/a.ts')
    const outside = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(app.deny).toBeUndefined()
    expect(web.deny).toMatch(/Touch packages\/web\/tests\/utils\/a\.test\.ts, or run it and see it fail, before editing packages\/web\/src\/utils\/a\./)
    expect(outside.deny).toBeUndefined()
    expect(status.text).toMatch(/module: packages\/app\/utils\/a/)
    expect(status.text).toMatch(/roots: packages\/\*/)
  })

  test('git is asked about the roots directory', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["packages/*"]}')

    await runBash($, './scripts/codemod.sh')

    const numstat = world.gitCalls.find(argv => argv.includes('--numstat'))
    expect(numstat?.slice(-1)).toEqual(['packages'])
  })
})

describe('custom templates', () => {
  test('lib/ and spec/ can be paired by two templates', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":{"source":"lib/{module}.{ext}","test":"spec/{module}.spec.{ext}"}}')

    const blocked = await editAt($, 'lib/money.ts')
    await writeAt($, 'spec/money.spec.ts', 'expect(1).toBe(1)')
    const allowed = await editAt($, 'lib/money.ts')
    const status = await runCommand($, 'tdd')

    expect(blocked.deny).toMatch(/Touch spec\/money\.spec\.ts, or run it and see it fail, before editing lib\/money\./)
    expect(allowed.deny).toBeUndefined()
    expect(status.text).toMatch(/layout: custom \(lib\/\{module\}\.\{ext\} ↔ spec\/\{module\}\.spec\.\{ext\}\)/)
  })

  test('a bad layout falls back to mirror and the status says why', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"nested"}')

    const blocked = await editAt($, 'src/utils/a.ts')
    const status = await runCommand($, 'tdd')

    expect(blocked.deny).toMatch(/Touch tests\/utils\/a\.test\.ts/)
    expect(status.text).toMatch(/config: dope-tdd\.json: layout must be one of/)
  })
})

describe('/tdd setup', () => {
  test('reads the project and shows the layout it finds, with the JSON to write', async ($, on) => {
    const world = fakeEngine(on)
    for (const file of ['src/utils/a.ts', 'src/utils/a.test.ts', 'src/b.test.ts', 'package.json', 'node_modules/vitest/index.js']) {
      world.existingFiles.add(`${ROOT}/${file}`)
    }

    const result = await setup($, 'setup')

    expect(result.text).toMatch(/detected layout: colocated .*; 2 of 2 test files sit next to their source/)
    expect(result.text).toMatch(/  src\/utils\/a\.test\.ts ↔ src\/utils\/a\.ts/)
    expect(result.text).toMatch(/current dope-tdd\.json: none \(mirror by default\)/)
    expect(result.text).toMatch(/"layout": "colocated"/)
    expect(world.writes).toEqual([])
  })

  test('setup write saves the config, keeps the mode, records it, and the guard follows it at once', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"mode":"warn","layout":"__tests__"}')
    for (const file of ['src/utils/a.ts', 'src/utils/a.test.ts', 'package.json']) {
      world.existingFiles.add(`${ROOT}/${file}`)
    }

    const result = await setup($, 'setup write')
    const status = await runCommand($, 'tdd')
    const edit = await editAt($, 'src/utils/a.ts')

    expect(result.text).toMatch(/written: dope-tdd\.json \(layout __tests__ → colocated\)/)
    expect(world.fileContents.get(`${ROOT}/dope-tdd.json`)).toBe('{\n  "mode": "warn",\n  "layout": "colocated"\n}\n')
    expect(status.text).toMatch(/config\s+\(setup: layout __tests__ → colocated\)/)
    expect(status.text).not.toMatch(/workarounds/)
    expect(world.toasts.some(t => /dope-tdd\.json written/.test(t))).toBe(true)
    expect(edit.context?.join(' ')).toMatch(/Write src\/utils\/a\.test\.ts next/)
  })

  test('finds sibling packages and suggests a roots glob', async ($, on) => {
    const world = fakeEngine(on)
    for (const file of ['package.json', 'packages/app/package.json', 'packages/app/src/a.ts', 'packages/app/tests/a.test.ts', 'packages/web/package.json', 'packages/web/src/b.ts']) {
      world.existingFiles.add(`${ROOT}/${file}`)
    }

    const result = await setup($, 'setup')

    expect(result.text).toMatch(/detected roots: packages\/\*/)
    expect(result.text).toMatch(/"roots": \[\n\s+"packages\/\*"\n\s+\]/)
  })
})

describe('a command that changes directory', () => {
  test('a run from inside a package names that package\u2019s test, so the red lands on the module and not elsewhere', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["client","server"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.existingFiles.add(`${ROOT}/server/src/__tests__/utils/dice.test.ts`)
    world.bashFails = true
    world.bashText = ' FAIL  src/__tests__/utils/dice.test.ts\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'

    await runBash($, 'cd server && npx vitest run src/__tests__/utils/dice.test.ts')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
    expect(status.text).toMatch(/module: server\/utils\/dice/)
    expect(status.text).not.toMatch(/elsewhere/)
  })

  test('the shell keeps its directory between calls: a cd in one call moves the run in the next', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["client","server"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.existingFiles.add(`${ROOT}/server/src/__tests__/utils/dice.test.ts`)

    await runBash($, 'cd server')
    world.bashFails = true
    world.bashText = ' FAIL  src/__tests__/utils/dice.test.ts\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'
    await runBash($, 'npx vitest run src/__tests__/utils/dice.test.ts')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
    expect(status.text).toMatch(/module: server\/utils\/dice/)
  })

  test('a cd out of the project resets to the root, as Claude Code resets the shell', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"roots":["client","server"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    world.existingFiles.add(`${ROOT}/server/src/__tests__/utils/dice.test.ts`)

    await runBash($, 'cd server')
    await runBash($, 'cd ../../elsewhere')
    world.bashFails = true
    world.bashText = ' FAIL  server/src/__tests__/utils/dice.test.ts\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'
    await runBash($, 'npx vitest run server/src/__tests__/utils/dice.test.ts')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/module: server\/utils\/dice/)
  })

  test('a run in another repository is not this project\u2019s run', async ($, on) => {
    const world = fakeEngine(on)
    world.bashFails = true

    await runBash($, 'cd ../other && npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/runs: 0/)
    expect(status.text).not.toMatch(/phase: RED/)
  })
})

describe('a module in a folder with a layout of its own is named by its real path (#24)', () => {
  const VIBE = '{"layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"},"layouts":{"dashboard":"colocated"}}'

  test('the advice, the status, the events and the receipt all say dashboard/src/lib/pkce, as the refusal does', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, VIBE)
    world.fileContents.set(`${ROOT}/dashboard/src/lib/pkce.ts`, 'export const pkce = 1')

    const blocked = await editAt($, 'dashboard/src/lib/pkce.ts')
    const touched = await writeAt($, 'dashboard/src/lib/pkce.test.ts', "it('x', () => { expect(pkce).toBe(2) })")
    const red = await runTests($, world, 'fail')
    const status = await runCommand($, 'tdd')
    const receipt = await setup($, 'receipt dashboard/src/lib/pkce')

    expect(blocked.deny).toMatch(/before editing dashboard\/src\/lib\/pkce\./)
    expect(touched.context?.join(' ')).toMatch(/dope-tdd: dashboard\/src\/lib\/pkce unlocked\./)
    expect(red.context?.join(' ')).toMatch(/RED on dashboard\/src\/lib\/pkce\./)
    expect(status.text).toMatch(/module: dashboard\/src\/lib\/pkce\n/)
    expect(status.text).toMatch(/touched +dashboard\/src\/lib\/pkce/)
    expect(status.text).not.toMatch(/dashboard\/lib\/pkce/)
    expect(receipt.text).toMatch(/^dope-tdd receipt for dashboard\/src\/lib\/pkce/)
  })

  test('a test under the main layout never unlocks the folder\'s file of the same name, nor the other way round (review #5)', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"mirror","layouts":{"dashboard":"colocated"}}')

    await writeAt($, 'tests/dashboard/x.test.ts', "it('x', () => { expect(1).toBe(1) })")
    const folderFile = await editAt($, 'dashboard/src/x.ts')
    const mainFile = await editAt($, 'src/dashboard/x.ts')

    expect(folderFile.deny).toMatch(/Touch dashboard\/src\/x\.test\.ts/)
    expect(mainFile.deny).toBeUndefined()
  })

  test('a module outside the folder keeps its name', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, VIBE)

    const touched = await writeAt($, 'test/queueOps.test.js', "it('x', () => { expect(1).toBe(1) })")

    expect(touched.context?.join(' ')).toMatch(/dope-tdd: queueOps unlocked\./)
  })
})
