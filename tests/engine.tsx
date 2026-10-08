import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = 'C:/work/throughline'
export const T0 = Date.UTC(2026, 9, 6, 12, 0, 0)
export const MINUTE = 60_000
export const TEST_SOURCE = "it('formats months', () => {\n  expect(formatDuration(14)).toBe('1y 2m')\n})\n"

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
  openedPanes: string[]
  logs: string[]
  toasts: string[]
  numstat: string
  untracked: string
  gitCalls: string[][]
  onBash: (command: string) => void
}

export function fakeEngine(on: On): FakeWorld {
  const world: FakeWorld = {
    clock: mock.clock(on, { now: T0 }),
    bashFails: false,
    bashText: '',
    testModifiedAt: T0,
    existingFiles: new Set(),
    openedPanes: [],
    logs: [],
    toasts: [],
    numstat: '',
    untracked: '',
    gitCalls: [],
    onBash: () => {},
  }

  on('session.root', () => ({ value: ROOT }))
  on('session.start', () => ({ cwd: ROOT }))
  on('ui.log', (_$, e) => {
    world.logs.push(String((e as { text?: string }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__red-first__${e.name}` } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('process.run', (_$, e) => {
    world.gitCalls.push(e.argv)
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
  on('fs.stat', () => ({
    value: { kind: 'file', size: 1, mtimeMs: world.testModifiedAt, isLink: false },
  }) as never)
  on('fs.read', (_$, e) =>
    world.existingFiles.has(e.path.replace(/\\/g, '/')) || e.path.endsWith('.svg')
      ? { value: e.path.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : TEST_SOURCE }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') {
      world.onBash(e.command)
    }
    return e.tool === 'Bash' && world.bashFails
      ? { isError: true as const, result: 'FAIL', text: world.bashText || 'Tests 1 failed' }
      : { result: {} as never, text: world.bashText }
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

export async function writeAt($: Engine, relative: string) {
  return $.tool.call({
    tool: 'Write',
    file_path: `${ROOT}/${relative}`,
    content: 'x',
  } as never)
}

export async function runTests($: Engine, world: FakeWorld, outcome: 'pass' | 'fail') {
  world.bashFails = outcome === 'fail'
  return $.tool.call({ tool: 'Bash', command: 'npx vitest run' } as never)
}

export async function runBash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command } as never)
}

export async function runCommand($: Engine, command: string) {
  return $.command.run({ command, args: '' } as never)
}

export async function touchTest($: Engine, world: FakeWorld, module: string, ext = 'ts') {
  const relative = `tests/${module}.test.${ext}`
  world.existingFiles.add(`${ROOT}/${relative}`)
  return editAt($, relative)
}
