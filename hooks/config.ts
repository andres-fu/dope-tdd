export type GuardMode = 'enforce' | 'warn' | 'observe'
export type Policy = GuardMode | 'exempt'

export type GuardConfig = {
  mode: GuardMode
  scope: readonly string[]
  exempt: readonly string[]
  error: string | null
}

export const CONFIG_FILE = 'dope-tdd.json'
export const DEFAULT_CONFIG: GuardConfig = { mode: 'enforce', scope: [], exempt: [], error: null }

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
    return { mode, scope: pathList(fields.scope, 'scope'), exempt: pathList(fields.exempt, 'exempt'), error: null }
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

export function describeConfig(config: GuardConfig): string[] {
  const scope = config.scope.length === 0 ? '' : ` in ${config.scope.join(', ')}`
  return [
    `mode: ${config.mode}${scope}`,
    ...(config.exempt.length === 0 ? [] : [`exempt: ${config.exempt.join(', ')}`]),
    ...(config.error === null ? [] : [`config: ${config.error} (using defaults)`]),
  ]
}

function listChange(name: string, before: readonly string[], after: readonly string[]): string[] {
  const added = after.filter(entry => !before.includes(entry))
  const removed = before.filter(entry => !after.includes(entry))
  return [
    ...(added.length === 0 ? [] : [`${name} +${added.join(' +')}`]),
    ...(removed.length === 0 ? [] : [`${name} -${removed.join(' -')}`]),
  ]
}

/** What an edit to the config file changed, in words, or null when nothing the guard reads moved. */
export function describeConfigChange(before: GuardConfig, after: GuardConfig): string | null {
  const parts = [
    ...(before.mode === after.mode ? [] : [`mode ${before.mode} → ${after.mode}`]),
    ...listChange('exempt', before.exempt, after.exempt),
    ...listChange('scope', before.scope, after.scope),
    ...(after.error !== null && before.error !== after.error ? [`now invalid: ${after.error}`] : []),
  ]
  return parts.length === 0 ? null : parts.join('; ')
}
