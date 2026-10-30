// What the live suite's scenarios judge a run by (tools/live/scenarios.mjs). Pure: a run from stream.mjs in, facts out.

/** A path compared with forward slashes and no trailing one; the stream gives Windows paths either way round. */
const norm = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '')
// Windows paths are case-blind, and the model may write `c:/` for `C:\`.
const fold = path => (/^[a-z]:\//i.test(path) ? path.toLowerCase() : path)

export const samePath = (a, b) => fold(norm(a)) === fold(norm(b))

/** True when `path` is inside `dir`, not `dir` itself. */
export const isUnder = (path, dir) => fold(norm(path)).startsWith(`${fold(norm(dir))}/`)

/** dope-tdd refusing an untested edit: an error result in its own words, not any other tool error. */
export const isRefusal = result => result?.error === true && /dope-tdd: write the failing test first/.test(result.text)

/** The text /tdd printed, or null when it did not run (the plugin is off, so the model answers instead). */
export function tddReport(run) {
  return run.turns.find(turn => turn.command && turn.text.startsWith('dope-tdd: '))?.text ?? null
}

/** /tdd's first line, `dope-tdd: version 0.2.13 · #248 · ed5625b · 2026-10-29`; null when it names no version. */
export function buildOf(report) {
  const first = report?.split('\n')[0] ?? ''
  const parts = first.replace(/^dope-tdd: /, '').split(' · ')
  const version = /^version (\S+)$/.exec(parts[0] ?? '')?.[1]
  if (version === undefined) return null
  const pr = parts.find(p => /^#\d+$/.test(p))?.slice(1) ?? null
  const sha = parts.find(p => /^[0-9a-f]{7,40}$/.test(p)) ?? null
  const day = parts.find(p => /^\d{4}-\d{2}-\d{2}$/.test(p)) ?? null
  return { version, pr, sha, day }
}

/** dope-tdd as the first session start lists it, or null when it is not loaded. */
export const dopePlugin = run => run.inits[0]?.plugins.find(p => p.name === 'dope-tdd') ?? null

export const check = (label, ok, detail = '') => ({ label, ok: Boolean(ok), detail })

/** `PASS id: title`, or `FAIL id: title` and every check under it, each failed one with why. */
export function formatResult(id, title, checks) {
  if (checks.every(c => c.ok)) return [`PASS ${id}: ${title}`]
  return [`FAIL ${id}: ${title}`, ...checks.map(c => (c.ok ? `  ok   ${c.label}` : `  FAIL ${c.label}${c.detail === '' ? '' : `: ${c.detail}`}`))]
}
