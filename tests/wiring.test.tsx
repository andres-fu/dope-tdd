import { describe, expect } from 'claude-code/testing'

import { say } from '../hooks/messages'
import { contentHash, unlockKey } from '../hooks/unlocks'

import { BAND, FAIL_SUMMARY, FIXTURE_DRIVE, MINUTE, ROOT, SOURCE, T0, TEST_SOURCE, editAt, failOutput, fakeEngine, runBash, runCommand, runPowerShell, runTests, startSession, test, touchTest, writeAt } from './engine'

// #198 (2026-10-28): a subagent with isolation: worktree edits under <root>/.claude/worktrees/<name>/. Read from the
// session root those paths matched no layout, and a live probe's edit to untested code went through without a word.
describe('an agent worktree is guarded like the main checkout', () => {
  test('an Edit to untested source in an agent worktree is refused, naming the test in that worktree', async ($, on) => {
    fakeEngine(on)

    const result = await editAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a Write to untested source in an agent worktree is refused too', async ($, on) => {
    fakeEngine(on)

    const result = await writeAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a shell write to untested source in an agent worktree, by absolute path, is refused too', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, `sed -i 's/a/b/' ${ROOT}/.claude/worktrees/agent-x/src/utils/calculateDuration.ts`)

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  // The live probe (2026-10-28) wrote through Git Bash's spelling of the drive, /c/Users/...
  if (/^[A-Za-z]:\/$/.test(FIXTURE_DRIVE)) {
    test('the same write spelled the Git Bash way (/c/...) is refused too', async ($, on) => {
      fakeEngine(on)

      const gitBash = `/${FIXTURE_DRIVE[0]?.toLowerCase()}${ROOT.slice(2)}/.claude/worktrees/agent-x/src/utils/calculateDuration.ts`
      const result = await runBash($, `echo 'x' >> ${gitBash}`)

      expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
    })
  }

  // An agent's shell runs in its worktree. Once a path it reads places it there, its shell is judged by that
  // worktree's dope-tdd.json, not the main checkout's: here the worktree exempts src/**, the main checkout does not.
  test("an agent's relative shell write is judged in the worktree its reads placed it in", async ($, on) => {
    const world = fakeEngine(on)
    const worktree = `${ROOT}/.claude/worktrees/agent-x`
    world.fileContents.set(`${worktree}/dope-tdd.json`, '{"exempt":["src/**"]}')
    const write = { tool: 'Bash', command: "sed -i 's/a/b/' src/utils/calculateDuration.ts" }

    const before = await $.tool.call({ ...write, agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Read', file_path: `${worktree}/src/utils/calculateDuration.ts`, agentId: 'a1' } as never)
    const placed = await $.tool.call({ ...write, agentId: 'a1' } as never)
    const mainLoop = await $.tool.call(write as never)

    expect(before.deny).toBeDefined()
    expect(placed.deny).toBeUndefined()
    expect(mainLoop.deny).toBeDefined()
  })

  test('touching the test in the worktree unlocks the edit there', async ($, on) => {
    fakeEngine(on)

    await editAt($, '.claude/worktrees/agent-x/tests/utils/calculateDuration.test.ts')
    const result = await editAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')

    expect(result.deny).toBeUndefined()
  })
})

// #250 (2026-10-29): the main loop has no agentId, so nothing placed its shell. A session working in a worktree nested
// under its root, as the desktop app sets up, had every run read against the main checkout: "RED, but not on calc", a
// catch check built from a checkout with neither the change nor the test, and a main-checkout run counted as the module's.
describe('a shell working in a nested worktree is judged against that worktree', () => {
  const NESTED = `${ROOT}/.claude/worktrees/nested`
  const GIT_DIR = `${ROOT}/.git/worktrees/nested`
  const COPY = `${GIT_DIR}/dope-tdd/wt`
  const MODULE = 'utils/calculateDuration'
  const TEST = 'tests/utils/calculateDuration.test.ts'
  const CODE = 'src/utils/calculateDuration.ts'
  const IN_NESTED = `cd ${NESTED}`
  const RUN = `${IN_NESTED} && npx vitest run ${TEST}`
  const OLD_CODE = 'export const a = 1'

  function nested(world: ReturnType<typeof fakeEngine>) {
    world.existingFiles.add(NESTED)
    world.existingFiles.add(`${ROOT}/.git`)
    world.fileContents.set(`${NESTED}/.git`, `gitdir: ${GIT_DIR}\n`)
    world.fileContents.set(`${NESTED}/${TEST}`, TEST_SOURCE)
    world.fileContents.set(`${NESTED}/${CODE}`, OLD_CODE)
  }

  async function seeRed($: Parameters<typeof editAt>[0], world: ReturnType<typeof fakeEngine>) {
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = failOutput(TEST)
    const red = await runBash($, RUN)
    world.bashFails = false
    world.bashText = ''
    return red
  }

  test('a red from inside the worktree is a red on the module, by the file the runner names', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)

    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = failOutput(TEST)

    const red = await runBash($, `cd .claude/worktrees/nested && npx vitest run ${TEST}`)

    expect(red.context).toContain(say('red.first', { module: MODULE }))
  })

  test('the same relative cd twice reads the same, when Claude Code put the shell back between them', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = failOutput(TEST)
    const relative = `cd .claude/worktrees/nested && npx vitest run ${TEST}`

    await runBash($, relative)
    const again = await runBash($, relative)

    expect(again.context).toContain(say('red.first', { module: MODULE }))
  })

  test('so is a red whose runner named no file', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = failOutput(null)

    const red = await runBash($, RUN)

    expect(red.context).toContain(say('red.first', { module: MODULE }))
  })

  test('a red by absolute path is that worktree\'s too', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    const red = await seeRed($, world)

    expect(red.context).toContain(say('red.first', { module: MODULE }))
  })

  test('a shell left in the worktree by the last command stays judged there', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    await runBash($, IN_NESTED)
    world.bashFails = true
    world.bashText = failOutput(TEST)

    const red = await runBash($, `npx vitest run ${TEST}`)

    expect(red.context).toContain(say('red.first', { module: MODULE }))
  })

  test('the catch check builds its copy from the worktree, with the change and the test in', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await seeRed($, world)
    await editAt($, `.claude/worktrees/nested/${CODE}`)

    await runBash($, RUN)

    const added = world.gitCalls.findIndex(argv => argv.includes('add') && argv.includes('--detach'))
    expect(world.runCwds[added]).toBe(NESTED)
    expect(world.gitCalls[added]).toContain(COPY)
    expect(world.writes).toContainEqual([`${COPY}/${CODE}`, OLD_CODE])
    expect((await runCommand($, 'tdd')).text).toMatch(/proven 1/)
  })

  test("a run of the main checkout's own test does not count for a module unlocked in the worktree", async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await seeRed($, world)
    await editAt($, `.claude/worktrees/nested/${CODE}`)

    const main = await runBash($, `cd ${ROOT} && npx vitest run ${TEST}`)
    const inNested = await runBash($, RUN)

    expect(main.context).toContain(say('run.otherCheckout', { module: MODULE, testPath: `.claude/worktrees/nested/${TEST}` }))
    // The green in the main checkout closed nothing: the worktree's own green still closes the cycle and checks it.
    expect(inNested.context?.join('\n')).toMatch(/PROVEN/)
    expect(world.writes.filter(([path]) => path === `${COPY}/${CODE}`)).toContainEqual([`${COPY}/${CODE}`, OLD_CODE])
    expect((await runCommand($, 'tdd')).text).toMatch(/proven 1/)
  })

  test("a red of the main checkout's own test leaves the worktree's unlock alone", async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = failOutput(TEST)

    const main = await runBash($, `npx vitest run ${TEST}`)
    const edit = await editAt($, `.claude/worktrees/nested/${CODE}`)
    const mainEdit = await editAt($, CODE)

    expect(main.context).toContain(say('run.otherCheckout', { module: MODULE, testPath: `.claude/worktrees/nested/${TEST}` }))
    expect(edit.deny).toBeUndefined()
    expect(mainEdit.deny).toBeDefined()
  })

  test('a cd back to the main checkout from the worktree is a run of the main checkout', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await seeRed($, world)

    const back = await runBash($, `cd ../../.. && npx vitest run ${TEST}`)

    expect(back.context).toContain(say('run.otherCheckout', { module: MODULE, testPath: `.claude/worktrees/nested/${TEST}` }))
  })

  test('a run in the worktree does not count for a module unlocked in the main checkout', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.existingFiles.add(`${ROOT}/${TEST}`)
    await editAt($, TEST)

    const run = await runBash($, RUN)

    expect(run.context).toContain(say('run.otherCheckout', { module: MODULE, testPath: TEST }))
  })

  test("an agent's run in its worktree does not count for a module unlocked in the main checkout", async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.existingFiles.add(`${ROOT}/${TEST}`)
    await editAt($, TEST)
    await $.tool.call({ tool: 'Read', file_path: `${NESTED}/${CODE}`, agentId: 'a1' } as never)

    const run = await $.tool.call({ tool: 'Bash', command: `npx vitest run ${TEST}`, agentId: 'a1' } as never)

    expect(run.context).toContain(say('run.otherCheckout', { module: MODULE, testPath: TEST }))
  })

  test('a shell write in the worktree is refused until its test is touched there, naming that test', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, TEST)

    const refused = await runBash($, `${IN_NESTED} && sed -i 's/a/b/' ${CODE}`)

    expect(refused.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a shell write in the worktree is seen by git there, and its catch check builds from there', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await seeRed($, world)
    world.onBash = command => {
      if (command.includes('sed')) {
        world.numstat = `1\t1\t${CODE}\n`
        world.fileContents.set(`${NESTED}/${CODE}`, 'export const b = 2')
      }
    }

    const write = await runBash($, `${IN_NESTED} && sed -i 's/a/b/' ${CODE}`)
    const numstat = world.gitCalls.findIndex(argv => argv.includes('--numstat'))
    await runBash($, RUN)

    expect(write.deny).toBeUndefined()
    expect(world.runCwds[numstat]).toBe(NESTED)
    expect(world.writes).toContainEqual([`${COPY}/${CODE}`, OLD_CODE])
  })

  test('a script that changes a source in the worktree is said, when its unlock is in the main checkout', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.existingFiles.add(`${ROOT}/${TEST}`)
    await editAt($, TEST)
    world.onBash = command => {
      if (command.includes('fix.py')) {
        world.numstat = `1\t1\t${CODE}\n`
      }
    }

    const script = await runBash($, `${IN_NESTED} && python fix.py`)

    expect(script.context?.join('\n')).toMatch(/changed through a shell command without a test touched first/)
  })

  test("a shell in the worktree goes by the worktree's own dope-tdd.json", async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.fileContents.set(`${NESTED}/dope-tdd.json`, '{"exempt":["src/**"]}')

    const inNested = await runBash($, `${IN_NESTED} && sed -i 's/a/b/' ${CODE}`)
    const inMain = await runBash($, `cd ${ROOT} && sed -i 's/a/b/' ${CODE}`)

    expect(inNested.deny).toBeUndefined()
    expect(inMain.deny).toBeDefined()
  })

  test('a git operation in the worktree stands the guard down for its shell, not the main checkout\'s', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.existingFiles.add(`${GIT_DIR}/MERGE_HEAD`)

    const inNested = await runBash($, `${IN_NESTED} && sed -i 's/a/b/' ${CODE}`)
    const inMain = await runBash($, `cd ${ROOT} && sed -i 's/a/b/' ${CODE}`)

    expect(inNested.deny).toBeUndefined()
    expect(inMain.deny).toBeDefined()
  })

  test('a shell the guard stood down for stays in the worktree for the next command', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    world.existingFiles.add(`${GIT_DIR}/MERGE_HEAD`)

    await runBash($, `${IN_NESTED} && git status`)
    const next = await runBash($, `sed -i 's/a/b/' ${CODE}`)

    expect(next.deny).toBeUndefined()
  })

  test('a shell left in a sibling worktree stays there, when the session root is itself a linked worktree (#233)', async ($, on) => {
    const world = fakeEngine(on)
    const main = `${FIXTURE_DRIVE}work/main`
    const sibling = `${main}/.claude/worktrees/sibling`
    world.mainCheckout = main
    world.fileContents.set(`${sibling}/dope-tdd.json`, '{"exempt":["src/**"]}')

    await runBash($, `cd ${sibling}`)
    const next = await runBash($, `sed -i 's/a/b/' ${CODE}`)

    expect(next.deny).toBeUndefined()
  })

  test("a red in the main checkout does not gather failures for a module unlocked in the worktree", async ($, on) => {
    const world = fakeEngine(on)
    nested(world)
    await editAt($, `.claude/worktrees/nested/${TEST}`)
    world.bashFails = true
    world.bashText = FAIL_SUMMARY

    await runBash($, `npx vitest run ${TEST}`)

    expect(world.namesCalls).toBe(0)
  })

  test('a write into the main checkout beside a run in the worktree is still refused', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)

    const result = await runBash($, `${IN_NESTED} && sed -i 's/a/b/' ${ROOT}/${CODE} && npx vitest run ${TEST}`)

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a file in the main checkout, written beside a run in the worktree, is not outside the project', async ($, on) => {
    const world = fakeEngine(on)
    nested(world)

    const result = await runBash($, `${IN_NESTED} && echo x >> ${ROOT}/scripts/a.ts && npx vitest run ${TEST}`)

    expect((result.context ?? []).filter(line => /is outside this project/.test(line))).toEqual([])
  })
})

