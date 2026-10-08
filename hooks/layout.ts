/**
 * Where tests live relative to sources, as two path templates. Tokens:
 * `{module}` (the part shared by a source and its test, may contain slashes),
 * `{dir}` and `{name}` (the module split at its last slash; `{dir}` keeps its
 * trailing slash or is empty), `{ext}` (ts, tsx, js, jsx, mts, cts, mjs, cjs).
 */

export type LayoutName = 'mirror' | 'colocated' | '__tests__' | 'custom'

export type Layout = { name: LayoutName; source: string; test: string }

export const LAYOUTS: Readonly<Record<Exclude<LayoutName, 'custom'>, Layout>> = {
  mirror: { name: 'mirror', source: 'src/{module}.{ext}', test: 'tests/{module}.test.{ext}' },
  colocated: { name: 'colocated', source: 'src/{module}.{ext}', test: 'src/{module}.test.{ext}' },
  __tests__: { name: '__tests__', source: 'src/{module}.{ext}', test: 'src/{dir}__tests__/{name}.test.{ext}' },
}

export const MIRROR: Layout = LAYOUTS.mirror

const TOKEN = /\{(module|dir|name|ext)\}/g
const EXT = '(?:[cm]?[jt]sx?)'
const DISPLAY_EXT = 'ts(x)'

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenPattern(token: string): string {
  switch (token) {
    case 'module':
      return '(?<module>.+?)'
    case 'dir':
      return '(?<dir>(?:[^/]+/)*)'
    case 'name':
      return '(?<name>[^/]+?)'
    default:
      return `(?<ext>${EXT})`
  }
}

export function templateToRegExp(template: string): RegExp {
  let source = '^'
  let last = 0
  for (const match of template.matchAll(TOKEN)) {
    const at = match.index ?? 0
    source += escape(template.slice(last, at)) + tokenPattern(match[1] ?? '')
    last = at + match[0].length
  }
  return new RegExp(`${source}${escape(template.slice(last))}$`)
}

/** The module a relative path names under this template, or null when the path is not of that shape. */
export function matchTemplate(template: string, relative: string): { module: string; ext: string } | null {
  const groups = templateToRegExp(template).exec(relative)?.groups
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
export function describeTestPath(layout: Layout, module: string): string {
  return fillTemplate(layout.test, module, DISPLAY_EXT)
}

/** The source path without its extension, as a person reads it: `src/utils/a`. */
export function describeSourcePath(layout: Layout, module: string): string {
  return fillTemplate(layout.source, module, '').replace(/\.$/, '')
}

export function firstSegment(template: string): string {
  return template.split('/')[0] ?? template
}

/** A template is usable when it has an extension and names the module one way or the other. */
export function templateError(template: string): string | null {
  if (!template.includes('{ext}')) {
    return `${template} must contain {ext}`
  }
  const namesModule = template.includes('{module}') || (template.includes('{dir}') && template.includes('{name}'))
  return namesModule ? null : `${template} must contain {module}, or both {dir} and {name}`
}
