// CI's check on a release pull request (`release` into `main`): main only moves when a version ships, so the version
// must be above the latest tag and its tester note must exist. #240 reached main still labelled with the old version;
// this is what would have stopped it. The tag itself is made on merge by .github/workflows/tag-release.yml.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hasChangesSection } from './notes.mjs'

const parts = version => version.split('.').map(Number)

/** Whether `a` is above `b`, part by part as numbers: 0.2.10 is above 0.2.9. */
export function isNewer(a, b) {
  const [left, right] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) {
      return difference > 0
    }
  }
  return false
}

/** The `vX.Y.Z` tags in `git ls-remote --tags` output; `^{}` lines repeat a tag's commit, so they are left out. */
export function tagsFrom(output) {
  return [...output.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map(match => match[1] ?? '')
}

/** What stops this version shipping, in words; empty when it is ready. */
export function releaseProblems({ version, tags, note }) {
  const latest = tags.map(tag => tag.slice(1)).reduce((best, tag) => (best === null || isNewer(tag, best) ? tag : best), null)
  return [
    ...(latest === null || isNewer(version, latest) ? [] : [`version ${version} in .claude-plugin/plugin.json is not above the latest tag, v${latest}`]),
    ...(note === null ? [`the tester note docs/testers/rounds/release-${version}.md is missing`] : []),
    ...(note === null || hasChangesSection(note, version) ? [] : [`the tester note docs/testers/rounds/release-${version}.md has no "## What ${version} changes" heading`]),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))
  const tags = tagsFrom(execFileSync('git', ['ls-remote', '--tags', 'origin'], { encoding: 'utf8' }))
  const notePath = `docs/testers/rounds/release-${version}.md`
  const problems = releaseProblems({ version, tags, note: existsSync(notePath) ? readFileSync(notePath, 'utf8') : null })
  for (const problem of problems) {
    console.error(`::error::${problem} (CONTRIBUTING.md, Releases)`)
  }
  if (problems.length > 0) {
    process.exit(1)
  }
  console.log(`release check: ${version} is ready`)
}