// #233 (tester round 7): a session opened in a linked git worktree has its subagents' worktrees put under the main
// checkout's .claude/worktrees, outside the session root. Read as outside the project, an untested edit there went
// through and nothing was counted.
describe('an agent worktree under the main checkout is guarded when the session root is a linked worktree', () => {
  const MAIN = `${FIXTURE_DRIVE}work/main`
  const AGENT = `${MAIN}/.claude/worktrees/agent-a179`

  test('an Edit to untested source there is refused, naming the test in that worktree', async ($, on) => {
    const world = fakeEngine(on)
    world.mainCheckout = MAIN

    const result = await $.tool.call({ tool: 'Edit', file_path: `${AGENT}/src/utils/calculateDuration.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' } as never)

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a shell write there by absolute path is refused too', async ($, on) => {
    const world = fakeEngine(on)
    world.mainCheckout = MAIN

    const result = await $.tool.call({ tool: 'Bash', command: `printf 'x' >> ${AGENT}/src/utils/calculateDuration.ts`, agentId: 'a1' } as never)

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('touching the test in that worktree unlocks the edit there, and only there', async ($, on) => {
    const world = fakeEngine(on)
    world.mainCheckout = MAIN

    await $.tool.call({ tool: 'Edit', file_path: `${AGENT}/tests/utils/calculateDuration.test.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' } as never)
    const there = await $.tool.call({ tool: 'Edit', file_path: `${AGENT}/src/utils/calculateDuration.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' } as never)
    const session = await editAt($, 'src/utils/calculateDuration.ts')

    expect(there.deny).toBeUndefined()
    expect(session.deny).toBeDefined()
  })

  test('with no linked worktree, a path under another checkout stays outside the project', async ($, on) => {
    fakeEngine(on)

    const result = await $.tool.call({ tool: 'Edit', file_path: `${AGENT}/src/utils/calculateDuration.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' } as never)

    expect(result.deny).toBeUndefined()
  })
})

// #238: Dope TDD guards the project the session was opened in. Work in another repository from the same session is
// left alone, and said once a session so nobody takes it for guarded work.
describe('work outside the project is said once, never refused', () => {
  const OTHER = `${FIXTURE_DRIVE}work/other-repo`
  const outsideLine = (result: { context?: string[] }) => (result.context ?? []).filter(line => /is outside this project/.test(line))

  test('the first Edit to a code file outside the project goes through and says so; the next one is quiet', async ($, on) => {
    fakeEngine(on)

    const first = await $.tool.call({ tool: 'Edit', file_path: `${OTHER}/src/a.ts`, old_string: 'a', new_string: 'b' } as never)
    const second = await $.tool.call({ tool: 'Edit', file_path: `${OTHER}/src/b.ts`, old_string: 'a', new_string: 'b' } as never)
    const status = await runCommand($, 'tdd')

    expect(first.deny).toBeUndefined()
    expect(outsideLine(first)).toHaveLength(1)
    expect(outsideLine(first)[0]).toContain(`${OTHER}/src/a.ts`)
    expect(outsideLine(second)).toHaveLength(0)
    expect(status.text).toMatch(/outside this project, not guarded/)
  })

  test('a file that is not code, such as notes, says nothing', async ($, on) => {
    fakeEngine(on)

    const result = await $.tool.call({ tool: 'Write', file_path: `${OTHER}/notes.md`, content: 'x' } as never)

    expect(outsideLine(result)).toHaveLength(0)
  })

  test('a test run in another repository says so too', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, `cd ${OTHER} && npx vitest run tests/a.test.ts`)

    expect(outsideLine(result)).toHaveLength(1)
  })

  test("the project's own edits say nothing about it", async ($, on) => {
    fakeEngine(on)

    await editAt($, 'tests/utils/calculateDuration.test.ts')
    const result = await editAt($, 'src/utils/calculateDuration.ts')

    expect(outsideLine(result)).toHaveLength(0)
  })
})

// #234 (tester round 7): with dope-tdd.json unread, an untested edit to code the default layout pairs with nothing
// landed, and /tdd afterwards was unchanged: a bare "guard: ON", no events.
describe('an edit the guard did not look at shows in /tdd', () => {
  test('under an unread dope-tdd.json, /tdd leads with the defaults, and the edit is an event', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"strict"}')

    const edit = await editAt($, 'api.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toBeUndefined()
    expect(status.text).toMatch(/^guard: ON with the defaults: dope-tdd\.json was not read/m)
    expect(status.text).toMatch(/edited, no test layout, not guarded \(api\.ts\)/)
  })

  test('"Warn" in any case is read as warn, so the file is not thrown away', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"Warn"}')

    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/^mode: warn/m)
    expect(status.text).not.toMatch(/was not read/)
  })
})

