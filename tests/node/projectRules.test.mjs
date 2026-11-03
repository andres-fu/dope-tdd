// The project's rules (2026-10-30) must keep pointing at real things. These checks catch a moved path or a dead link;
// whether a rule is still true is for review, which flags a change that makes a line out of date.
// Node only: it reads the repository's files, which the plugin test runner does not load.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const RULES = '.claude/CLAUDE.md'
const read = path => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

test('the rules stay under the 200 lines the docs advise', () => {
  const lines = read(RULES).split('\n').length
  assert.ok(lines < 200, `${RULES} is ${lines} lines`)
})

test('every link in the rules resolves', () => {
  const links = [...read(RULES).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map(m => m[1]).filter(link => !/^https?:/.test(link))
  assert.ok(links.length >= 1, 'found no links')
  for (const link of links) {
    assert.ok(existsSync(join(root, dirname(RULES), link)), `${RULES} links to ${link}, which does not exist`)
  }
})

test('every path that needs a person exists', () => {
  const list = read(RULES).split('**These paths also need a person:**')[1]?.split(/\n\n(?!- )/)[0] ?? ''
  const paths = [...list.matchAll(/`([^`]+)`/g)].map(m => m[1])
  assert.ok(paths.length >= 10, `found only ${paths.join(', ')}`)
  for (const path of paths) {
    assert.ok(existsSync(join(root, path)), `${RULES} names ${path}, which does not exist`)
  }
})

test('every npm script the rules name exists', () => {
  const { scripts } = JSON.parse(read('package.json'))
  const named = [...read(RULES).matchAll(/npm run ([\w-]+)/g)].map(m => m[1])
  assert.ok(named.includes('compare'), `found only ${named.join(', ')}`)
  for (const script of named) {
    assert.ok(script in scripts, `${RULES} names npm run ${script}, which does not exist`)
  }
})

test('the reviewer agent exists, with the tools it is limited to', () => {
  assert.match(read('.claude/agents/reviewer.md'), /^---\nname: reviewer\n[\s\S]*?\ntools: [^\n]+\n---\n/)
})
