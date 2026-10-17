// Replays the shell commands of real Claude Code sessions through Dope TDD's detectors, so their guesses can be
// measured against what agents actually type instead of the cases someone thought of. For every Bash and PowerShell
// call in the transcripts it asks: is this a test run, and what did the runner's output read as; which source files
// does the command write; and is it a command that looks like a write the detector did not see. It runs nothing.
//
//   node tools/replay/replay.ts [--transcripts <dir>] [--json] [--samples <n>]
//
// <dir> defaults to ~/.claude/projects. The report prints commands from your own sessions: read it locally, and do
// not paste it anywhere public without reading it first.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { findSourceWrites } from '../../hooks/bashWrites.ts'
import { runnerDidNotStart, unreadableRunner } from '../../hooks/runOutcome.ts'
import { isTestRun, readRun } from '../../hooks/runners.ts'
import { STACKS } from '../../hooks/stacks.ts'

export type ShellCall = { tool: 'Bash' | 'PowerShell'; command: string; output: string | null; file: string }

type Detector = 'testRun' | 'writes' | 'read'
type Sample = { command: string; output?: string; file: string }

export type Report = {
  files: number
  shellCalls: number
  testRuns: number
  outcomes: Record<'pass' | 'fail' | 'unknown' | 'none' | 'no output', number>
  unreadableRunners: Record<string, number>
  runnerDidNotStart: number
  commandsWithWrites: number
  writtenPaths: number
  suspectedMissedWrites: number
  timingMs: Record<Detector, { total: number; max: number }>
  samples: { unknown: Sample[]; suspectedMissed: Sample[]; writes: Sample[] }
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
// A command that looks like it writes a file: an in-place edit, a redirect into a file (not `2>&1`, not /dev/null),
// a copy, or a script write call.
const WRITE_TOKEN = /\bsed\s+(?:-\w+\s+)*-i|\bperl\s+(?:-\w+\s+)*-p?i|(?<![\d&>])>>?(?!&)\s*(?!\/dev\/)[\w./~'"$]|\btee\b|\b(?:cp|mv|install)\s|writeFile|write_text|open\([^)]*['"][wa]|Set-Content|Add-Content|Out-File|\bsponge\b|\bpatch\b|\bgit\s+apply\b/
const CODE_FILE = /[\w./@-]+\.(?:[cm]?[jt]sx?|py|gd|cs|java|kts?)(?![\w.-])/g

/** The code files a command names that are not tests: the only ones a missed write would matter for. */
function sourceMentions(command: string): string[] {
  return [...command.matchAll(CODE_FILE)].map(match => match[0]).filter(path => !path.endsWith('.d.ts') && !Object.values(STACKS).some(stack => stack.testFile.test(path)))
}
const MAX_COMMAND = 160
const MAX_OUTPUT_LINES = 3

function textOf(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    const texts = content.flatMap(block => (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string' ? [(block as { text: string }).text] : []))
    return texts.length === 0 ? null : texts.join('\n')
  }
  return null
}

function blocksOf(record: unknown): unknown[] {
  const content = (record as { message?: { content?: unknown } } | null)?.message?.content
  return Array.isArray(content) ? content : []
}

/** Every shell call in one transcript's lines, paired with its result's text when the result is there. A line that is not JSON is skipped. */
export function shellCalls(lines: readonly string[], file: string): ShellCall[] {
  const calls = new Map<string, ShellCall>()
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    for (const block of blocksOf(record)) {
      const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: { command?: unknown }; tool_use_id?: unknown; content?: unknown }
      if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && SHELL_TOOLS.has(b.name) && typeof b.input?.command === 'string') {
        calls.set(b.id, { tool: b.name as ShellCall['tool'], command: b.input.command, output: null, file })
      } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const call = calls.get(b.tool_use_id)
        if (call !== undefined) {
          call.output = textOf(b.content)
        }
      }
    }
  }
  return [...calls.values()]
}

function timed<T>(timing: Report['timingMs'], detector: Detector, work: () => T): T {
  const started = performance.now()
  const value = work()
  const spent = performance.now() - started
  timing[detector].total += spent
  timing[detector].max = Math.max(timing[detector].max, spent)
  return value
}

function sample(call: ShellCall, withOutput: boolean): Sample {
  const command = call.command.split('\n')[0] ?? ''
  const shown = command.length > MAX_COMMAND ? `${command.slice(0, MAX_COMMAND)}…` : command
  const output = withOutput && call.output !== null ? call.output.trimEnd().split('\n').slice(-MAX_OUTPUT_LINES).join('\n') : undefined
  return { command: shown, ...(output === undefined ? {} : { output }), file: call.file }
}