// #239: a redirect quoted in a commit message was read as a write and refused as an untested edit.
describe('quoted text in a command is data', () => {
  test('a commit message that mentions a redirect into untested source is not refused; the real redirect is', async ($, on) => {
    fakeEngine(on)

    const message = await runBash($, 'git commit -m "note: echo x >> src/utils/calculateDuration.ts"')
    const real = await runBash($, 'echo x >> "src/utils/calculateDuration.ts"')

    expect(message.deny).toBeUndefined()
    expect(real.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })
})

// #244: a red whose test file was deleted sat in /tdd as "also open" for good, since nothing could close it.
describe('a red whose test file is gone', () => {
  test('is dropped when /tdd is read, and said once', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/calculateDuration')
    await runTests($, world, 'fail')
    world.fileContents.delete(`${ROOT}/tests/utils/calculateDuration.test.ts`)
    world.existingFiles.delete(`${ROOT}/tests/utils/calculateDuration.test.ts`)

    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/^phase: IDLE$/m)
    expect(status.text).toMatch(/test file gone, cycle and unlock dropped utils\/calculateDuration/)
  })
})

// #212 (tester round 6): the override is offered on a module's first refusal only, and that was counted for the whole
// session. A subagent refused after the main session never saw option (3), though it holds the tool.
describe('each agent is offered the override on its own first refusal', () => {
  const edit = { tool: 'Edit', file_path: SOURCE, old_string: 'a', new_string: 'b' }

  test('an Edit refused to a subagent after the main session still names the override', async ($, on) => {
    fakeEngine(on)

    const main = await $.tool.call(edit as never)
    const mainAgain = await $.tool.call(edit as never)
    const sub = await $.tool.call({ ...edit, agentId: 'a1' } as never)
    const subAgain = await $.tool.call({ ...edit, agentId: 'a1' } as never)

    expect(main.deny).toMatch(/override_request/)
    expect(mainAgain.deny).not.toMatch(/override_request/)
    expect(sub.deny).toMatch(/override_request/)
    expect(subAgain.deny).not.toMatch(/override_request/)
  })

  test('a shell write refused to a subagent after the main session still names the override', async ($, on) => {
    fakeEngine(on)
    const write = { tool: 'Bash', command: `sed -i 's/a/b/' ${SOURCE}` }

    await $.tool.call(write as never)
    const sub = await $.tool.call({ ...write, agentId: 'a1' } as never)

    expect(sub.deny).toMatch(/override_request/)
  })
})

