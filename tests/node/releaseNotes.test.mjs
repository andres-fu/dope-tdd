// The GitHub release page: what changed, and a link to the steps. The tester note's steps are for testers, not readers
// of the release, so only its "What X.Y.Z changes" section is published.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasChangesSection, releaseNotes } from '../../tools/release/notes.mjs'

const note = [
  '# dope-tdd 1.2.3: a title',
  '',
  'An introduction.',
  '',
  '## What 1.2.3 changes',
  '',
  '- **One thing** (#1).',
  '',
  '### A smaller heading',
  '',
  '**Known limit** (#2): a limit.',
  '',
  '## What to check',
  '',
  '**Step 0: update.** Run it.',
  '',
].join('\n')
const link = 'Full tester note: https://github.com/o/r/blob/v1.2.3/docs/testers/rounds/release-1.2.3.md'

test('publishes the changes section and a link to the full note, and leaves the steps out', () => {
  assert.equal(releaseNotes(note, '1.2.3', 'https://github.com/o/r'), `## What 1.2.3 changes\n\n- **One thing** (#1).\n\n### A smaller heading\n\n**Known limit** (#2): a limit.\n\n${link}\n`)
})

test('the section can be the last one in the note, with no final newline', () => {
  assert.equal(releaseNotes('# t\n\n## What 1.2.3 changes\n\n- One.', '1.2.3', 'https://github.com/o/r'), `## What 1.2.3 changes\n\n- One.\n\n${link}\n`)
})

test('a note has its changes section only under its own version', () => {
  assert.equal(hasChangesSection(note, '1.2.3'), true)
  assert.equal(hasChangesSection(note, '1.2.4'), false)
  assert.equal(hasChangesSection('## What 1.2.3 changes \n', '1.2.3'), false)
})

test('reads a note saved with Windows line endings', () => {
  const published = releaseNotes(note.replace(/\n/g, '\r\n'), '1.2.3', 'https://github.com/o/r')
  assert.ok(published.startsWith('## What 1.2.3 changes\n'))
  assert.ok(!published.includes('What to check'))
})

test('a version only matches its own section, so a dot is not a wildcard', () => {
  const other = '# t\n\n## What 1x2x3 changes\n\n- Other.\n'
  assert.equal(releaseNotes(other, '1.2.3', 'https://github.com/o/r'), `${other}\n${link}\n`)
})

test('with no changes section it publishes the whole note, so a release is never left empty', () => {
  assert.equal(releaseNotes('# t\n\nJust text.\n', '1.2.3', 'https://github.com/o/r'), `# t\n\nJust text.\n\n${link}\n`)
})
