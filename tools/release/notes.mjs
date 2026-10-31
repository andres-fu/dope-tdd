// The text of a GitHub release (.github/workflows/tag-release.yml): the tester note's "What X.Y.Z changes" section, then
// a link to the full note. The steps in the note are for testers, not for someone reading what a release changed.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const headingFor = version => `## What ${version} changes`
const linesOf = note => note.replace(/\r\n/g, '\n').split('\n')

/** Whether the note has its changes section. The release check needs it, so a mistyped heading can't publish the steps. */
export function hasChangesSection(note, version) {
  return linesOf(note).includes(headingFor(version))
}

/** The note's changes section, or the whole note when it has none, so a release is never left empty. */
function changesSection(note, version) {
  const start = linesOf(note).indexOf(headingFor(version))
  if (start === -1) {
    return linesOf(note).join('\n')
  }
  const lines = linesOf(note).slice(start)
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('## '))
  return lines.slice(0, end === -1 ? undefined : end).join('\n')
}

export function releaseNotes(note, version, repoUrl) {
  return `${changesSection(note, version).trimEnd()}\n\nFull tester note: ${repoUrl}/blob/v${version}/docs/testers/rounds/release-${version}.md\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? ''
  const note = readFileSync(`docs/testers/rounds/release-${version}.md`, 'utf8')
  process.stdout.write(releaseNotes(note, version, `https://github.com/${process.env.GITHUB_REPOSITORY}`))
}
