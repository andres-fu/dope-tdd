import { globMatches } from './config'
import { MIRROR, describeSourcePath, describeTestPath, fillTemplate, firstSegment, matchTemplate } from './layout'
import type { Layout } from './layout'

const COMMAND_START = String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*`
const RUNNER_BINARY = String.raw`(?:(?:npx|bunx|pnpm(?:\s+(?:exec|dlx))?|yarn(?:\s+exec)?)\s+)?(?:[\w./-]*\/)?(?:vitest|jest)(?=\s|$)`
const PACKAGE_SCRIPT = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?(?=\s|$)`
const TEST_RUN = new RegExp(`${COMMAND_START}(?:${RUNNER_BINARY}|${PACKAGE_SCRIPT})`)

export type ClassifiedPath =
  | { kind: 'source'; module: string }
  | { kind: 'test'; module: string }
  | { kind: 'other' }

/** The layout and the package roots it applies under; no roots means the session root itself. */
export type LayoutConfig = { layout: Layout; roots: readonly string[] }

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = { layout: MIRROR, roots: [] }

function toForwardSlashes(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/([A-Za-z])\//, (_, drive: string) => `${drive.toUpperCase()}:/`)
}

function relativeTo(root: string, path: string): string | undefined {
  const prefix = toForwardSlashes(root).replace(/\/$/, '') + '/'
  const normalized = toForwardSlashes(path)
  const isInside = normalized.toLowerCase().startsWith(prefix.toLowerCase())
  return isInside ? normalized.slice(prefix.length) : undefined
}

export function relativePath(root: string, path: string): string {
  return relativeTo(root, path) ?? path
}

/** Splits `packages/app/src/a.ts` into the package root that a root glob names and the rest; null when under no root. */
export function splitRoot(relative: string, roots: readonly string[]): { pkg: string; rest: string } | null {
  if (roots.length === 0) {
    return { pkg: '', rest: relative }
  }
  const segments = relative.split('/')
  for (const glob of roots) {
    const depth = glob.split('/').length
    const pkg = segments.slice(0, depth).join('/')
    if (segments.length > depth && globMatches(glob, pkg)) {
      return { pkg, rest: segments.slice(depth).join('/') }
    }
  }
  return null
}

function withPkg(pkg: string, module: string): string {
  return pkg === '' ? module : `${pkg}/${module}`
}

export function classifyPath(root: string, path: string, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): ClassifiedPath {
  const relative = relativeTo(root, path)
  if (relative === undefined || relative.endsWith('.d.ts')) {
    return { kind: 'other' }
  }
  const split = splitRoot(relative, config.roots)
  if (split === null) {
    return { kind: 'other' }
  }
  // The test template first: under a colocated layout a test file is also of the source's shape.
  const test = matchTemplate(config.layout.test, split.rest)
  if (test !== null) {
    return { kind: 'test', module: withPkg(split.pkg, test.module) }
  }
  const source = matchTemplate(config.layout.source, split.rest)
  if (source !== null) {
    return { kind: 'source', module: withPkg(split.pkg, source.module) }
  }
  return { kind: 'other' }
}

/** The inverse of `withPkg`: the package root a module id starts with, under these root globs. */
export function moduleParts(module: string, roots: readonly string[]): { pkg: string; rest: string } {
  return splitRoot(module, roots) ?? { pkg: '', rest: module }
}

function joined(pkg: string, relative: string): string {
  return pkg === '' ? relative : `${pkg}/${relative}`
}

/** `tests/utils/a.test.ts(x)`, or `packages/app/tests/utils/a.test.ts(x)` under roots: what the agent is told to touch. */
export function testPathFor(config: LayoutConfig, module: string): string {
  const { pkg, rest } = moduleParts(module, config.roots)
  return joined(pkg, describeTestPath(config.layout, rest))
}

/** `src/utils/a`: how messages name the source of a module. */
export function sourcePathFor(config: LayoutConfig, module: string): string {
  const { pkg, rest } = moduleParts(module, config.roots)
  return joined(pkg, describeSourcePath(config.layout, rest))
}

/** A concrete test file path for a module, with this extension. */
export function testFileFor(config: LayoutConfig, module: string, ext: string): string {
  const { pkg, rest } = moduleParts(module, config.roots)
  return joined(pkg, fillTemplate(config.layout.test, rest, ext))
}

/** The top-level directories git is asked about: where the templates start, or where the roots start. */
export function watchedDirs(config: LayoutConfig): string[] {
  const dirs = config.roots.length > 0 ? config.roots.map(firstSegment) : [firstSegment(config.layout.source), firstSegment(config.layout.test)]
  return [...new Set(dirs)]
}

export function isTestRun(command: string): boolean {
  return TEST_RUN.test(command)
}
