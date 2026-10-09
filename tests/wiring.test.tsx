import { describe, expect, test } from 'claude-code/testing'

import {
  BAND,
  MINUTE,
  ROOT,
  T0,
  editAt,
  fakeEngine,
  runBash,
  runCommand,
  runPowerShell,
  runTests,
  startSession,
  touchTest,
  writeAt,
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

  test('a patch applied with git apply is an edit like any other', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    await runBash($, 'git apply fix.patch')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 1/)
  })

  test('ignores shell calls that change nothing under src/', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, 'git status')
    const status = await runCommand($, 'tdd')

    expect(result.context).toBeUndefined()
    expect(status.text).toMatch(/unguarded 0/)
  })
})

describe('the PowerShell tool', () => {
  test('a PowerShell write to a locked source file is denied like a Bash one', async ($, on) => {
    fakeEngine(on)

    const result = await runPowerShell($, "Set-Content -Path src/utils/calculateDuration.ts -Value 'x'")

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a PowerShell test run is read like a Bash one', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true

    const result = await runPowerShell($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
    expect(result.context?.join(' ')).toMatch(/RED on utils.formatDuration/)
  })

  test('a source change a PowerShell command made without a test is counted through the git backstop', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    await runPowerShell($, './scripts/codemod.ps1')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 1/)
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

  test('a failing run in other test files is red elsewhere, not red for the module', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashFails = true
    world.bashText = ' FAIL  tests/cart/applyDiscount.test.ts > rounds down\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 3 passed (4)\n'

    const result = await runBash($, 'npm test')
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(status.text).toMatch(/phase: WRITING.*red elsewhere: tests\/cart\/applyDiscount\.test\.ts/)
    expect(status.text).toMatch(/runs: 1 \(0 pass, 1 fail\)/)
    expect(result.context?.join(' ')).toMatch(/RED, but not on money.formatCents: tests\/cart\/applyDiscount\.test\.ts failed/)
    expect(await ui.find({ type: 'Text', text: 'RED ELSEWHERE' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /■ RED/ })).toBeUndefined()
  })

  test('a failing run that names the module\'s own test is RED for it, and the green after it saw red', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashFails = true
    world.bashText = ' FAIL  tests/money/formatCents.test.ts > x\n FAIL  tests/cart/applyDiscount.test.ts > y\n\n Tests  2 failed (4)\n'

    await runBash($, 'npm test')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
    expect(status.text).not.toMatch(/red elsewhere/)
  })

  test('a run whose output has no summary line counts as nothing, and the agent is told why', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashFails = true
    world.bashText = 'Error: Cannot find module vitest\n'

    const result = await runBash($, 'npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: WRITING/)
    expect(status.text).toMatch(/runs: 0 \(0 pass, 0 fail, 1 unread\)/)
    expect(result.context?.join(' ')).toMatch(/summary line was not in the output, so nothing was counted/)
  })

  test('a test command held for permission approval never ran, so it is not a run and nothing is said', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashFails = true
    world.bashText = 'This PowerShell command contains multiple operations. The following part requires approval: npx vitest run tests/money/formatCents.test.ts'

    const result = await runPowerShell($, 'npx vitest run tests/money/formatCents.test.ts')
    const status = await runCommand($, 'tdd')

    expect(result.context).toBeUndefined()
    expect(status.text).toMatch(/runs: 0 \(0 pass, 0 fail\)/)
    expect(status.text).not.toMatch(/unread/)
  })

  test('a truncated tool result is named as the reason', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashText = 'Output too large (41.9KB). Full output saved to: C:/x.txt\n\nPreview (first 2KB):\n RUN  v3.2.4\n'

    const result = await runBash($, 'npx vitest run')

    expect(result.context?.join(' ')).toMatch(/the result was truncated/)
  })
})

describe('one module at a time', () => {
  test('a red on one module is never charged to another: B green after A red is never saw red, not test changed', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/a')
    await runTests($, world, 'fail')
    await touchTest($, world, 'utils/b')

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.context?.join(' ')).toMatch(/GREEN on utils\/b but it never saw red/)
    expect(result.context?.join(' ')).not.toMatch(/green came from the test/)
    expect(status.text).toMatch(/never saw red 1/)
    expect(status.text).not.toMatch(/test changed/)
    expect(status.text).toMatch(/also open: utils\/a \(red\)/)
    expect(await ui.find({ type: 'Text', text: 'TEST CHANGED' })).toBeUndefined()
    await ui.unmount()

    await runBash($, 'npx vitest run tests/utils/a.test.ts')
    const later = await runCommand($, 'tdd')

    expect(later.text).toMatch(/cycles: 2 \(avg .*never saw red 1\)/)
    expect(later.text).not.toMatch(/also open/)
  })

  test('a hold text without an error flag is still not a run', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashText = "Claude requested permissions to use Bash, but you haven't granted it yet."

    const result = await runBash($, 'npx vitest run')
    const status = await runCommand($, 'tdd')

    expect(result.context).toBeUndefined()
    expect(status.text).toMatch(/runs: 0 \(0 pass, 0 fail\)/)
  })
})