/** What the detectors make of each call, counted, with the first `samples` examples of each kind worth a look. */
export function replay(calls: readonly ShellCall[], files: number, samples = 5): Report {
  const report: Report = {
    files,
    shellCalls: calls.length,
    testRuns: 0,
    outcomes: { pass: 0, fail: 0, unknown: 0, none: 0, 'no output': 0 },
    unreadableRunners: {},
    runnerDidNotStart: 0,
    commandsWithWrites: 0,
    writtenPaths: 0,
    suspectedMissedWrites: 0,
    timingMs: { testRun: { total: 0, max: 0 }, writes: { total: 0, max: 0 }, read: { total: 0, max: 0 } },
    samples: { unknown: [], suspectedMissed: [], writes: [] },
  }
  const keep = (list: Sample[], item: Sample) => {
    if (list.length < samples) {
      list.push(item)
    }
  }
  for (const call of calls) {
    const writes = timed(report.timingMs, 'writes', () => findSourceWrites(call.command))
    if (writes.length > 0) {
      report.commandsWithWrites++
      report.writtenPaths += writes.length
      keep(report.samples.writes, sample(call, false))
    } else if (WRITE_TOKEN.test(call.command) && sourceMentions(call.command).length > 0) {
      report.suspectedMissedWrites++
      keep(report.samples.suspectedMissed, sample(call, false))
    }
    if (!timed(report.timingMs, 'testRun', () => isTestRun(call.command))) {
      continue
    }
    report.testRuns++
    if (call.output === null) {
      report.outcomes['no output']++
      continue
    }
    const output = call.output
    const outcome = timed(report.timingMs, 'read', () => readRun(output))
    report.outcomes[outcome]++
    if (outcome !== 'unknown') {
      continue
    }
    const runner = unreadableRunner(output)
    if (runner !== null) {
      report.unreadableRunners[runner] = (report.unreadableRunners[runner] ?? 0) + 1
    } else if (runnerDidNotStart(output) !== null) {
      report.runnerDidNotStart++
    } else {
      keep(report.samples.unknown, sample(call, true))
    }
  }
  return report
}

function ms(value: number): string {
  return `${value.toFixed(2)} ms`
}

/** The report as text a person reads: the counts first, then the examples worth a look. */
export function formatReport(report: Report): string {
  const { outcomes, timingMs } = report
  const unreadable = Object.entries(report.unreadableRunners).map(([runner, count]) => `${runner} ${count}`)
  const average = (detector: Detector) => ms(report.shellCalls === 0 ? 0 : timingMs[detector].total / report.shellCalls)
  const section = (title: string, list: readonly Sample[]) =>
    list.length === 0 ? [] : ['', `${title}:`, ...list.flatMap(item => [`  $ ${item.command}`, ...(item.output === undefined ? [] : item.output.split('\n').map(line => `    | ${line}`))])]
  return [
    `dope-tdd replay: ${report.shellCalls} shell calls in ${report.files} transcript files`,
    `test runs: ${report.testRuns} (pass ${outcomes.pass}, fail ${outcomes.fail}, unread ${outcomes.unknown}, not a run ${outcomes.none}, no output kept ${outcomes['no output']})`,
    `  of the unread: ${unreadable.length === 0 ? 'no runner it cannot read' : `runners it cannot read yet: ${unreadable.join(', ')}`}; runner did not start ${report.runnerDidNotStart}`,
    `writes: ${report.commandsWithWrites} commands wrote ${report.writtenPaths} source paths; ${report.suspectedMissedWrites} more look like writes to a code file and were not seen`,
    `time per call: writes ${average('writes')} (max ${ms(timingMs.writes.max)}), test run ${average('testRun')} (max ${ms(timingMs.testRun.max)}), reading output max ${ms(timingMs.read.max)}`,
    ...section('unread runs nobody recognised (output tail)', report.samples.unknown),
    ...section('look like writes, not seen (check each: a miss, or not a write)', report.samples.suspectedMissed),
    ...section('writes seen', report.samples.writes),
  ].join('\n')
}

function transcriptFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      found.push(...transcriptFiles(path))
    } else if (name.endsWith('.jsonl')) {
      found.push(path)
    }
  }
  return found
}

function main(): void {
  const argv = process.argv.slice(2)
  const option = (name: string) => {
    const at = argv.indexOf(name)
    return at === -1 ? undefined : argv[at + 1]
  }
  const dir = option('--transcripts') ?? join(homedir(), '.claude', 'projects')
  const samples = Number(option('--samples') ?? 5)
  if (!Number.isInteger(samples) || samples < 0) {
    throw new Error('--samples takes a whole number')
  }
  const files = transcriptFiles(dir)
  const calls = files.flatMap(file => shellCalls(readFileSync(file, 'utf8').split(/\r?\n/), file))
  const report = replay(calls, files.length, samples)
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report))
}

if (process.argv[1] !== undefined && /replay\.ts$/.test(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(`dope-tdd replay: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
