// node --test tools/pr-check/action.spec-node.ts (not *.test.ts: the plugin test kit would load it)
// The action's inputs reach its shell steps as environment variables, never pasted into the script (#191).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const action = readFileSync(new URL('./action.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// `${{ inputs.base }}` written inside `run:` is pasted into the script before bash reads it, so a crafted
// value runs as shell (GitHub's script-injection pattern). The only safe place for it is an `env:` value.
test('no ${{ … }} expression is written inside a run: script', () => {
  const lines = action.split('\n')
  const inRun: string[] = []
  let runIndent = -1
  for (const line of lines) {
    const indent = line.length - line.trimStart().length
    if (runIndent >= 0 && line.trim() !== '' && indent <= runIndent) runIndent = -1
    const run = /^(\s*)run:/.exec(line)
    if (run !== null) {
      runIndent = run[1].length
      inRun.push(line)
      continue
    }
    if (runIndent >= 0) inRun.push(line)
  }
  assert.ok(inRun.length > 0, 'the action has run: steps')
  assert.deepEqual(inRun.filter(line => line.includes('${{')), [])
})

test('every input the scripts use is passed through env:', () => {
  for (const input of ['base', 'fail-on', 'timeout-ms']) {
    assert.match(action, new RegExp(`^\\s+[A-Z_]+: \\$\\{\\{ inputs\\.${input} \\}\\}$`, 'm'), input)
  }
})

test('the scripts quote the variables they read', () => {
  assert.match(action, /"origin\/\$BASE"/)
  assert.doesNotMatch(action, /[^"]\$BASE\b(?!")/)
})