// #195: NotebookEdit writes files too (its path field is notebook_path), and went through unseen.
describe('the NotebookEdit tool is guarded like Edit', () => {
  const notebookEdit = ($: Parameters<typeof editAt>[0], relative: string) =>
    $.tool.call({ tool: 'NotebookEdit', notebook_path: `${ROOT}/${relative}`, new_source: 'x' } as never)

  test('a NotebookEdit to untested source is refused, naming its test', async ($, on) => {
    fakeEngine(on)

    const result = await notebookEdit($, 'src/utils/calculateDuration.ts')

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('a NotebookEdit is allowed once the test is touched', async ($, on) => {
    fakeEngine(on)

    await editAt($, 'tests/utils/calculateDuration.test.ts')
    const result = await notebookEdit($, 'src/utils/calculateDuration.ts')

    expect(result.deny).toBeUndefined()
  })
})

describe('bash bypass', () => {
  test('a script that edits a test file and only quotes a source path in a string is not refused', async ($, on) => {
    fakeEngine(on)

    const script = [
      "python3 - <<'EOF'",
      "s = open('tests/utils/a.test.ts').read()",
      "s = s.replace(\"editAt($, 'src/utils/a.ts')\", \"editAt($, 'src/utils/b.ts')\")",
      "open('tests/utils/a.test.ts', 'w').write(s)",
      'EOF',
    ].join('\n')
    const result = await runBash($, script)

    expect(result.deny).toBeUndefined()
  })

  // #69: the exact command from the issue. Its files land in /tmp, outside the project: nothing to refuse.
  test('a scratch repo built in a temp dir through a variable is not refused', async ($, on) => {
    const world = fakeEngine(on)
    // As in the issue's project: every .js file at any depth is a source, so `$R/bot.js` read as inside it is gated.
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"stack":"node","layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"}}')

    const result = await runBash($, "R=/tmp/scratch/repro; mkdir -p $R && cd $R && git init -q\ncat > bot.js <<'EOF'\nmodule.exports = 1\nEOF")

    expect(result.deny).toBeUndefined()
  })

  test('a write through a variable that points into the project is still refused', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, "D=src/utils; sed -i 's/a/b/' $D/calculateDuration.ts")

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('denies a shell write to a source file whose test was not touched', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, "sed -i 's/a/b/' src/utils/calculateDuration.ts")

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test('denies an absolute-path shell write inside the project, but not in another repo', async ($, on) => {
    fakeEngine(on)

    const inside = await runBash($, `sed -i 's/a/b/' ${ROOT}/src/App.tsx`)
    const elsewhere = await runBash($, `sed -i 's/a/b/' ${FIXTURE_DRIVE}other/repo/src/App.tsx`)

    expect(inside.deny).toBeDefined()
    expect(elsewhere.deny).toBeUndefined()
  })

  // Git Bash spells a drive as /c/: only a root on a Windows drive has that second spelling.
  if (/^[A-Za-z]:\/$/.test(FIXTURE_DRIVE)) {
    test('denies a Git Bash spelling of an absolute path inside the project', async ($, on) => {
      fakeEngine(on)

      const gitBashStyle = await runBash($, `sed -i 's/a/b/' /${FIXTURE_DRIVE[0]?.toLowerCase()}${ROOT.slice(2)}/src/App.tsx`)

      expect(gitBashStyle.deny).toBeDefined()
    })
  }

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

  test('a change seen during a read-only command was not made by it: not charged, and said', async ($, on) => {
    const world = fakeEngine(on)
    world.readOnly = true
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    const result = await runBash($, './scripts/inspect.sh')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 0/)
    expect(result.context?.join('\n')).toMatch(/src\/App\.tsx changed while the command ran, but the command cannot have changed it/)
  })

  test('a change seen during a pure test run was not made by it; a test run chained to a formatter is charged', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = command => {
      world.numstat = command.includes('format') ? '3\t1\tsrc/App.tsx\n2\t1\tsrc/Nav.tsx\n' : '3\t1\tsrc/App.tsx\n'
    }

    await runBash($, 'npx vitest run tests/App.test.tsx | tail -20')
    const quiet = await runCommand($, 'tdd')
    await runBash($, 'npx vitest run && npm run format')
    const charged = await runCommand($, 'tdd')

    expect(quiet.text).toMatch(/unguarded 0/)
    expect(charged.text).toMatch(/unguarded [12]/)
  })

  test('reads and pure test runs cost no git snapshot; a command that may write still gets one', async ($, on) => {
    const world = fakeEngine(on)
    const snapshots = () => world.gitCalls.filter(argv => argv.includes('--numstat')).length

    await runBash($, 'ls src && cat src/App.tsx | head -20')
    await runBash($, 'git status && git diff src/App.tsx')
    await runBash($, 'npx vitest run tests/App.test.tsx | tail -5')
    const afterReads = snapshots()
    await runBash($, './scripts/codemod.sh')
    await runBash($, 'cat src/App.tsx > /tmp/copy.tsx')

    expect(afterReads).toBe(0)
    expect(snapshots()).toBe(4)
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
        // The shell wrote the file, so it exists: /tdd drops an unlock whose test file is gone (#244).
        world.existingFiles.add(`${ROOT}/tests/utils/calculateDuration.test.ts`)
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

    await runBash($, './scripts/codemod.sh')

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
    expect(status.text).not.toMatch(/brought in by git/)
  })

  // Verified review A7 (2026-10-20): a git restore beside a script hid the script's writes; now they count.
  test('a script beside a git restore still has its writes counted', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    await runBash($, 'python /tmp/fix.py; git restore README.md')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 1/)
  })

  // Karl's trial (2026-10-19): code git writes from another branch, commit or stash is not the agent's edit, but it is
  // said on the record instead of going by unseen.
  test('code git brings in from another branch is not an edit, and is on the record', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    await runBash($, 'git checkout main -- src/App.tsx')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 0/)
    expect(status.text).toMatch(/brought in by git, not guarded App \(git checkout\)$/m)
  })

  // Verified review B1 (2026-10-20): the event kept 80 characters of the command, so a token in a remote URL went into
  // /tdd, the session log and Claude Code's log. Only the git verb is kept now.
  test('a token in the command never reaches the record or the log: only the git verb is kept', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.numstat = '3\t1\tsrc/App.tsx\n'
    }

    await runBash($, 'git pull https://me:s3cr3t-not-a-token@github.com/acme/app main')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/brought in by git, not guarded App \(git pull\)$/m)
    expect(status.text).not.toMatch(/s3cr3t-not-a-token/)
    expect(world.logs.join('\n')).not.toMatch(/s3cr3t-not-a-token/)
  })

  // Karl's round 4 (2026-10-20): reads beside the checkout made it the agent's edit, since only test runs were quiet.
  test('code git brings in beside commands that only read is still not an edit', async ($, on) => {
    const world = fakeEngine(on)
    world.numstat = '3\t3\tsrc/App.tsx\n'
    world.onBash = () => {
      world.numstat = ''
      world.testModifiedAt += 5000
    }

    await runBash($, 'git checkout main -- src/App.tsx; sha256sum src/App.tsx; git status --short')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 0/)
    expect(status.text).toMatch(/brought in by git, not guarded App/)
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

describe('a commit is not a write (#23)', () => {
  test('committing a test nobody touched neither unlocks its module nor opens a cycle', async ($, on) => {
    const world = fakeEngine(on)
    world.untracked = 'tests/utils/a.test.ts\n'
    world.onBash = () => {
      world.untracked = ''
    }

    await runBash($, 'git add tests/utils/a.test.ts && git commit -m "add test"')
    const status = await runCommand($, 'tdd')
    const blocked = await editAt($, 'src/utils/a.ts')

    expect(status.text).toMatch(/module: none/)
    expect(blocked.deny).toMatch(/write the failing test first/)
  })

  test('committing a changed source is not an unguarded edit', async ($, on) => {
    const world = fakeEngine(on)
    world.numstat = '3\t1\tsrc/App.tsx\n'
    world.onBash = () => {
      world.numstat = ''
    }

    const result = await runBash($, 'git commit -am "wip"')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/unguarded 0/)
    expect(result.context?.join('\n') ?? '').not.toMatch(/without a test/)
  })

  test('a command that rewrites a test and commits it in one go still touched the test', async ($, on) => {
    const world = fakeEngine(on)
    world.untracked = 'tests/utils/a.test.ts\n'
    world.onBash = () => {
      world.untracked = ''
      world.testModifiedAt += 5_000
    }

    await runBash($, 'echo "test(1)" > tests/utils/a.test.ts && git add -A && git commit -m wip')
    const edit = await editAt($, 'src/utils/a.ts')

    expect(edit.deny).toBeUndefined()
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
    // Band v3: a red in other files is said by the last run, and never turns this module RED.
    expect(await ui.find({ type: 'Button', text: /failed · not this module/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^RED/ })).toBeUndefined()
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

  test('a runner that never started is no run, not an unread one, and the agent is told it did not start (seen on dapr-agents)', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'money/formatCents')
    world.bashFails = true

    world.bashText = 'C:\\Python314\\python.exe: No module named pytest'
    const noModule = await runBash($, 'python -m pytest tests/test_a.py')
    world.bashText = 'error: Failed to spawn: pytest\n  cause: program not found'
    await runBash($, 'uv run pytest tests/test_a.py')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/runs: 0 \(0 pass, 0 fail\)/)
    expect(status.text).not.toMatch(/unread/)
    expect(noModule.context?.join(' ')).toMatch(/the test runner did not start \(No module named pytest\); nothing was counted/)
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

    expect(result.context?.join(' ')).toMatch(/the output was too long and was cut before its summary line/)
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
    expect(status.text).toMatch(/1 never failed/)
    expect(status.text).not.toMatch(/test changed/)
    // The whole suite passed, so A's test passed too: its red cycle closed, counted as its own cycle.
    expect(status.text).not.toMatch(/also open/)
    expect(status.text).toMatch(/cycles: 2 /)
    expect(await ui.find({ type: 'Text', text: /the test changed/ })).toBeUndefined()
    await ui.unmount()

    await runBash($, 'npx vitest run tests/utils/a.test.ts')
    const later = await runCommand($, 'tdd')

    expect(later.text).toMatch(/cycles: 2 \(avg .*, 1 never failed\)/)
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
    expect(status.text).toMatch(/unproven, the test changed\s+money\/formatCents/)
    expect(await ui.find({ type: 'Text', text: "UNPROVEN · the test changed, the code didn't" })).toBeDefined()
  })

  // Pin corrected (2026-10-18, VibeCast field test): with the pin skill in use, the same steps are a pin correction.
  test('with the pin skill in use, the same steps are a corrected pin: its own line, no workaround, a break still owed', async ($, on) => {
    const world = fakeEngine(on)
    await $.skill.prompt({ skill: 'dope-tdd:pin', text: 'Pin the current behaviour…', frontmatter: {} } as never)
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'fail')
    await touchTest($, world, 'money/formatCents')

    const result = await runTests($, world, 'pass')
    const status = (await runCommand($, 'tdd')).text
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.context?.join(' ')).toMatch(/the pin was corrected after its red/)
    expect(status).toMatch(/^pins corrected: 1 /m)
    expect(status).not.toMatch(/workarounds/)
    expect(status).toMatch(/pin corrected money\/formatCents/)
    expect(await ui.find({ type: 'Text', text: 'UNPROVEN · pin corrected: prove it with a break' })).toBeDefined()
  })

  test('another skill does not count as pinning', async ($, on) => {
    const world = fakeEngine(on)
    await $.skill.prompt({ skill: 'simplify', text: 'Review…', frontmatter: {} } as never)
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'fail')
    await touchTest($, world, 'money/formatCents')
    await runTests($, world, 'pass')

    expect((await runCommand($, 'tdd')).text).toMatch(/workarounds: 1 \(test changed 1\)/)
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
    expect(status.text).toMatch(/proven 1/)
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
    expect(await ui.find({ type: 'Text', text: 'OBSERVING' })).toBeDefined()
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
    await writeAt($, TEST, HONEST)

    const result = await writeAt($, TEST, HONEST.replace("test('formats'", "test.skip('formats'"))
    const status = await runCommand($, 'tdd')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(result.context?.join(' ')).toMatch(/tests\/money\/formatCents\.test\.ts gained 1 skip\/only marker\. A skipped test guards nothing\. Recorded; say why/)
    expect(status.text).toMatch(/workarounds: 1 \(skipped 1\)/)
    expect(status.text).toMatch(/skipped\s+money\/formatCents \(\+1\)/)
    // Band v3: the count lives in /tdd (checked above), not on the band.
    expect(await ui.find({ type: 'Text', text: /WORKAROUNDS/ })).toBeUndefined()
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

    await $.command.run({ command: 'tdd', args: 'pause 30 pairing on the prod incident in #301 and back after' } as never)
    await ui.press({ key: 'resume' })
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
  const TEST_FILE = `${ROOT}/tests/utils/formatDuration.test.ts`
  const RUN_OWN_TEST = 'npx vitest run tests/utils/formatDuration.test.ts'
  const remembered = (ageMs: number, extra: Record<string, unknown> = {}) => ({
    [`unlocks:${ROOT}`]: {
      'utils/formatDuration': { testPath: TEST_FILE, atMs: T0 - ageMs, ...extra },
    },
  })

  // #54: a carry-over is pending. The first edit waits for one run of the test this session, so every edit has a
  // baseline from this session and a test reverted or broken since cannot hide behind yesterday's unlock.
  test('a test touched in an earlier session is remembered, but the first edit waits for one run of it, and says why', async ($, on) => {
    fakeEngine(on, { store: remembered(2 * HOUR) })
    await startSession($)

    const first = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(first.deny).toMatch(/unlocked 2H AGO in an earlier session, when tests\/utils\/formatDuration\.test\.ts was touched/)
    expect(first.deny).toMatch(/run that test once, red or green: .*tests\/utils\/formatDuration\.test\.ts/)
    expect(first.deny).toMatch(/Why: /)
    expect(first.deny).not.toMatch(/write the failing test first/)
    expect(status.text).toMatch(/unlocked earlier: utils.formatDuration/)
    expect(status.text).toMatch(/blocked 0/)
    expect(status.text).toMatch(/needs a run/)
  })

  test('a green run of its test makes it active: the agent is told, and the edit goes through', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR) })
    world.existingFiles.add(TEST_FILE)
    await startSession($)

    const run = await runBash($, RUN_OWN_TEST)
    const edit = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(run.context?.join(' ')).toMatch(/ran green this session, so the unlock of src\/utils\/formatDuration carried over from an earlier session is active again/)
    expect(edit.deny).toBeUndefined()
    expect(status.text).not.toMatch(/unlocked earlier/)
  })

  test('a red run activates it too, and says the failures were already there', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR) })
    world.existingFiles.add(TEST_FILE)
    await startSession($)

    world.bashFails = true
    const run = await runBash($, RUN_OWN_TEST)
    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(run.context?.join(' ')).toMatch(/ran red this session, before any edit/)
    expect(edit.deny).toBeUndefined()
  })

  test('a run of another test file, or the whole suite, does not activate it', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR) })
    world.existingFiles.add(`${ROOT}/tests/utils/other.test.ts`)
    await startSession($)

    await runBash($, 'npx vitest run tests/utils/other.test.ts')
    await runTests($, world, 'pass')
    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toMatch(/run that test once/)
  })

  test('a run filtered to some tests by name does not activate it', async ($, on) => {
    fakeEngine(on, { store: remembered(2 * HOUR) })
    await startSession($)

    await runBash($, `${RUN_OWN_TEST} -t months`)
    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toMatch(/run that test once/)
  })

  test('a shell write to the source waits for the run the same way', async ($, on) => {
    fakeEngine(on, { store: remembered(2 * HOUR) })
    await startSession($)

    const result = await runBash($, "sed -i 's/a/b/' src/utils/formatDuration.ts")

    expect(result.deny).toMatch(/unlocked 2H AGO in an earlier session/)
  })

  test('touching the test this session unlocks it outright, as before', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR) })
    await startSession($)

    await touchTest($, world, 'utils/formatDuration')
    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toBeUndefined()
  })

  test('in warn mode the edit goes through, with the reminder after it', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR) })
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"mode":"warn"}')
    await startSession($)

    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toBeUndefined()
    expect(edit.context?.join(' ')).toMatch(/touched 2H AGO in an earlier session/)
  })

  test('an unlock remembered under the normalised root is found by a session that spells the root the other way', async ($, on) => {
    fakeEngine(on, {
      store: {
        [`unlocks:${ROOT.replace(/^C:/, 'c:')}`]: {
          'utils/formatDuration': { testPath: TEST_FILE, atMs: T0 - 2 * HOUR },
        },
      },
    })
    await startSession($)

    const result = await editAt($, 'src/utils/formatDuration.ts')

    expect(result.deny).toMatch(/unlocked 2H AGO in an earlier session/)
  })

  // What the next session seeds from. Read from the store itself: the fake engine keeps $.state across startSession,
  // and a re-seed never re-gates a module unlocked in this session, so a status line here would not show it.
  test('touching a test is remembered for the next session, with a hash of its content', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/calculateDuration')

    const stored = world.store.get(unlockKey(ROOT)) as Record<string, { testPath: string; testHash?: string }>

    expect(stored['utils/calculateDuration']?.testPath).toBe(`${ROOT}/tests/utils/calculateDuration.test.ts`)
    expect(stored['utils/calculateDuration']?.testHash).toBe(contentHash(TEST_SOURCE))
  })

  test('a carried-over unlock whose test is unchanged since stays pending', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR, { testHash: contentHash(TEST_SOURCE) }) })
    world.existingFiles.add(TEST_FILE)
    await startSession($)

    const edit = await editAt($, 'src/utils/formatDuration.ts')

    expect(edit.deny).toMatch(/run that test once/)
  })

  test('a carried-over unlock whose test changed since is dropped, and the refusal says why', async ($, on) => {
    const world = fakeEngine(on, { store: remembered(2 * HOUR, { testHash: contentHash('the test as it was') }) })
    world.existingFiles.add(TEST_FILE)
    await startSession($)

    const edit = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(edit.deny).toMatch(/write the failing test first/)
    expect(edit.deny).toMatch(/unlocked it 2H AGO in an earlier session, but that test has changed since/)
    expect(status.text).not.toMatch(/unlocked earlier/)
    expect(status.text).toMatch(/stale-unlock/)
  })

  test('an unlock older than seven days is forgotten', async ($, on) => {
    fakeEngine(on, { store: remembered(8 * DAY) })
    await startSession($)

    const result = await editAt($, 'src/utils/formatDuration.ts')

    expect(result.deny).toMatch(/write the failing test first/)
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

    await $.command.run({ command: 'tdd', args: 'pause 30 pairing on the prod incident in #301 and back after' } as never)
    await ui.press({ key: 'resume' })

    expect(world.toasts).toEqual(['TDD guard paused for 30m', 'TDD guard resumed'])
  })
})

