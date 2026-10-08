import { LAYOUTS, MIRROR, templateError } from './layout'
import type { Layout } from './layout'

export type GuardMode = 'enforce' | 'warn' | 'observe'
export type Policy = GuardMode | 'exempt'

export type GuardConfig = {
  mode: GuardMode
  scope: readonly string[]
  exempt: readonly string[]
  layout: Layout
  roots: readonly string[]
  error: string | null
}

export const CONFIG_FILE = 'dope-tdd.json'
export const DEFAULT_CONFIG: GuardConfig = { mode: 'enforce', scope: [], exempt: [], layout: MIRROR, roots: [], error: null }

const MODES: readonly GuardMode[] = ['enforce', 'warn', 'observe']

function isMode(value: unknown): value is GuardMode {
  return MODES.includes(value as GuardMode)
}

function pathList(value: unknown, field: string): string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${field} must be a list of path patterns`)
  }
  return value
}

function parseLayout(value: unknown): Layout {
  if (value === undefined) {
    return MIRROR
  }
  if (typeof value === 'string') {
    const preset = (LAYOUTS as Record<string, Layout | undefined>)[value]
    if (preset === undefined) {
      throw new Error(`layout must be one of ${Object.keys(LAYOUTS).join(', ')}, or { source, test } templates`)
    }
    return preset
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('layout must be a preset name or { source, test } templates')
  }
  const { source, test } = value as { source?: unknown; test?: unknown }
  if (typeof source !== 'string' || typeof test !== 'string') {
    throw new Error('layout templates need a source and a test string')
  }
  const problem = templateError(source) ?? templateError(test)
  if (problem !== null) {
    throw new Error(`layout: ${problem}`)
  }
  return { name: 'custom', source, test }
}

export function parseConfig(text: string | null): GuardConfig {
  if (text === null) {
    return DEFAULT_CONFIG
  }
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('must be an object')
    }
    const fields = raw as Record<string, unknown>
    const mode = fields.mode === undefined ? 'enforce' : fields.mode
    if (!isMode(mode)) {
      throw new Error(`mode must be one of ${MODES.join(', ')}`)
    }
    return {
      mode,
      scope: pathList(fields.scope, 'scope'),
      exempt: pathList(fields.exempt, 'exempt'),
      layout: parseLayout(fields.layout),
      roots: pathList(fields.roots, 'roots'),
      error: null,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ...DEFAULT_CONFIG, error: `${CONFIG_FILE}: ${reason}` }
  }
}

export function globToRegExp(glob: string): RegExp {
  let source = '^'
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?'
        i += 2
      } else {
        source += '.*'
        i += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

export function globMatches(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path)
}

export function policyFor(config: GuardConfig, relativeSourcePath: string): Policy {
  if (config.exempt.some(glob => globMatches(glob, relativeSourcePath))) {
    return 'exempt'
  }
  if (config.scope.length > 0 && !config.scope.some(glob => globMatches(glob, relativeSourcePath))) {
    return 'observe'
  }
  return config.mode
}

export function describeLayout(layout: Layout): string {
  return `${layout.name} (${layout.source} ↔ ${layout.test})`
}

export function describeConfig(config: GuardConfig): string[] {
  const scope = config.scope.length === 0 ? '' : ` in ${config.scope.join(', ')}`
  return [
    `mode: ${config.mode}${scope}`,
    ...(config.exempt.length === 0 ? [] : [`exempt: ${config.exempt.join(', ')}`]),
    `layout: ${describeLayout(config.layout)}`,
    ...(config.roots.length === 0 ? [] : [`roots: ${config.roots.join(', ')}`]),
    ...(config.error === null ? [] : [`config: ${config.error} (using defaults)`]),
  ]
}

const MODE_STRENGTH: Readonly<Record<GuardMode, number>> = { enforce: 2, warn: 1, observe: 0 }

/** True when the edit made the guard do less: a weaker mode, a new exemption, or a scope that leaves more out. */
export function isLoosening(before: GuardConfig, after: GuardConfig): boolean {
  const weakerMode = MODE_STRENGTH[after.mode] < MODE_STRENGTH[before.mode]
  const moreExempt = after.exempt.some(glob => !before.exempt.includes(glob))
  const narrowerScope = (before.scope.length === 0 && after.scope.length > 0) || (before.scope.length > 0 && after.scope.length > 0 && before.scope.some(glob => !after.scope.includes(glob)))
  return weakerMode || moreExempt || narrowerScope
}

function listChange(name: string, before: readonly string[], after: readonly string[]): string[] {
  const added = after.filter(entry => !before.includes(entry))
  const removed = before.filter(entry => !after.includes(entry))
  return [
    ...(added.length === 0 ? [] : [`${name} +${added.join(' +')}`]),
    ...(removed.length === 0 ? [] : [`${name} -${removed.join(' -')}`]),
  ]
}

function sameLayout(a: Layout, b: Layout): boolean {
  return a.source === b.source && a.test === b.test
}

/** What an edit to the config file changed, in words, or null when nothing the guard reads moved. */
export function describeConfigChange(before: GuardConfig, after: GuardConfig): string | null {
  const parts = [
    ...(before.mode === after.mode ? [] : [`mode ${before.mode} → ${after.mode}`]),
    ...listChange('exempt', before.exempt, after.exempt),
    ...listChange('scope', before.scope, after.scope),
    ...(sameLayout(before.layout, after.layout) ? [] : [`layout ${before.layout.name} → ${after.layout.name}`]),
    ...listChange('roots', before.roots, after.roots),
    ...(after.error !== null && before.error !== after.error ? [`now invalid: ${after.error}`] : []),
  ]
  return parts.length === 0 ? null : parts.join('; ')
}
