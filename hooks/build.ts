// Which build of dope-tdd is running (2026-10-18): the first row of /tdd and a field of the session log, so a pull to
// the wrong checkout, or a reload that did not happen, shows at a glance. Pure: register.tsx asks git in the plugin's
// own folder for `%h|%cs|%s` of its last commit.

const SHA = /^[0-9a-f]{7,40}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
// A merge commit (`Merge pull request #99 from …`) or a squash merge (`fix: … (#100)`) names its pull request.
const MERGED = /^Merge pull request #(\d+)\b/
const SQUASHED = /\(#(\d+)\)\s*$/

export function buildLabel(gitLine: string | null, version: string | null): string {
  const [sha, day, ...rest] = (gitLine ?? '').trim().split('|')
  if (sha !== undefined && day !== undefined && rest.length > 0 && SHA.test(sha) && DAY.test(day)) {
    const subject = rest.join('|')
    const pr = (MERGED.exec(subject) ?? SQUASHED.exec(subject))?.[1]
    return [...(pr === undefined ? [] : [`#${pr}`]), sha, day].join(' · ')
  }
  return version === null ? 'build unknown' : `version ${version}`
}

/** The `version` of plugin.json, for an install with no .git to ask (a marketplace or cache copy); null when absent. */
export function manifestVersion(manifest: string | null): string | null {
  try {
    const version: unknown = JSON.parse(manifest ?? '').version
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}