describe('honest phases on the band', () => {
  test('a touched but unrun test shows WRITING, not RED', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })

    expect(await ui.find({ type: 'Text', text: 'red ·' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^RED/ })).toBeUndefined()
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

    // Band v3: the unguarded edit is counted in /tdd; the green that never failed is the verdict's.
    expect((await runCommand($, 'tdd')).text).toMatch(/unguarded 1/)
    expect(await ui.find({ type: 'Text', text: 'UNPROVEN · never failed' })).toBeDefined()
  })

  test('a test run that names a test file makes that module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await runBash($, `npx vitest run ${ROOT}/tests/utils/formatDuration.test.ts`)

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
  })

  test('an allowed source edit makes its module current', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/calculateDuration')

    await editAt($, 'src/utils/formatDuration.ts')

    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'utils/formatDuration' })).toBeDefined()
  })
})

describe('a red on the module\u2019s own test unlocks it', () => {
  test('a run that names the test file and fails unlocks the module for the fix, and the fix is then caught', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/tests/utils/formatDuration.test.ts`)
    world.fileContents.set(SOURCE, 'export const a = 1')
    world.bashFails = true

    const red = await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const allowed = await editAt($, 'src/utils/formatDuration.ts')
    world.bashFails = false
    world.catchRun = { text: FAIL_SUMMARY, exitCode: 1 }
    await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const status = await runCommand($, 'tdd')

    expect(red.context?.join(' ')).toMatch(/utils\/formatDuration unlocked by a red run of its own test/)
    expect(allowed.deny).toBeUndefined()
    expect(status.text).toMatch(/proven 1/)
  })

  test('a whole-suite run whose FAIL line names the module\u2019s test unlocks it too', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/tests/utils/formatDuration.test.ts`)
    world.bashFails = true
    world.bashText = ' FAIL  tests/utils/formatDuration.test.ts\n\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'

    await runBash($, 'npx vitest run')
    const allowed = await editAt($, 'src/utils/formatDuration.ts')

    expect(allowed.deny).toBeUndefined()
  })

  test('a green run alone does not unlock', async ($, on) => {
    const world = fakeEngine(on)
    world.existingFiles.add(`${ROOT}/tests/utils/formatDuration.test.ts`)

    await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const blocked = await editAt($, 'src/utils/formatDuration.ts')

    expect(blocked.deny).toMatch(/or run it and see it fail/)
  })
})

