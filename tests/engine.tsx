import { mock, test as kitTest } from 'claude-code/testing'
import type { Engine, MockClock, TestRest } from 'claude-code/testing'

/**
 * How long a test that drives the plugin may run. The kit loads the whole hooks module again for each test (about
 * 120 ms of its time, against 14 ms for an empty module), so on a busy machine or a two-core Windows runner the first
 * test of a file could pass the kit's 5 s default and fail on time alone (2 of 10 runs on main, 2026-10-16).
 */
export const LIVE_TEST_TIMEOUT_MS = 20_000

/** `test` from the kit, with the live-test timeout unless the test names its own. */
export function test(name: string, ...rest: TestRest): void {
  if (rest.length === 1) {
    kitTest(name, { timeoutMs: LIVE_TEST_TIMEOUT_MS }, rest[0])
    return
  }
  const [options, body] = rest
  kitTest(name, { timeoutMs: LIVE_TEST_TIMEOUT_MS, ...options }, body)
}
import type { On } from 'claude-code'

/** Every fixture path lives on this drive, including a runner hoisted above the root. */
export const FIXTURE_DRIVE = 'C:/'
export const ROOT = `${FIXTURE_DRIVE}work/throughline`

/**
 * The fixture paths are Windows-shaped. On a POSIX host they are not
 * absolute, so the engine resolves them against the real cwd before an fs
 * event reaches these stubs; a path is therefore read from where the fixture
 * drive starts, whatever the host put in front of it, with forward slashes.
 */
export function fakePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const at = slashed.indexOf(FIXTURE_DRIVE)
  return at >= 0 ? slashed.slice(at) : slashed
}
export const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
export const MINUTE = 60_000
export const TEST_SOURCE = "it('formats months', () => {\n  expect(formatDuration(14)).toBe('1y 2m')\n})\n"
export const SOURCE = `${ROOT}/src/utils/formatDuration.ts`
export const PASS_SUMMARY = ' ✓ tests/utils/formatDuration.test.ts (1 test)\n\n Test Files  1 passed (1)\n      Tests  1 passed (1)\n'
/** A failure that names no file: since #165 a suite run thinned to this is a red elsewhere, not the module's red. */
export const FAIL_SUMMARY = ' Test Files  1 failed (1)\n      Tests  1 failed (1)\n'

/** What Vitest prints when `testPath` fails: its FAIL line, then the summary, so the red is that test's module's. */
export function failOutput(testPath: string | null): string {
  return testPath === null ? FAIL_SUMMARY : ` FAIL  ${testPath} > fails\n${FAIL_SUMMARY}`
}

export const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

export type FakeWorld = {
  clock: MockClock
  bashFails: boolean
  bashText: string
  /** The test file last written through Edit or Write, from the root: a failing run with no `bashText` names it. */
  lastTest: string | null
  testModifiedAt: number
  existingFiles: Set<string>
  fileContents: Map<string, string>
  openedPanes: string[]
  logs: string[]
  toasts: string[]
  numstat: string
  untracked: string
  gitCalls: (readonly string[])[]
  /** The working directory of each process run, in order, beside `gitCalls`. */
  runCwds: string[]
  /** Git refs and objects for the shared check lock; `gitUnavailable` makes the folder not a git checkout. */
  refs: Map<string, string>
  objects: Map<string, string>
  gitUnavailable: boolean
  /** Remote URLs by name, answered to `git config --get remote.<name>.url`. */
  remotes: Map<string, string>
  /** When true the engine cannot say where the project is, so every guard throws before it decides. */
  rootFails: boolean
  writes: [string, string][]
  catchRun: { text: string; exitCode: number } | 'reject'
  /** The check's baseline: the test run as it stands, before anything is reverted. Green unless a test says otherwise. */
  baselineRun: { text: string; exitCode: number }
  baselineCalls: number
  /** What the plugin's own run of a test file prints when the agent's output was cut and it needs every failing name. */
  namesRun: string
  namesCalls: number
  /** A baseline answered differently in one folder, by its cwd: the catch-check worktree, say. */
  baselineRunIn: Map<string, { text: string; exitCode: number }>
  /** Tracked files changed since HEAD, and deleted ones, as `git diff --name-only HEAD` lists them. */
  dirty: string
  deleted: string
  hasVitest: boolean
  onBash: (command: string) => void | Promise<void>
  /** What $.model.complete answers (the reviewer model), and every call it got. */
  modelReply: unknown
  modelCalls: { model: string; effort?: string; system?: string; prompt: string }[]
  /** The session's own model, as $.session.model() says. */
  sessionModel: string
  /** The surfaces drawing the session, as $.session.surfaces() says: the desktop app is one. */
  surfaces: string[]
  /** This session's id, as $.session.id() says. */
  sessionId: string
  /** How many times $.session.id() was asked. */
  sessionIdCalls: number
  /** What `git log -1 --format=%h|%cs|%s` prints in the plugin's own folder: which build is running. */
  pluginGit: string
  /** What `git diff --no-ext-diff -- <paths>` prints: the module's hunks for the reviewer. */
  diffText: string
  /** Claude Code held the shell command read-only by its own check (`ls`, `cat`, `git status`). */
  readOnly: boolean
  /** Called while the catch check has the source reverted on disk, before the runner answers. */
  onCatchRun: () => void | Promise<void>
  /** Called while the catch check runs its baseline, before anything is reverted: a save from your editor, say. */
  onBaselineRun: () => void | Promise<void>
  /** Return true to make a write to that path fail. */
  writeFails: (path: string, text: string) => boolean
  /** Paths that exist but cannot be read (too large, locked). */
  unreadable: Set<string>
  /** Symbolic links, link path to target: `fs.stat` with `resolve` answers the real path through them. */
  links: Map<string, string>
  /** The plugin store, readable by tests (#54): mock.store answers the hooks but gives a test nothing to inspect. */
  store: Map<string, unknown>
}

