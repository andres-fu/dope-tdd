import { describe, expect } from 'claude-code/testing'

import { OVERRIDE_HINT } from '../hooks/refusals'

import { BAND, ROOT, editAt, fakeEngine, runBash, runCommand, runTests, test, writeAt } from './engine'
import type { FakeWorld } from './engine'

function configure(world: FakeWorld, json: string) {
  world.fileContents.set(`${ROOT}/dope-tdd.json`, json)
}

async function setup($: Parameters<typeof runCommand>[0], args: string) {
  return $.command.run({ command: 'tdd', args } as never)
}

async function setupText($: Parameters<typeof runCommand>[0]): Promise<{ text: string }> {
  return (await setup($, 'setup')) as { text: string }
}

describe('colocated tests', () => {
  test('the deny names the test next to the source, and that test unlocks it', async ($, on) => {
    const world = fakeEngine(on)
    configure(world, '{"layout":"colocated"}')

    const blocked = await editAt($, 'src/utils/a.ts')
    const touched = await writeAt($, 'src/utils/a.test.ts', "it('x', () => { expect(1).toBe(1) })")
    const allowed = await editAt($, 'src/utils/a.ts')

    expect(blocked.deny?.split('\n')[0]).toBe('dope-tdd: write the failing test first. Touch src/utils/a.test.ts, or run it and see it fail, before editing src/utils/a.')
    expect(blocked.deny?.split('\n')).toContain(OVERRIDE_HINT)
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
    expect(status.text).toMatch(/proven 1/)
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
    expect(status.text).toMatch(/proven 1/)
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
    expect(result.text).toMatch(/^test command: npx vitest run <test file>$/m)
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

// #167, seen adopting dope-tdd in an Astro site: no dope-tdd.json, tests beside their sources in site/. The default
// layout matched no file, so nothing was ever refused and nothing said why.
describe('a default layout that matches none of the code', () => {
  async function briefing($: Parameters<typeof runCommand>[0]): Promise<string> {
    const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Bash'], outputStyle: null, traits: [] })
    return composed.sections.find(section => section.id === 'dope-tdd:briefing')?.text ?? ''
  }

  test('with a marker, it is said in the briefing with the layout /tdd setup finds, as it always was (#167)', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/package.json`)
    world.existingFiles.add(`${ROOT}/site/package.json`)
    world.fileContents.set(`${ROOT}/site/src/lib/countup.ts`, 'export const a = 1')
    world.fileContents.set(`${ROOT}/site/src/lib/countup.test.ts`, "it('counts', () => {})")

    const text = await briefing($)
    expect(text).toMatch(/The default layout matches none of this project's code/)
    expect(text).toMatch(/colocated \(src\/\{module\}\.\{ext\} ↔ src\/\{module\}\.test\.\{ext\}\) under site/)
  })

  // #268: a project with no config and no marker used to run as Node, whatever it held.
  test('with neither a config nor a marker, the session reads the repo and guards with it', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/db.py`, 'y = 1')

    expect(await briefing($)).toMatch(/read from its code as python/)
    const blocked = await editAt($, 'api.py')
    expect(blocked.deny).toMatch(/Touch tests\/test_api\.py/)
    expect(world.fileContents.has(`${ROOT}/dope-tdd.json`)).toBe(false)
  })

  test('a layout read from the repo guards there, where the default paired nothing', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/site/package.json`)
    world.fileContents.set(`${ROOT}/site/src/lib/countup.ts`, 'export const a = 1')
    world.fileContents.set(`${ROOT}/site/src/lib/countup.test.ts`, "it('counts', () => {})")

    expect(await briefing($)).toMatch(/read from its code as node/)
    const blocked = await editAt($, 'site/src/lib/countup.ts')
    expect(blocked.deny).toMatch(/write the failing test first/)
  })

  test('a language it does not read is said, not called empty', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/main.go`, 'package main')
    world.fileContents.set(`${ROOT}/util.go`, 'package main')

    expect(await briefing($)).toMatch(/doesn't read Go yet/)
  })

  test('a config saved during the session stops the note about having none', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    expect(await briefing($)).toMatch(/No dope-tdd\.json here/)

    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"stack":"python","layout":"package"}')
    expect(await briefing($)).not.toMatch(/No dope-tdd\.json here/)
  })

  test('/tdd setup agrees with the stack the session is running on, and says why', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/tests/test_api.py`, 'def test_x(): pass')
    await briefing($)

    const { text } = await setupText($)
    expect(text).toMatch(/detected stack: python \(2 python files, no marker at the root\)/)
    expect(text).not.toMatch(/runs as node/)
    expect(text).not.toMatch(/named in/)
  })

  test('a C# repo is .NET in the briefing and in /tdd setup, never Godot', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/App.sln`)
    world.fileContents.set(`${ROOT}/MyApp/Service.cs`, 'class Service {}')
    world.fileContents.set(`${ROOT}/MyApp/Util.cs`, 'class Util {}')
    world.fileContents.set(`${ROOT}/MyApp.Tests/ServiceTests.cs`, 'class ServiceTests {}')

    expect(await briefing($)).not.toMatch(/godot/i)
    expect((await setupText($)).text).toMatch(/detected stack: dotnet \(3 dotnet files, no marker at the root\)/)
  })

  test('C# beside other code is .NET too, so saving never pins Godot', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/App.sln`)
    for (const file of ['Api/Service.cs', 'Api/Util.cs', 'Api/Repo.cs', 'web/src/a.ts', 'web/src/b.ts']) {
      world.fileContents.set(`${ROOT}/${file}`, 'x')
    }

    expect(await briefing($)).not.toMatch(/godot/i)
    expect((await setupText($)).text).toMatch(/detected stack: dotnet \(3 dotnet files, no marker at the root\)/)
    await setup($, 'setup write')
    expect(world.fileContents.get(`${ROOT}/dope-tdd.json`)).toMatch(/"stack": "dotnet"/)
  })

  test('with a marker, /tdd setup leaves the reading out: the marker decides, as it always did', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/package.json`)
    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/db.py`, 'y = 1')

    const { text } = await setupText($)
    expect(text).toMatch(/detected stack: node \(package\.json at the root\)/)
    expect(text).not.toMatch(/python/)
  })

  test('after /tdd setup the next briefing looks at a marked project again, as it always did', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/package.json`)
    world.existingFiles.add(`${ROOT}/site/package.json`)
    world.fileContents.set(`${ROOT}/site/src/lib/countup.ts`, 'export const a = 1')
    expect(await briefing($)).toMatch(/default layout matches none/)

    await setupText($)
    world.fileContents.set(`${ROOT}/src/x.ts`, 'export const x = 1')

    expect(await briefing($)).not.toMatch(/default layout matches none/)
  })

  test('after /tdd setup a marked project that lost its paired file is warned again', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/package.json`)
    world.existingFiles.add(`${ROOT}/site/package.json`)
    world.fileContents.set(`${ROOT}/site/src/lib/countup.ts`, 'export const a = 1')
    world.fileContents.set(`${ROOT}/src/x.ts`, 'export const x = 1')
    expect(await briefing($)).not.toMatch(/default layout matches none/)

    await setupText($)
    world.fileContents.delete(`${ROOT}/src/x.ts`)

    expect(await briefing($)).toMatch(/default layout matches none/)
  })

  test('/tdd setup reads a project with nothing to go on again', async ($, on) => {
    const world = fakeEngine(on)
    expect(await briefing($)).toMatch(/No code Dope TDD reads/)

    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/db.py`, 'y = 1')
    await setupText($)

    expect(await briefing($)).toMatch(/read from its code as python/)
  })

  test('a broken config saved after a reading still says nothing is guarded (#214)', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/site/package.json`)
    world.fileContents.set(`${ROOT}/site/src/lib/countup.ts`, 'export const a = 1')
    world.fileContents.set(`${ROOT}/site/src/lib/countup.test.ts`, "it('counts', () => {})")
    await briefing($)

    configure(world, 'not json {')

    expect(await briefing($)).toMatch(/default layout matches none/)
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(JSON.stringify(await ui.drawn())).toMatch(/ignored, and the default layout matches none of this project's code, so nothing is guarded/)
  })

  test('the project is walked once, however many hooks ask', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/lib/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/lib/db.py`, 'y = 1')

    await briefing($)
    await editAt($, 'lib/api.py')
    await briefing($)

    expect(world.listed.filter(dir => dir === `${ROOT}/lib`)).toHaveLength(1)
  })

  test('a language off the list is not called no code', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/main.lua`, 'print(1)')
    world.fileContents.set(`${ROOT}/run.sh`, 'echo 1')

    const text = await briefing($)
    expect(text).not.toMatch(/No code yet/)
    expect(text).toMatch(/any other code is not guarded/)
  })

  test('readable code beside a language it does not read is said to be unguarded too', async ($, on) => {
    const world = fakeEngine(on)
    for (const file of ['lib/a.py', 'lib/b.py', 'lib/c.py', 'x.go', 'y.go', 'z.go', 'w.go']) {
      world.fileContents.set(`${ROOT}/${file}`, 'x')
    }

    const text = await briefing($)
    expect(text).toMatch(/doesn't read Go yet/)
    expect(text).toMatch(/The python code here isn't guarded either\. \/tdd setup write guards one stack, the one with the most code/)
  })

  test('a mixed project keeps the warning that no edit is refused (#167)', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/web/src/a.ts`, 'export const a = 1')
    world.fileContents.set(`${ROOT}/api.py`, 'x = 1')
    world.fileContents.set(`${ROOT}/db.py`, 'y = 1')

    const text = await briefing($)
    expect(text).toMatch(/mixes/)
    expect(text).toMatch(/no edit is refused/)
  })

  test('is not said when the default pairs the code', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/src/utils/a.ts`, 'export const a = 1')

    expect(await briefing($)).not.toMatch(/default layout matches none/)
  })
})
