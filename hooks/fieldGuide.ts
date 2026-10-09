/**
 * A repository's field guide: its own house rules, written relative to that
 * repository rather than to general best practice, kept on this machine at
 * `~/.dope-tdd/guides/<owner>__<name>.md` and never in the repository. The
 * key comes from the upstream remote when there is one (a fork and its
 * worktrees share the guide of the project they belong to), then origin, then
 * the folder name.
 */

/** Longer than a guide should be; the briefing stays short so the rules are read. */
export const GUIDE_LIMIT = 4000

export function guideKey(remote: string | null, root: string): string {
  if (remote !== null) {
    const path = remote
      .trim()
      .replace(/\.git$/, '')
      .replace(/^[\w+.-]+:\/\/[^/]+\//, '')
      .replace(/^[^@/]+@[^:]+:/, '')
    const parts = path.split('/').filter(part => part !== '')
    if (parts.length >= 2) {
      return `${parts[parts.length - 2]}__${parts[parts.length - 1]}`
    }
  }
  const trimmed = root.replace(/\\/g, '/').replace(/\/$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

export function guidePath(home: string, key: string): string {
  return `${home.replace(/\\/g, '/').replace(/\/$/, '')}/.dope-tdd/guides/${key}.md`
}

export function guideSection(key: string, text: string): string {
  const name = key.replace('__', '/')
  const body = text.trim()
  const kept = body.length > GUIDE_LIMIT ? `${body.slice(0, GUIDE_LIMIT)}\n(the rest of the guide is cut)` : body
  return [`House rules for ${name}, from this project's field guide. They are how this repository works; follow them as you would its CLAUDE.md:`, kept].join('\n')
}