/** Where a path lands with every link in `links` followed (the longest link that prefixes it wins). */
function landed(links: ReadonlyMap<string, string>, path: string): string {
  const link = [...links.keys()].filter(from => path === from || path.startsWith(`${from}/`)).sort((a, b) => b.length - a.length)[0]
  return link === undefined ? path : landed(links, `${links.get(link) ?? link}${path.slice(link.length)}`)
}

export type FakeOptions = { store?: Readonly<Record<string, unknown>>; env?: Readonly<Record<string, string>> }

export function fakeEngine(on: On, options: FakeOptions = {}): FakeWorld {
  const world: FakeWorld = {
    clock: mock.clock(on, { now: T0 }),
    bashFails: false,
    bashText: '',
    lastTest: null,
    testModifiedAt: T0,
    existingFiles: new Set(),
    fileContents: new Map(),
    openedPanes: [],
    logs: [],
    toasts: [],
    numstat: '',
    untracked: '',
    gitCalls: [],
    runCwds: [],
    refs: new Map(),
    objects: new Map(),
    gitUnavailable: false,
    remotes: new Map(),
    rootFails: false,
    writes: [],
    catchRun: { text: ' Tests  1 failed (1)\n', exitCode: 1 },
    baselineRun: { text: ' Tests  1 passed (1)\n', exitCode: 0 },
    baselineCalls: 0,
    namesRun: '',
    namesCalls: 0,
    baselineRunIn: new Map(),
    dirty: '',
    deleted: '',
    hasVitest: true,
    onBash: () => {},
    modelReply: { isAnswered: true, text: 'DENY\nwrite the test first', usage: { input_tokens: 1, output_tokens: 1 } },
    modelCalls: [],
    sessionModel: 'claude-opus-5-5',
    surfaces: [],
    sessionId: 'session-1',
    sessionIdCalls: 0,
    pluginGit: '',
    diffText: '',
    readOnly: false,
    onCatchRun: () => {},
    onBaselineRun: () => {},
    writeFails: () => false,
    unreadable: new Set(),
    links: new Map(),
    store: new Map(Object.entries(options.store ?? {})),
  }

  on('store.get', (_$, e) => ({ value: world.store.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    world.store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    world.store.delete((e as { key: string }).key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }) as never)
  mock.env(on, options.env ?? {})
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }] }) as never)
  on('session.root', () => (world.rootFails ? { deny: 'the project root could not be read' } : { value: ROOT }))
  // The engine's own answer to a skill: its prompt text, unchanged (dope-tdd only watches which skill ran).
  on('skill.prompt', (_$, e) => ({ text: (e as { text: string }).text }))
  on('session.start', () => ({ cwd: ROOT }))
  on('session.model', () => ({ value: world.sessionModel }) as never)
  on('session.surfaces', () => ({ value: world.surfaces }) as never)
  on('session.id', () => {
    world.sessionIdCalls++
    return { value: world.sessionId } as never
  })
  on('model.complete', (_$, e) => {
    world.modelCalls.push(e as never)
    return { value: world.modelReply } as never
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('ui.log', (_$, e) => {
    world.logs.push(String((e as { text?: string }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__dope-tdd__${e.name}` } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', async (_$, e) => {
    world.gitCalls.push(e.argv)
    world.runCwds.push(fakePath(String((e as { init?: { cwd?: unknown } }).init?.cwd ?? '')))
    if (e.argv[0] !== 'git' && (e as { init?: { env?: Record<string, string> } }).init?.env?.DOPE_TDD_NAMES === '1') {
      world.namesCalls++
      return { value: { exitCode: 1, stdout: world.namesRun, stderr: '' } } as never
    }
    if (e.argv[0] !== 'git' && (e as { init?: { env?: Record<string, string> } }).init?.env?.DOPE_TDD_BASELINE === '1') {
      world.baselineCalls++
      await world.onBaselineRun()
      const run = world.baselineRunIn.get(world.runCwds[world.runCwds.length - 1] ?? '') ?? world.baselineRun
      return { value: { exitCode: run.exitCode, stdout: run.text, stderr: '' } } as never
    }
    if (e.argv[0] !== 'git') {
      await world.onCatchRun()
      return world.catchRun === 'reject'
        ? { deny: 'timed out' }
        : { value: { exitCode: world.catchRun.exitCode, stdout: world.catchRun.text, stderr: '' } } as never
    }
    // Git's own options come before the subcommand (`-c core.hooksPath=…`, `--no-optional-locks`): skip them, as git does.
    const args = e.argv.slice(1)
    while (args[0] === '-c' || args[0] === '--no-optional-locks') {
      args.splice(0, args[0] === '-c' ? 2 : 1)
    }
    const [verb, ...rest] = args
    const answer = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (verb === 'hash-object') {
      if (world.gitUnavailable) {
        return answer(128)
      }
      const sha = `sha${world.objects.size + 1}`
      world.objects.set(sha, String((e as { init?: { stdin?: unknown } }).init?.stdin ?? ''))
      return answer(0, `${sha}\n`)
    }
    if (verb === 'update-ref') {
      if (rest[0] === '-d') {
        const [, ref, expected] = rest
        if (ref === undefined || world.refs.get(ref) !== expected) return answer(1)
        world.refs.delete(ref)
        return answer(0)
      }
      const [ref, next, expected] = rest
      if (ref === undefined || next === undefined) return answer(128)
      const ok = expected === '' ? !world.refs.has(ref) : world.refs.get(ref) === expected
      if (!ok) return answer(expected === '' ? 128 : 1)
      world.refs.set(ref, next)
      return answer(0)
    }
    if (verb === 'rev-parse') {
      const ref = rest[rest.length - 1] ?? ''
      const sha = world.refs.get(ref)
      return sha === undefined ? answer(1) : answer(0, `${sha}\n`)
    }
    if (verb === 'cat-file') {
      const sha = rest[rest.length - 1] ?? ''
      const body = world.objects.get(sha)
      return body === undefined ? answer(128) : answer(0, body)
    }
    if (verb === 'config') {
      const url = world.remotes.get((rest[rest.length - 1] ?? '').replace(/^remote\.|\.url$/g, ''))
      return url === undefined ? answer(1) : answer(0, `${url}\n`)
    }
    if (verb === 'log' && e.argv.includes('--format=%h|%cs|%s')) {
      return answer(world.pluginGit === '' ? 128 : 0, world.pluginGit === '' ? '' : `${world.pluginGit}\n`)
    }
    if (verb === 'diff' && e.argv.includes('--no-ext-diff')) {
      return answer(0, world.diffText)
    }
    if (verb === 'diff' && e.argv.includes('--name-only')) {
      return answer(0, e.argv.includes('--diff-filter=D') ? world.deleted : world.dirty)
    }
    const isNumstat = e.argv.includes('--numstat')
    return { value: { exitCode: 0, stdout: isNumstat ? world.numstat : world.untracked, stderr: '' } } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-default" />
  })
  on('ui.open', (_$, e) => {
    world.openedPanes.push(e.id)
    return { value: { isOpen: true } } as never
  })
  on('fs.write', (_$, e) => {
    const path = fakePath(e.path)
    if (world.writeFails(path, e.text)) {
      return { deny: `EBUSY: ${path}` }
    }
    world.fileContents.set(path, e.text)
    world.writes.push([path, e.text])
    return { value: undefined } as never
  })
  on('fs.exists', (_$, e) => {
    const path = fakePath(e.path)
    return {
      value: world.fileContents.has(path) || world.existingFiles.has(path) || world.unreadable.has(path) || (world.hasVitest && path === `${ROOT}/node_modules/vitest/vitest.mjs`),
    } as never
  })
  on('fs.stat', (_$, e) => {
    const stat = { kind: 'file', size: 1, mtimeMs: world.testModifiedAt, isLink: false }
    return { value: e.resolve === true ? { ...stat, realPath: landed(world.links, fakePath(e.path)) } : stat } as never
  })
  on('fs.list', (_$, e) => {
    const dir = fakePath(e.path ?? ROOT).replace(/\/$/, '')
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of [...world.fileContents.keys(), ...world.existingFiles]) {
      if (!path.startsWith(`${dir}/`)) {
        continue
      }
      const [name, ...deeper] = path.slice(dir.length + 1).split('/')
      if (name !== undefined && name !== '') {
        names.set(name, deeper.length > 0 ? 'dir' : names.get(name) ?? 'file')
      }
    }
    // A file written in the test has its real size, so a test can see a record that changed (2026-10-26, integrity).
    const sizeOf = (name: string) => world.fileContents.get(`${dir}/${name}`)?.length ?? 1
    const entries = [...names].map(([name, kind]) => ({ name, kind, size: kind === 'file' ? sizeOf(name) : 1, mtimeMs: world.testModifiedAt, isLink: false }))
    return { value: entries } as never
  })
  on('fs.read', (_$, e) => {
    const path = fakePath(e.path)
    if (world.unreadable.has(path)) {
      return { deny: `EFBIG: ${e.path}` }
    }
    const custom = world.fileContents.get(path)
    if (custom !== undefined) {
      return { value: custom }
    }
    return world.existingFiles.has(path) || e.path.endsWith('.svg')
      ? { value: e.path.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : TEST_SOURCE }
      : { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', async (_$, e) => {
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    if (isShell) {
      await world.onBash(String((e as { command?: unknown }).command ?? ''))
    }
    const input = e as { file_path?: string; content?: string; old_string?: string; new_string?: string }
    const target = input.file_path === undefined ? undefined : fakePath(input.file_path)
    if (e.tool === 'Write' && target !== undefined && input.content !== undefined) {
      world.fileContents.set(target, input.content)
    }
    if (e.tool === 'Edit' && target !== undefined && input.old_string !== undefined && input.new_string !== undefined) {
      const current = world.fileContents.get(target)
      if (current !== undefined) {
        world.fileContents.set(target, current.replace(input.old_string, input.new_string))
      }
    }
    if ((e.tool === 'Write' || e.tool === 'Edit') && target !== undefined && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(target)) {
      world.lastTest = target.startsWith(`${ROOT}/`) ? target.slice(ROOT.length + 1) : target
    }
    if (isShell && world.bashFails) {
      return { isError: true as const, result: 'FAIL', text: world.bashText || failOutput(world.lastTest) }
    }
    // A real runner always prints its summary; a shell command that is not a test run prints whatever it prints.
    return { result: {} as never, text: world.bashText || PASS_SUMMARY, ...(isShell && world.readOnly ? { isReadOnly: true as const } : {}) }
  })
  return world
}

export async function startSession($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

export async function editAt($: Engine, relative: string) {
  return $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/${relative}`,
    old_string: 'a',
    new_string: 'b',
  } as never)
}

export async function writeAt($: Engine, relative: string, content = 'x') {
  return $.tool.call({
    tool: 'Write',
    file_path: `${ROOT}/${relative}`,
    content,
  } as never)
}

export async function runTests($: Engine, world: FakeWorld, outcome: 'pass' | 'fail') {
  world.bashFails = outcome === 'fail'
  return $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
}

export async function runBash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command } as never)
}

export async function runPowerShell($: Engine, command: string) {
  return $.tool.call({ tool: 'PowerShell', command } as never)
}

export async function runCommand($: Engine, command: string) {
  return $.command.run({ command, args: '' } as never)
}

export async function touchTest($: Engine, world: FakeWorld, module: string, ext = 'ts') {
  const relative = `tests/${module}.test.${ext}`
  world.existingFiles.add(`${ROOT}/${relative}`)
  return editAt($, relative)
}

/** Touch the test, see it fail, then edit the source: the state every catch-check scenario starts from. */
export async function fixUnderGuard($: Engine, world: FakeWorld) {
  world.fileContents.set(SOURCE, 'export const a = 1')
  await touchTest($, world, 'utils/formatDuration')
  await runTests($, world, 'fail')
  await editAt($, 'src/utils/formatDuration.ts')
}
