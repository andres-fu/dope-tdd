import { MIRROR, templateError } from './layout.ts'
import type { FolderLayout, Layout } from './layout.ts'
import { STACKS, defaultLayoutOf, isStackName, layoutNamed, stackOf } from './stacks.ts'
import type { StackName } from './stacks.ts'

export type GuardMode = 'enforce' | 'warn' | 'observe'
export type Policy = GuardMode | 'exempt'
export type StackSource = 'config' | 'detected' | 'default'

export type GuardConfig = {
  mode: GuardMode
  scope: readonly string[]
  exempt: readonly string[]
  layout: Layout
  roots: readonly string[]
  /** Folders whose files follow a layout of their own, deepest first wins; absent when the file names none. */
  layouts?: readonly FolderLayout[]
  /** The language whose conventions apply: named in the file, detected from the project root, or Node by default. */
  stack: StackName
  stackSource: StackSource
  /** The Godot binary for a gdUnit4 run, when `godot` is not on PATH. */
  godot: string | null
  error: string | null
  /** No layout was named in the file: the stack's default is a guess, and the refusal says how to fix it. */
  layoutGuessed?: boolean
  /** `false` turns the catch check off (a repo whose watchers or dev server see every revert). Absent means on. */
  catchCheck?: boolean
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
  layoutGuessed: true,
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
  const { source, test, pairing } = value as { source?: unknown; test?: unknown; pairing?: unknown }
  if (typeof source !== 'string' || typeof test !== 'string') {
    throw new Error('layout templates need a source and a test string')
  }
  if (pairing !== undefined && pairing !== 'path' && pairing !== 'name') {
    throw new Error('layout pairing must be "path" or "name"')
  }
  const problem = templateError(source, pairing) ?? templateError(test, pairing)
  if (problem !== null) {
    throw new Error(`layout: ${problem}`)
  }
  return pairing === undefined ? { name: 'custom', source, test } : { name: 'custom', source, test, pairing }
}

