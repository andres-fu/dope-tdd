// A release PR's check (2026-10-30): #240 reached main with unreleased code still labelled with the old version. A pull
// request from `release` into `main` now fails unless it ships a new version with its tester note.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNewer, releaseProblems, tagsFrom } from '../../tools/release/check.mjs'

const NOTE = 'docs/testers/rounds/release-0.2.14.md'
const noteFor = version => `# Title\n\n## What ${version} changes\n\n- One.\n`
const ready = { version: '0.2.14', tags: ['v0.2.12', 'v0.2.13'], note: noteFor('0.2.14') }

test('a new version with its tester note is ready', () => {
  assert.deepEqual(releaseProblems(ready), [])
})

test('a version not above the latest tag is a problem, naming both', () => {
  const [problem] = releaseProblems({ ...ready, version: '0.2.13', note: noteFor('0.2.13') })
  assert.match(problem, /0\.2\.13/)
  assert.match(problem, /not above/)
  assert.equal(releaseProblems({ ...ready, version: '0.2.12', note: noteFor('0.2.12') }).length, 1)
})

test('a missing tester note is a problem, naming the file', () => {
  assert.deepEqual(releaseProblems({ ...ready, note: null }), [`the tester note ${NOTE} is missing`])
})

test('a note without its changes section is a problem, because the release page would publish the steps', () => {
  assert.deepEqual(releaseProblems({ ...ready, note: noteFor('0.2.13') }), [`the tester note ${NOTE} has no "## What 0.2.14 changes" heading`])
})

test('both problems are said together', () => {
  assert.equal(releaseProblems({ version: '0.2.13', tags: ['v0.2.13'], note: null }).length, 2)
})

test('versions compare as numbers: 0.2.10 is above 0.2.9', () => {
  assert.equal(isNewer('0.2.10', '0.2.9'), true)
  assert.equal(isNewer('0.2.9', '0.2.10'), false)
  assert.equal(isNewer('0.3.0', '0.2.99'), true)
  assert.equal(isNewer('1.0.0', '1.0.0'), false)
  assert.deepEqual(releaseProblems({ version: '0.2.10', tags: ['v0.2.9'], note: noteFor('0.2.10') }), [])
})

test('with no tags yet, any version is new', () => {
  assert.deepEqual(releaseProblems({ ...ready, tags: [] }), [])
})

test('tags are read from git ls-remote, peeled refs and other names left out', () => {
  const output = [
    'abc\trefs/tags/v0.2.13',
    'def\trefs/tags/v0.2.13^{}',
    'fed\trefs/tags/v0.2.9',
    '123\trefs/tags/not-a-version',
  ].join('\n')
  assert.deepEqual(tagsFrom(output), ['v0.2.13', 'v0.2.9'])
})