describe('a touch that changes nothing', () => {
  test('re-saving a test unchanged still unlocks, and is recorded and said as a workaround', async ($, on) => {
    const world = fakeEngine(on)
    const body = "it('x', () => { expect(1).toBe(1) })"

    await writeAt($, 'tests/utils/formatDuration.test.ts', body)
    const again = await writeAt($, 'tests/utils/formatDuration.test.ts', body)
    const allowed = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(again.context?.join(' ')).toMatch(/re-saved unchanged/)
    expect(allowed.deny).toBeUndefined()
    expect(status.text).toMatch(/workarounds: 1 \(touched unchanged 1\)/)
  })

  // Decided 2026-10-20 (verified review A12): a comment in a test can be honest, so it still unlocks, but it is said and
  // on the record as changing no test, never hidden; it is no workaround.
  test('a test edit that changes only comments still unlocks, is said, and is on the record but not a workaround', async ($, on) => {
    const world = fakeEngine(on)
    const body = "it('x', () => { expect(1).toBe(1) })"

    await writeAt($, 'tests/utils/formatDuration.test.ts', body)
    const comment = await writeAt($, 'tests/utils/formatDuration.test.ts', `// next: the hour boundary\n${body}`)
    const allowed = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(comment.context?.join(' ')).toMatch(/changed only comments or blank lines/)
    expect(allowed.deny).toBeUndefined()
    expect(status.text).toMatch(/touched, comments only utils\/formatDuration/)
    expect(status.text).not.toMatch(/workarounds: [1-9]/)
  })
})