describe('a test changed after red', () => {
  test('green with the test edited and the code untouched says the green came from the test', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'fail')
    await touchTest($, world, 'money/formatCents')

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.context?.join(' ')).toMatch(/the test changed after red and src\/money\/formatCents did not/)
    expect(status.text).toMatch(/test changed 1/)
    expect(status.text).toMatch(/test-changed\s+money\/formatCents/)
    expect(await ui.find({ type: 'Text', text: 'TEST CHANGED' })).toBeDefined()
  })

  test('green with the test edited and the code changed too is checked, not flagged', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/src/money/formatCents.ts`, 'export const a = 1')
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'fail')
    await editAt($, 'src/money/formatCents.ts')
    await touchTest($, world, 'money/formatCents')

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(result.context?.join(' ')).not.toMatch(/the green came from the test/)
    expect(status.text).not.toMatch(/test changed/)
    expect(status.text).toMatch(/caught 1/)
  })
})

describe('the config file is watched', () => {
  test('loosening dope-tdd.json is recorded, said to the agent, and shown to the user', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')

    const result = await writeAt($, 'dope-tdd.json', '{"mode":"observe"}')
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.deny).toBeUndefined()
    expect(result.context?.join(' ')).toMatch(/dope-tdd\.json changed \(mode enforce → observe\)/)
    expect(world.toasts.some(t => /mode enforce → observe/.test(t))).toBe(true)
    expect(status.text).toMatch(/config\s+\(mode enforce → observe\)/)
    expect(await ui.find({ type: 'Text', text: 'MODE OBSERVE' })).toBeDefined()
  })

  test('a write that changes nothing the guard reads is quiet', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"warn"}')

    const result = await writeAt($, 'dope-tdd.json', '{"mode": "warn", "comment": "same"}')

    expect(result.context).toBeUndefined()
    expect(world.toasts).toEqual([])
  })
})

describe('workarounds are on the record', () => {
  const TEST = 'tests/money/formatCents.test.ts'
  const HONEST = "import { expect, test } from 'vitest'\n\ntest('formats', () => {\n  expect(formatCents(-1250)).toBe('-$12.50')\n  expect(formatCents(-50)).toBe('-$0.50')\n})\n"

  test('a skip marker added to a test is recorded, counted and said', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/${TEST}`, HONEST)
    await writeAt($, TEST, HONEST)

    const result = await writeAt($, TEST, HONEST.replace("test('formats'", "test.skip('formats'"))
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.context?.join(' ')).toMatch(/tests\/money\/formatCents\.test\.ts gained 1 skip\/only marker\. A skipped test guards nothing\. Recorded; say why/)
    expect(status.text).toMatch(/workarounds: 1 \(skipped 1\)/)
    expect(status.text).toMatch(/skipped\s+money\/formatCents \(\+1\)/)
    expect(await ui.find({ type: 'Text', text: '1 WORKAROUNDS' })).toBeDefined()
  })

  test('an assertion removed from a test is recorded with before and after counts', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/${TEST}`, HONEST)

    const result = await writeAt($, TEST, HONEST.replace("  expect(formatCents(-50)).toBe('-$0.50')\n", ''))
    const status = await runCommand($, 'tdd')

    expect(result.context?.join(' ')).toMatch(/went from 2 to 1 assertion\. Recorded; say why/)
    expect(status.text).toMatch(/workarounds: 1 \(assertions removed 1\)/)
  })

  test('code commented out by a source edit is recorded and said', async ($, on) => {
    const world = fakeEngine(on)
    const SRC = `${ROOT}/src/money/formatCents.ts`
    world.fileContents.set(SRC, 'export function f(a: number) {\n  if (a < 0) {\n    throw new Error("negative")\n  }\n  return a\n}\n')
    await touchTest($, world, 'money/formatCents')

    const result = await $.tool.call({
      tool: 'Edit',
      file_path: SRC,
      old_string: '  if (a < 0) {\n    throw new Error("negative")\n  }\n',
      new_string: '  // if (a < 0) {\n  //   throw new Error("negative")\n  // }\n',
    } as never)
    const status = await runCommand($, 'tdd')

    expect(result.context?.join(' ')).toMatch(/src\/money\/formatCents\.ts: 2 lines of code commented out by this edit\. Recorded; say why/)
    expect(status.text).toMatch(/workarounds: 1 \(commented out 1\)/)
    expect(status.text).toMatch(/commented-out\s+money\/formatCents \(2 lines\)/)
  })

  test('pausing the guard and loosening the config count; tightening the config does not', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    await ui.press({ key: 'pause' })
    await ui.press({ key: 'pause' })
    await writeAt($, 'dope-tdd.json', '{"mode":"warn"}')
    await writeAt($, 'dope-tdd.json', '{"mode":"enforce"}')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/workarounds: 2 \(config loosened 1, paused 1\)/)
  })

  test('an honest test edit is not a workaround', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/${TEST}`, HONEST)

    const result = await writeAt($, TEST, HONEST.replace('})\n', "  expect(formatCents(0)).toBe('$0.00')\n})\n"))
    const status = await runCommand($, 'tdd')

    expect(result.context?.join(' ')).not.toMatch(/Recorded; say why/)
    expect(status.text).not.toMatch(/workarounds/)
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

