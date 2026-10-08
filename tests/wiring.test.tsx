import { describe, expect, test } from 'claude-code/testing'

import {
  BAND,
  ROOT,
  editAt,
  fakeEngine,
  runBash,
  runCommand,
  runTests,
  startSession,
  touchTest,
} from './engine'

describe('bash bypass', () => {
  test('denies a shell write to a source file whose test was not touched', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, "sed -i 's/a/b/' src/utils/calculateDuration.ts")

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('denies an absolute-path shell write inside the project, but not in another repo', async ($, on) => {
    fakeEngine(on)

    const inside = await runBash($, `sed -i 's/a/b/' ${ROOT}/src/App.tsx`)
    const gitBashStyle = await runBash($, "sed -i 's/a/b/' /c/work/throughline/src/App.tsx")
    const elsewhere = await runBash($, "sed -i 's/a/b/' C:/other/repo/src/App.tsx")

    expect(inside.deny).toBeDefined()
    expect(gitBashStyle.deny).toBeDefined()
    expect(elsewhere.deny).toBeUndefined()
  })

  test('allows a shell write once the module is unlocked', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/calculateDuration')

    const result = await runBash($, "sed -i 's/a/b/' src/utils/calculateDuration.ts")

    expect(result.deny).toBeUndefined()
  })

  test('counts a source change the shell made without a test as unguarded and tells the model', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    const result = await runBash($, './scripts/codemod.sh')
    const status = await runCommand($, 'tdd')

    expect(result.context?.join('\n')).toMatch(/src\/App\.tsx.*without a test/)
    expect(status.text).toMatch(/unguarded 1/)
  })

  test('counts a shell change to an unlocked module as test-first', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'App', 'tsx')
    world.onBash = () => {
      world.untracked = 'src/App.tsx\n'
    }

    await runBash($, './scripts/codemod.sh')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/test-first: 1\/1/)
  })

  test('a test written through the shell counts as a touch and unlocks its module', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = command => {
      if (command.includes('tests/utils/calculateDuration.test.ts')) {
        world.untracked = 'tests/utils/calculateDuration.test.ts\n'
      }
    }

    await runBash($, "cat > tests/utils/calculateDuration.test.ts <<'EOT'\nit('x', () => {})\nEOT")
    const status = await runCommand($, 'tdd')
    const result = await runBash($, "sed -i 's/a/b/' src/utils/calculateDuration.ts")

    expect(status.text).toMatch(/touched\s+utils\/calculateDuration/)
    expect(status.text).toMatch(/unguarded 0/)
    expect(result.deny).toBeUndefined()
  })

  test('reading a runner config file is not a test run', async ($, on) => {
    fakeEngine(on)

    await runBash($, 'cat vitest.config.ts')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/runs: 0/)
    expect(status.text).toMatch(/phase: IDLE/)
  })

  test('asks git for paths relative to the session root, so a project inside a bigger repo works', async ($, on) => {
    const world = fakeEngine(on)

    await runBash($, 'git status')

    const numstat = world.gitCalls.find(argv => argv.includes('--numstat'))
    expect(numstat).toContain('--relative')
  })

  test('a shell edit that keeps the same line counts is still seen, through the file stamp', async ($, on) => {
    const world = fakeEngine(on)
    world.numstat = '1\t1\tsrc/App.tsx\n'
    world.onBash = () => {
      world.testModifiedAt = world.testModifiedAt + 1
    }

    await runBash($, './scripts/codemod.sh')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 1/)
  })

  test('restoring a source file with git is not an edit', async ($, on) => {
    const world = fakeEngine(on)
    world.numstat = '3\t1\tsrc/App.tsx\n'
    world.onBash = () => {
      world.numstat = ''
    }

    await runBash($, 'git checkout -- src/App.tsx')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 0/)
  })

  test('ignores shell calls that change nothing under src/', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, 'git status')
    const status = await runCommand($, 'tdd')

    expect(result.context).toBeUndefined()
    expect(status.text).toMatch(/unguarded 0/)
  })
})

describe('honest runs', () => {
  test('a failing run piped through tail is still RED, because the runner summary says so', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashText = ' FAIL  tests/money/formatCents.test.ts\n\n Test Files  1 failed (1)\n      Tests  2 failed | 1 passed (3)\n'

    await runBash($, 'npx vitest run tests/money/formatCents.test.ts 2>&1 | tail -30')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
    expect(status.text).toMatch(/runs: 1 \(0 pass, 1 fail\)/)
  })

  test('a run that found no test files is not counted', async ($, on) => {
    const world = fakeEngine(on)
    world.bashFails = true
    world.bashText = 'No test files found, exiting with code 1\n'

    await runBash($, 'npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/runs: 0/)
  })
})

describe('the agent is told', () => {
  test('touching a test tells the agent the module is unlocked and to see it fail first', async ($, on) => {
    const world = fakeEngine(on)

    const result = await touchTest($, world, 'money/formatCents')

    expect(result.context?.join(' ')).toMatch(/money.formatCents unlocked/)
  })

  test('a failing run tells the agent it is RED, even when the shell reported the error', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')

    const result = await runTests($, world, 'fail')

    expect(result.isError).toBe(true)
    expect(result.context?.join(' ')).toMatch(/RED on money.formatCents/)
  })

  test('a green that never saw red tells the agent to prove the test', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')

    const result = await runTests($, world, 'pass')

    expect(result.context?.join(' ')).toMatch(/never saw red/)
  })
})

describe('checkable state', () => {
  test('/tdd reports the guard state and recent events', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')

    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/guard: ON/)
    expect(status.text).toMatch(/phase: WRITING/)
    expect(status.text).toMatch(/touched\s+utils\/formatDuration/)
  })

  test('the model can read the same status through a tool', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    await runTests($, world, 'fail')

    const result = await $.tool.call({ tool: 'mcp__red-first__status' } as never)

    expect(JSON.stringify(result)).toMatch(/phase: RED/)
  })

  test('pause and resume confirm themselves with a toast', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'desktop', ...BAND })

    await ui.press({ key: 'pause' })
    await ui.press({ key: 'pause' })

    expect(world.toasts).toEqual(['TDD guard paused', 'TDD guard resumed'])
  })
})

describe('honest phases on the band', () => {
  test('a touched but unrun test shows WRITING, not RED', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })

    expect(await ui.find({ type: 'Text', text: /WRITING/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /RED/ })).toBeUndefined()
  })

  test('shows unguarded edits and cycles that never saw red', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    world.onBash = () => {
      world.numstat = '1\t0\tsrc/App.tsx\n'
    }
    await runBash($, './scripts/codemod.sh')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })

    expect(await ui.find({ type: 'Text', text: /1 UNGUARDED/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 NEVER SAW RED/ })).toBeDefined()
  })

  test('a test run that names a test file makes that module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await runBash($, `npx vitest run ${ROOT}/tests/utils/formatDuration.test.ts`)

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
  })

  test('an allowed source edit makes its module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await editAt($, 'src/utils/formatDuration.ts')

    const ui = await $.ui.mount({ plugin: 'red-first', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
  })
})
