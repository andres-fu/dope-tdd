/**
 * Where tests live relative to sources, as two path templates. Tokens:
 * `{module}` (the part shared by a source and its test, may contain slashes),
 * `{dir}` and `{name}` (the module split at its last slash; `{dir}` keeps its
 * trailing slash or is empty), `{ext}` (the stack's extensions: for Node ts,
 * tsx, js, jsx, mts, cts, mjs, cjs; for Python py; for Godot gd; and so on,
 * see `stacks.ts`).
 */

export type NodeLayoutName = 'mirror' | 'colocated' | '__tests__'
export type LayoutName = NodeLayoutName | 'custom' | string

/**
 * `pairing` is how a test finds its source. By path (the default) the module is
 * the path both templates share, so tests mirror the source tree. By name the
 * module is the file's basename alone: `scripts/show/BeatDeck.cs` and
 * `test/BeatDeckTest.cs` meet at `BeatDeck` wherever each sits, which is how
 * gdUnit4, pytest's flat `tests/` folders and many Node projects lay tests out.
 */
export type Pairing = 'path' | 'name'

export type Layout = { name: LayoutName; source: string; test: string; pairing?: Pairing; displayExt?: string }

/** A folder of the project whose files follow a layout of their own; its templates start inside the folder. */
export type FolderLayout = { folder: string; layout: Layout }

export const LAYOUTS: Readonly<Record<NodeLayoutName, Layout>> = {
  mirror: { name: 'mirror', source: 'src/{module}.{ext}', test: 'tests/{module}.test.{ext}' },
  colocated: { name: 'colocated', source: 'src/{module}.{ext}', test: 'src/{module}.test.{ext}' },
  __tests__: { name: '__tests__', source: 'src/{module}.{ext}', test: 'src/{dir}__tests__/{name}.test.{ext}' },
}

export const MIRROR: Layout = LAYOUTS.mirror

/** What `{ext}` accepts when no stack is named: the Node extensions. */
export const NODE_EXTS: readonly string[] = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']

const TOKEN = /\{(module|dir|name|ext)\}/g
const DISPLAY_EXT = 'ts(x)'

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenPattern(token: string, exts: readonly string[]): string {
  switch (token) {
    case 'module':
      return '(?<module>.+?)'
    case 'dir':
      return '(?<dir>(?:[^/]+/)*)'
    case 'name':
      return '(?<name>[^/]+?)'
    default:
      return `(?<ext>(?:${exts.map(escape).join('|')}))`
  }
}

export function templateToRegExp(template: string, exts: readonly string[] = NODE_EXTS): RegExp {
  let source = '^'
  let last = 0
  for (const match of template.matchAll(TOKEN)) {
    const at = match.index ?? 0
    source += escape(template.slice(last, at)) + tokenPattern(match[1] ?? '', exts)
    last = at + match[0].length
  }
  return new RegExp(`${source}${escape(template.slice(last))}$`)
}

/** The module a relative path names under this template, or null when the path is not of that shape. */
export function matchTemplate(template: string, relative: string, exts: readonly string[] = NODE_EXTS): { module: string; ext: string } | null {
  const groups = templateToRegExp(template, exts).exec(relative)?.groups
  if (groups === undefined) {
    return null
  }
  const module = groups.module ?? `${groups.dir ?? ''}${groups.name ?? ''}`
  return module === '' ? null : { module, ext: groups.ext ?? '' }
}

export function fillTemplate(template: string, module: string, ext: string): string {
  const slash = module.lastIndexOf('/')
  const dir = slash === -1 ? '' : module.slice(0, slash + 1)
  const name = slash === -1 ? module : module.slice(slash + 1)
  return template.replace(TOKEN, (_whole, token: string) => (token === 'module' ? module : token === 'dir' ? dir : token === 'name' ? name : ext))
}

/** The test path as a person reads it in a message: `tests/utils/a.test.ts(x)`. */
export function describeTestPath(layout: Layout, module: string, displayExt: string = DISPLAY_EXT): string {
  return fillTemplate(layout.test, module, displayExt)
}

/** The source path without its extension, as a person reads it: `src/utils/a`. */
export function describeSourcePath(layout: Layout, module: string): string {
  return fillTemplate(layout.source, module, '').replace(/\.$/, '')
}

export function firstSegment(template: string): string {
  return template.split('/')[0] ?? template
}

/** The directory a template starts with when that is a literal, or null when it starts with a token (`{module}.gd` sits anywhere). */
export function literalRoot(template: string): string | null {
  const segment = firstSegment(template)
  return segment.includes('{') ? null : segment
}

/** A template is usable when it has an extension and names the module one way or the other; by name, `{name}` alone is enough. */
export function templateError(template: string, pairing: Pairing = 'path'): string | null {
  if (!template.includes('{ext}')) {
    return `${template} must contain {ext}`
  }
  if (pairing === 'name') {
    return template.includes('{name}') || template.includes('{module}') ? null : `${template} must contain {name}`
  }
  const namesModule = template.includes('{module}') || (template.includes('{dir}') && template.includes('{name}'))
  return namesModule ? null : `${template} must contain {module}, or both {dir} and {name}`
}

/** The last segment of a module id: what a name-paired layout keys on. */
export function baseName(module: string): string {
  return module.slice(module.lastIndexOf('/') + 1)
}