describe('memory across sessions', () => {
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  const remembered = (ageMs: number) => ({
    [`unlocks:${ROOT}`]: {
      'utils/formatDuration': { testPath: `${ROOT}/tests/utils/formatDuration.test.ts`, atMs: T0 - ageMs },
    },
  })

  test('a test touched in an earlier session still unlocks its module, and the agent is told once', async ($, on) => {
    fakeEngine(on, { store: remembered(2 * HOUR) })
    await startSession($)

    const first = await editAt($, 'src/utils/formatDuration.ts')
    const second = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(first.deny).toBeUndefined()
    expect(first.context?.join(' ')).toMatch(/touched 2H AGO in an earlier session/)
    expect(second.context).toBeUndefined()
    expect(status.text).toMatch(/unlocked earlier: utils.formatDuration/)
  })

  test('an unlock remembered under the normalised root is found by a session that spells the root the other way', async ($, on) => {
    fakeEngine(on, {
      store: {
        [`unlocks:${ROOT.replace(/^C:/, 'c:')}`]: {
          'utils/formatDuration': { testPath: `${ROOT}/tests/utils/formatDuration.test.ts`, atMs: T0 - 2 * HOUR },
        },
      },
    })
    await startSession($)

    const result = await editAt($, 'src/utils/formatDuration.ts')

    expect(result.deny).toBeUndefined()
  })

  test('touching a test is remembered for the next session', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/calculateDuration')

    await startSession($)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unlocked earlier: utils.calculateDuration/)
  })

  test('an unlock older than seven days is forgotten', async ($, on) => {
    fakeEngine(on, { store: remembered(8 * DAY) })
    await startSession($)

    const result = await editAt($, 'src/utils/formatDuration.ts')

    expect(result.deny).toBeDefined()
  })
})

describe('hollow tests', () => {
  test('a touched test with no assertion is called out to the agent', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/tests/utils/formatDuration.test.ts`, "it('works', () => {\\n  formatDuration(14)\\n})\\n")

    const result = await touchTest($, world, 'utils/formatDuration')

    expect(result.context?.join(' ')).toMatch(/no assertion/)
  })

  test('a touched test that asserts something is not', async ($, on) => {
    const world = fakeEngine(on)

    const result = await touchTest($, world, 'utils/formatDuration')

    expect(result.context?.join(' ')).not.toMatch(/no assertion/)
  })

  test('a long test file whose first assertion comes late is read whole, not from a prefix', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/tests/utils/formatDuration.test.ts`, `${'// setup\n'.repeat(1_500)}expect(formatDuration(14)).toBe('1y 2m')\n`)

    const result = await touchTest($, world, 'utils/formatDuration')

    expect(result.context?.join(' ')).not.toMatch(/no assertion/)
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

    const result = await $.tool.call({ tool: 'mcp__dope-tdd__status' } as never)

    expect(JSON.stringify(result)).toMatch(/phase: RED/)
  })

  test('pause and resume confirm themselves with a toast', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'desktop', ...BAND })

    await ui.press({ key: 'pause' })
    await ui.press({ key: 'pause' })

    expect(world.toasts).toEqual(['TDD guard paused', 'TDD guard resumed'])
  })
})

describe('honest phases on the band', () => {
  test('a touched but unrun test shows WRITING, not RED', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(await ui.find({ type: 'Text', text: /WRITING/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /■ RED/ })).toBeUndefined()
  })

  test('shows unguarded edits and cycles that never saw red', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    world.onBash = () => {
      world.numstat = '1\t0\tsrc/App.tsx\n'
    }
    await runBash($, './scripts/codemod.sh')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(await ui.find({ type: 'Text', text: /1 UNGUARDED/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 NEVER SAW RED/ })).toBeDefined()
  })

  test('a test run that names a test file makes that module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await runBash($, `npx vitest run ${ROOT}/tests/utils/formatDuration.test.ts`)

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
  })

  test('an allowed source edit makes its module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await editAt($, 'src/utils/formatDuration.ts')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'UTILS/FORMATDURATION' })).toBeDefined()
  })
})
