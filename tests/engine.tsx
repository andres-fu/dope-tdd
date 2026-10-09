import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
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
/** A failure that names no file: the module under test is red, as a run of its own test would say. */
export const FAIL_SUMMARY = ' Test Files  1 failed (1)\n      Tests  1 failed (1)\n'

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
  testModifiedAt: number
  existingFiles: Set<string>
  fileContents: Map<string, string>
  openedPanes: string[]
  logs: string[]
  toasts: string[]
  numstat: string
  untracked: string
  gitCalls: (readonly string[])[]
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
  hasVitest: boolean
  onBash: (command: string) => void
  /** Called while the catch check has the source reverted on disk, before the runner answers. */
  onCatchRun: () => void | Promise<void>
  /** Return true to make a write to that path fail. */
  writeFails: (path: string, text: string) => boolean
  /** Paths that exist but cannot be read (too large, locked). */
  unreadable: Set<string>
}

export type FakeOptions = { store?: Readonly<Record<string, unknown>>; env?: Readonly<Record<string, string>> }

export function fakeEngine(on: On, options: FakeOptions = {}): FakeWorld {
  const world: FakeWorld = {
    clock: mock.clock(on, { now: T0 }),
    bashFails: false,
    bashText: '',
    testModifiedAt: T0,
    existingFiles: new Set(),
    fileContents: new Map(),
    openedPanes: [],
    logs: [],
    toasts: [],
    numstat: '',
    untracked: '',
    gitCalls: [],
    refs: new Map(),
    objects: new Map(),
    gitUnavailable: false,
    remotes: new Map(),
    rootFails: false,
    writes: [],
    catchRun: { text: ' Tests  1 failed (1)\n', exitCode: 1 },
    hasVitest: true,
    onBash: () => {},
    onCatchRun: () => {},
    writeFails: () => false,
    unreadable: new Set(),
  }

  mock.store(on, options.store)
  mock.env(on, options.env ?? {})
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }] }) as never)
  on('session.root', () => (world.rootFails ? { deny: 'the project root could not be read' } : { value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
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
    if (e.argv[0] !== 'git') {
      await world.onCatchRun()
      return world.catchRun === 'reject'
        ? { deny: 'timed out' }
        : { value: { exitCode: world.catchRun.exitCode, stdout: world.catchRun.text, stderr: '' } } as never
    }
    const [, verb, ...rest] = e.argv
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
      value: world.fileContents.has(path) || world.existingFiles.has(path) || world.unreadable.has(path) || (world.hasVitest && path.endsWith('vitest.mjs')),
    } as never
  })
  on('fs.stat', () => ({
    value: { kind: 'file', size: 1, mtimeMs: world.testModifiedAt, isLink: false },
  }) as never)
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
    const entries = [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: world.testModifiedAt, isLink: false }))
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
  on('tool.call', (_$, e) => {
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    if (isShell) {
      world.onBash(String((e as { command?: unknown }).command ?? ''))
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
    if (isShell && world.bashFails) {
      return { isError: true as const, result: 'FAIL', text: world.bashText || FAIL_SUMMARY }
    }
    // A real runner always prints its summary; a shell command that is not a test run prints whatever it prints.
    return { result: {} as never, text: world.bashText || PASS_SUMMARY }
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