describe('the briefing in the system prompt', () => {
  test('a section is added after the engine\u2019s own, naming the rules and this project\u2019s test command', async ($, on) => {
    fakeEngine(on)
    await startSession($)

    const composed = (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Write', 'Bash'], outputStyle: null, traits: [] })) as { sections: { id: string; text: string; scope: string }[] }

    expect(composed.sections[0]?.id).toBe('intro')
    const briefing = composed.sections.find(section => section.id === 'dope-tdd:briefing')
    expect(briefing?.scope).toBe('session')
    expect(briefing?.text).toMatch(/Dope TDD is on in this project \(mode: enforce\)/)
    expect(briefing?.text).toMatch(/node_modules\/vitest\/vitest\.mjs|npx vitest run <test file>/)
  })

  test('touching a test hands the agent the exact command to run it', async ($, on) => {
    fakeEngine(on)

    const touched = await writeAt($, 'tests/utils/formatDuration.test.ts', "it('x', () => { expect(1).toBe(2) })")

    expect(touched.context?.join(' ')).toMatch(/Run it with: npx vitest run tests\/utils\/formatDuration\.test\.ts/)
  })
})

describe('a refused file that looks like a throwaway script (#32)', () => {
  test('the refusal says where one-off scripts go', async ($, on) => {
    fakeEngine(on)

    const scratch = await editAt($, 'src/orig.index.tmp.ts')
    const ordinary = await editAt($, 'src/utils/a.ts')

    expect(scratch.deny).toMatch(/write the failing test first/)
    expect(scratch.deny).toMatch(/One-off script\? Put it outside the repo \(your scratchpad or temp directory\); dope-tdd guards project sources\./)
    expect(ordinary.deny).not.toMatch(/One-off script/)
  })

  test('the same hint comes with a shell write refused for that file', async ($, on) => {
    fakeEngine(on)

    const result = await runBash($, 'echo "x" > src/scratch/compare.ts')

    expect(result.deny).toMatch(/One-off script\?/)
  })
})

// #222 (tester round 6): the briefing went only into the main session's system prompt, so a subagent learned the rules
// from its first refusal. It now rides on the prompt the subagent is spawned with.
describe('a subagent is briefed when it is spawned', () => {
  const spawnSeen = (on: Parameters<typeof fakeEngine>[0]) => {
    const seen: { prompt?: string } = {}
    // Stands in for the engine: records the prompt the subagent would run with.
    on('agent.spawn', (_$, e) => {
      seen.prompt = (e as { prompt: string }).prompt
      return { model: 'm', agentId: 'a1' }
    })
    return seen
  }

  test("the subagent's prompt keeps its task and gains the rules", async ($, on) => {
    fakeEngine(on)
    const seen = spawnSeen(on)

    await $.agent.spawn({ prompt: 'Fix the date bug.' })

    expect(seen.prompt?.startsWith('Fix the date bug.')).toBe(true)
    expect(seen.prompt).toMatch(/Dope TDD is on in this project \(mode: enforce\)/)
    expect(seen.prompt).toMatch(/mcp__dope-tdd__override_request/)
  })

  test('a fork, which inherits the briefing with its context, is not briefed again', async ($, on) => {
    fakeEngine(on)
    const seen = spawnSeen(on)

    await $.agent.spawn({ prompt: 'Fix the date bug.', subagentType: 'fork' } as never)

    expect(seen.prompt).toBe('Fix the date bug.')
  })
})

// #198: unlocks were kept by module name only, so a test touched in one checkout unlocked the same module in another.
// The rule "a test before this code" was met by a test in a different copy of the code.
describe('an unlock belongs to the checkout its test was touched in', () => {
  test("a test touched in an agent worktree does not unlock the main checkout's module", async ($, on) => {
    fakeEngine(on)

    await editAt($, '.claude/worktrees/agent-x/tests/utils/calculateDuration.test.ts')
    const main = await editAt($, 'src/utils/calculateDuration.ts')

    expect(main.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  test("a test touched in the main checkout does not unlock an agent worktree's module", async ($, on) => {
    fakeEngine(on)

    await editAt($, 'tests/utils/calculateDuration.test.ts')
    const worktree = await editAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')

    expect(worktree.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })

  // The small fix (2026-10-29): the unlock list still holds one test per module, so when both checkouts work on the
  // same module, the last touch holds the unlock and the other checkout is refused until it touches its test again.
  // It fails safe: never an edit let through, at worst one asked for twice.
  test('both checkouts on one module: the last touch holds the unlock, and the other is refused, never let through', async ($, on) => {
    fakeEngine(on)

    await editAt($, '.claude/worktrees/agent-x/tests/utils/calculateDuration.test.ts')
    await editAt($, 'tests/utils/calculateDuration.test.ts')

    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()
    expect((await editAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')).deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)

    await editAt($, '.claude/worktrees/agent-x/tests/utils/calculateDuration.test.ts')
    expect((await editAt($, '.claude/worktrees/agent-x/src/utils/calculateDuration.ts')).deny).toBeUndefined()
  })

  test('a shell write to the main checkout is not let through by a test touched in an agent worktree', async ($, on) => {
    fakeEngine(on)

    await editAt($, '.claude/worktrees/agent-x/tests/utils/calculateDuration.test.ts')
    const result = await runBash($, `sed -i 's/a/b/' ${ROOT}/src/utils/calculateDuration.ts`)

    expect(result.deny).toMatch(/tests\/utils\/calculateDuration\.test\.ts/)
  })
})
