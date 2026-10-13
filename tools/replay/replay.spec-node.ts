// npx tsx --test tools/replay/replay.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatReport, replay, shellCalls } from './replay'
import type { ShellCall } from './replay'

function use(id: string, name: string, command: string): string {
  return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { command } }] } })
}

function result(id: string, content: unknown): string {
  return JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })
}

function call(command: string, output: string | null = null): ShellCall {
  return { tool: 'Bash', command, output, file: 't.jsonl' }
}

test('shell calls are paired with their result, in either content shape; other tools and broken lines are skipped', () => {
  const lines = [
    use('a', 'Bash', 'npx vitest run'),
    'not json {',
    use('b', 'Read', 'ignored'),
    use('c', 'PowerShell', 'Get-ChildItem'),
    result('a', ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n'),
    result('c', [{ type: 'text', text: 'dir listing' }]),
  ]
  assert.deepEqual(shellCalls(lines, 't.jsonl'), [
    { tool: 'Bash', command: 'npx vitest run', output: ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n', file: 't.jsonl' },
    { tool: 'PowerShell', command: 'Get-ChildItem', output: 'dir listing', file: 't.jsonl' },
  ])
})

test('each test run is read as the plugin reads it, and an unread run is explained when it can be', () => {
  const report = replay(
    [
      call('npx vitest run', ' Test Files  1 passed (1)\n      Tests  1 passed (1)\n'),
      call('npm test', '\n  1 passing (4ms)\n'),
      call('npm test', 'bash: vitest: command not found\n'),
      call('npm test', 'the summary was cut\n'),
      call('npx vitest run'),
      call('ls src'),
    ],
    1,
  )
  assert.equal(report.testRuns, 5)
  assert.deepEqual(report.outcomes, { pass: 1, fail: 0, unknown: 3, none: 0, 'no output': 1 })
  assert.deepEqual(report.unreadableRunners, { mocha: 1 })
  assert.equal(report.runnerDidNotStart, 1)
  assert.deepEqual(report.samples.unknown.map(item => item.output), ['the summary was cut'])
})

test('writes the detector sees are counted; a command that looks like a write to a code file and is not seen is flagged', () => {
  const report = replay(
    [
      call("sed -i 's/a/b/' src/a.ts"),
      call("perl -pi -e 's/a/b/' src/b.ts"),
      call('cat src/c.ts'),
      call('echo x > notes.md'),
      call('node scripts/build.mjs src/d.ts 2>&1 | tail -3'),
      call('grep -n x src/e.ts > /dev/null'),
      call("perl -pi -e 's/a/b/' tests/utils/a.test.ts"),
    ],
    1,
  )
  assert.equal(report.commandsWithWrites, 1)
  assert.equal(report.writtenPaths, 1)
  assert.equal(report.suspectedMissedWrites, 1)
  assert.deepEqual(report.samples.suspectedMissed.map(item => item.command), ["perl -pi -e 's/a/b/' src/b.ts"])
})

test('samples are capped and long commands are cut; the text report leads with the counts', () => {
  const many = Array.from({ length: 8 }, (_, i) => call(`npm test # ${'x'.repeat(200)} ${i}`, 'cut\n'))
  const report = replay(many, 2, 3)
  assert.equal(report.samples.unknown.length, 3)
  assert.ok((report.samples.unknown[0]?.command.length ?? 0) <= 161)
  const text = formatReport(report)
  assert.match(text, /^dope-tdd replay: 8 shell calls in 2 transcript files/)
  assert.match(text, /test runs: 8 \(pass 0, fail 0, unread 8/)
})
