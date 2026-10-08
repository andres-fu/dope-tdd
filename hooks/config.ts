import { MIRROR, templateError } from './layout'
import type { Layout } from './layout'
import { STACKS, defaultLayoutOf, isStackName, layoutNamed, stackOf } from './stacks'
import type { StackName } from './stacks'

export type GuardMode = 'enforce' | 'warn' | 'observe'
export type Policy = GuardMode | 'exempt'
export type StackSource = 'config' | 'detected' | 'default'

export type GuardConfig = {
  mode: GuardMode
  scope: readonly string[]
  exempt: readonly string[]
  layout: Layout
  roots: readonly string[]
  /** The language whose conventions apply: named in the file, detected from the project root, or Node by default. */
  stack: StackName
  stackSource: StackSource
  /** The Godot binary for a gdUnit4 run, when `godot` is not on PATH. */
  godot: string | null
  error: string | null
}

export const CONFIG_FILE = 'dope-tdd.json'
export const DEFAULT_CONFIG: GuardConfig = {
  mode: 'enforce',
  scope: [],
  exempt: [],
  layout: MIRROR,
  roots: [],
  stack: 'node',
  stackSource: 'default',
  godot: null,
  error: null,
}

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

function parseLayout(value: unknown, stack: StackName): Layout {
  const presets = stackOf(stack)
  if (value === undefined) {
    return defaultLayoutOf(presets)
  }
  if (typeof value === 'string') {
    const preset = layoutNamed(presets, value)
    if (preset === undefined) {
      throw new Error(`layout must be one of ${Object.keys(presets.layouts).join(', ')} for ${stack}, or { source, test } templates`)
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

function parseStack(value: unknown, detected: StackName | undefined): { stack: StackName; stackSource: StackSource } {
  if (value === undefined) {
    return detected === undefined ? { stack: 'node', stackSource: 'default' } : { stack: detected, stackSource: 'detected' }
  }
  if (!isStackName(value)) {
    throw new Error(`stack must be one of ${Object.keys(STACKS).join(', ')}`)
  }
  return { stack: value, stackSource: 'config' }
}

function parseGodot(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'string' || value === '') {
    throw new Error('godot must be the path of the Godot binary')
  }
  return value
}

/** The defaults for a stack that was detected rather than configured, with the stack's own exemptions. */
function defaultsFor(detected: StackName | undefined): GuardConfig {
  if (detected === undefined) {
    return DEFAULT_CONFIG
  }
  const stack = stackOf(detected)
  return { ...DEFAULT_CONFIG, stack: detected, stackSource: 'detected', layout: defaultLayoutOf(stack), exempt: stack.exempt }
}

/**
 * `detected` is the stack the project root's files point at, when the file
 * does not name one. The stack decides which layout presets exist and what
 * `{ext}` accepts.
 */
export function parseConfig(text: string | null, detected?: StackName): GuardConfig {
  if (text === null) {
    return defaultsFor(detected)
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
    const { stack, stackSource } = parseStack(fields.stack, detected)
    const own = pathList(fields.exempt, 'exempt')
    return {
      mode,
      scope: pathList(fields.scope, 'scope'),
      exempt: [...own, ...stackOf(stack).exempt.filter(glob => !own.includes(glob))],
      layout: parseLayout(fields.layout, stack),
      roots: pathList(fields.roots, 'roots'),
      stack,
      stackSource,
      godot: parseGodot(fields.godot),
      error: null,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ...defaultsFor(detected), error: `${CONFIG_FILE}: ${reason}` }
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
      source += (char ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
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

export function describeStack(config: GuardConfig): string {
  const how = config.stackSource === 'config' ? `from ${CONFIG_FILE}` : config.stackSource === 'detected' ? 'detected' : 'default'
  return `stack: ${config.stack} (${how})`
}

export function describeConfig(config: GuardConfig): string[] {
  const scope = config.scope.length === 0 ? '' : ` in ${config.scope.join(', ')}`
  return [
    `mode: ${config.mode}${scope}`,
    ...(config.exempt.length === 0 ? [] : [`exempt: ${config.exempt.join(', ')}`]),
    ...(config.stack === 'node' && config.stackSource === 'default' ? [] : [describeStack(config)]),
    `layout: ${describeLayout(config.layout)}`,
    ...(config.roots.length === 0 ? [] : [`roots: ${config.roots.join(', ')}`]),
    ...(config.godot === null ? [] : [`godot: ${config.godot}`]),
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
    ...(before.stack === after.stack ? [] : [`stack ${before.stack} → ${after.stack}`]),
    ...(sameLayout(before.layout, after.layout) ? [] : [`layout ${before.layout.name} → ${after.layout.name}`]),
    ...listChange('roots', before.roots, after.roots),
    ...(before.godot === after.godot ? [] : [`godot ${before.godot ?? 'PATH'} → ${after.godot ?? 'PATH'}`]),
    ...(after.error !== null && before.error !== after.error ? [`now invalid: ${after.error}`] : []),
  ]
  return parts.length === 0 ? null : parts.join('; ')
}