/** `{ "dashboard": "colocated" }`: each folder, a plain path inside the project, with a preset or templates of its own. */
function parseLayouts(value: unknown, stack: StackName): { layouts?: FolderLayout[] } {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('layouts must map folders to layouts, as { "dashboard": "colocated" }')
  }
  const layouts = Object.entries(value).map(([key, entry]): FolderLayout => {
    const folder = key.replace(/\\/g, '/').replace(/\/+$/, '')
    const segments = folder.split('/')
    // An empty segment also catches "" and a leading slash.
    if (/^[A-Za-z]:/.test(folder) || /[*?[\]{}]/.test(folder) || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`layouts: "${key}" must be a plain folder inside the project, as "dashboard" or "apps/web"`)
    }
    try {
      return { folder, layout: parseLayout(entry, stack) }
    } catch (error) {
      throw new Error(`layouts: ${folder}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  return layouts.length === 0 ? {} : { layouts }
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

/**
 * Only an explicit value is recorded, so a config that never names it reads exactly as before. Unset, the check runs
 * where it never writes the user's files (a Node runner's throwaway worktree); `true` also lets the experimental
 * runners undo the change on disk for one test run; `false` turns the check off.
 */
function parseCatchCheck(value: unknown): { catchCheck?: boolean } {
  if (value === undefined) {
    return {}
  }
  if (typeof value !== 'boolean') {
    throw new Error('catchCheck must be true or false')
  }
  return { catchCheck: value }
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
      ...parseLayouts(fields.layouts, stack),
      stack,
      stackSource,
      godot: parseGodot(fields.godot),
      error: null,
      layoutGuessed: fields.layout === undefined,
      ...parseCatchCheck(fields.catchCheck),
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
  return `${layout.name} (${layout.source} ↔ ${layout.test}${layout.pairing === 'name' ? ', by name' : ''})`
}

export function describeStack(config: GuardConfig): string {
  const how = config.stackSource === 'config' ? `from ${CONFIG_FILE}` : config.stackSource === 'detected' ? 'detected' : 'default'
  return `stack: ${config.stack} (${how})`
}

export function describeConfig(config: GuardConfig): string[] {
  const scope = config.scope.length === 0 ? '' : ` in ${config.scope.join(', ')}`
  return [
    `mode: ${config.mode}${scope}${config.mode === 'observe' ? ' (records only: no refusals, no advice, no briefing, no catch check; nothing on disk is touched)' : ''}`,
    ...(config.exempt.length === 0 ? [] : [`exempt: ${config.exempt.join(', ')}`]),
    ...(config.stack === 'node' && config.stackSource === 'default' ? [] : [describeStack(config)]),
    `layout: ${describeLayout(config.layout)}`,
    ...(config.layouts ?? []).map(entry => `layout in ${entry.folder}/: ${describeLayout(entry.layout)}`),
    ...(config.roots.length === 0 ? [] : [`roots: ${config.roots.join(', ')}`]),
    ...(config.godot === null ? [] : [`godot: ${config.godot}`]),
    ...(config.catchCheck === false ? [`catch check: off (${CONFIG_FILE}); a green is not re-run with the change undone`] : []),
    ...(config.catchCheck === true ? [`catch check: on for every runner (${CONFIG_FILE}); an experimental runner undoes the change on disk for one test run`] : []),
    ...(config.error === null ? [] : [`config: ${config.error} (using defaults)`]),
  ]
}

const MODE_STRENGTH: Readonly<Record<GuardMode, number>> = { enforce: 2, warn: 1, observe: 0 }

/** True when the edit made the guard do less: a weaker mode, a new exemption, or a scope that leaves more out. */
export function isLoosening(before: GuardConfig, after: GuardConfig): boolean {
  const weakerMode = MODE_STRENGTH[after.mode] < MODE_STRENGTH[before.mode]
  const moreExempt = after.exempt.some(glob => !before.exempt.includes(glob))
  const narrowerScope = (before.scope.length === 0 && after.scope.length > 0) || (before.scope.length > 0 && after.scope.length > 0 && before.scope.some(glob => !after.scope.includes(glob)))
  const checkOff = before.catchCheck !== false && after.catchCheck === false
  return weakerMode || moreExempt || narrowerScope || checkOff
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
  return a.source === b.source && a.test === b.test && (a.pairing ?? 'path') === (b.pairing ?? 'path')
}

function folderLayoutChanges(before: readonly FolderLayout[] = [], after: readonly FolderLayout[] = []): string[] {
  const folders = [...new Set([...before, ...after].map(entry => entry.folder))]
  return folders.flatMap(folder => {
    const was = before.find(entry => entry.folder === folder)?.layout
    const now = after.find(entry => entry.folder === folder)?.layout
    if (was === undefined) {
      return [`layout in ${folder}/ → ${now?.name}`]
    }
    if (now === undefined) {
      return [`layout in ${folder}/ ${was.name} → the main layout`]
    }
    return sameLayout(was, now) ? [] : [`layout in ${folder}/ ${was.name} → ${now.name}`]
  })
}

/** What an edit to the config file changed, in words, or null when nothing the guard reads moved. */
export function describeConfigChange(before: GuardConfig, after: GuardConfig): string | null {
  const parts = [
    ...(before.mode === after.mode ? [] : [`mode ${before.mode} → ${after.mode}`]),
    ...((before.catchCheck !== false) === (after.catchCheck !== false) ? [] : [`catch check ${before.catchCheck === false ? 'off → on' : 'on → off'}`]),
    ...((before.catchCheck === true) === (after.catchCheck === true) ? [] : [`in-place check for experimental runners ${after.catchCheck === true ? 'off → on' : 'on → off'}`]),
    ...listChange('exempt', before.exempt, after.exempt),
    ...listChange('scope', before.scope, after.scope),
    ...(before.stack === after.stack ? [] : [`stack ${before.stack} → ${after.stack}`]),
    ...(sameLayout(before.layout, after.layout) ? [] : [`layout ${before.layout.name} → ${after.layout.name}`]),
    ...folderLayoutChanges(before.layouts, after.layouts),
    ...listChange('roots', before.roots, after.roots),
    ...(before.godot === after.godot ? [] : [`godot ${before.godot ?? 'PATH'} → ${after.godot ?? 'PATH'}`]),
    ...(after.error !== null && before.error !== after.error ? [`now invalid: ${after.error}`] : []),
  ]
  return parts.length === 0 ? null : parts.join('; ')
}
