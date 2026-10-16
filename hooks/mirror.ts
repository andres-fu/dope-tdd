import { globMatches } from './config'
import { MIRROR, baseName, describeSourcePath, describeTestPath, fillTemplate, literalRoot, matchTemplate } from './layout'
import type { Layout } from './layout'
import { stackOf } from './stacks'
import type { StackName } from './stacks'

/** The path of the file a test is named after: `a.test.ts` → `a.ts`, `test_a.py` → `a.py`, `ATest.cs` → `A.cs`. */
function untested(path: string): string {
  return path
    .replace(/\.(?:test|spec)(\.[cm]?[jt]sx?)$/, '$1')
    .replace(/(^|\/)test_([^/]+\.py)$/, '$1$2')
    .replace(/_test(\.(?:py|gd))$/, '$1')
    .replace(/(?:Tests?|IT)(\.(?:cs|java|gd))$/, '$1')
}

export { isTestRun } from './runners'

export type ClassifiedPath =
  | { kind: 'source'; module: string }
  | { kind: 'test'; module: string }
  | { kind: 'other' }

/** The layout, the package roots it applies under (none means the session root itself), and the stack whose extensions it takes. */
export type LayoutConfig = { layout: Layout; roots: readonly string[]; stack?: StackName }

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = { layout: MIRROR, roots: [] }

function toForwardSlashes(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/([A-Za-z])\//, (_, drive: string) => `${drive.toUpperCase()}:/`)
}

/** Windows ignores case in paths; Linux does not. A path is Windows-shaped when it starts with a drive letter. */
export function foldsCase(path: string): boolean {
  return /^[A-Za-z]:/.test(toForwardSlashes(path))
}

/** A path as a comparison key: forward slashes, no trailing slash, case folded only where the file system folds it. */
export function pathKey(path: string): string {
  const slashed = toForwardSlashes(path).replace(/\/$/, '')
  return foldsCase(slashed) ? slashed.toLowerCase() : slashed
}

function relativeTo(root: string, path: string): string | undefined {
  const base = pathKey(root)
  const normalized = toForwardSlashes(path)
  return pathKey(normalized).startsWith(`${base}/`) ? normalized.slice(base.length + 1) : undefined
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
  const exts = stackOf(config.stack).exts
  // By name the module is the basename on both sides, wherever the files sit.
  const reduce = (module: string): string => (config.layout.pairing === 'name' ? baseName(module) : module)
  // The test template first: under a colocated layout a test file is also of the source's shape.
  const test = matchTemplate(config.layout.test, split.rest, exts)
  if (test !== null) {
    return { kind: 'test', module: withPkg(split.pkg, reduce(test.module)) }
  }
  // A file named like a test is never source, whatever the layout says: `src/foo.test.ts` under the default
  // mirror layout is the colocated test for foo, and `tests/foo.spec.ts` is foo's test too.
  if (stackOf(config.stack).testFile.test(split.rest)) {
    const stem = untested(split.rest)
    const asSource = matchTemplate(config.layout.source, stem, exts)
    const asTest = matchTemplate(config.layout.test, stem.replace(/(\.[^./]+)$/, '.test$1'), exts)
    const module = asSource?.module ?? asTest?.module
    // Named like a test but in no place this layout knows: nobody's test, and still nobody's source.
    return module === undefined ? { kind: 'other' } : { kind: 'test', module: withPkg(split.pkg, reduce(module)) }
  }
  // A file inside a tests folder of its own that is not a test (a fixture, a conftest) is nobody's source.
  const testsRoot = literalRoot(config.layout.test)
  if (testsRoot !== null && testsRoot !== literalRoot(config.layout.source) && split.rest.startsWith(`${testsRoot}/`)) {
    return { kind: 'other' }
  }
  const source = matchTemplate(config.layout.source, split.rest, exts)
  if (source !== null) {
    return { kind: 'source', module: withPkg(split.pkg, reduce(source.module)) }
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
  return joined(pkg, describeTestPath(config.layout, rest, config.layout.displayExt ?? stackOf(config.stack).displayExt))
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

/** The top-level directories git is asked about: where the templates start, or where the roots start; the whole root when a template starts anywhere. */
export function watchedDirs(config: LayoutConfig): string[] {
  if (config.roots.length > 0) {
    return [...new Set(config.roots.map(root => root.split('/')[0] ?? root))]
  }
  const dirs = [literalRoot(config.layout.source), literalRoot(config.layout.test)]
  return dirs.includes(null) ? ['.'] : [...new Set(dirs as string[])]
}

/** True when `path` is the root or sits under it: in any case on Windows, in its own case elsewhere. */
export function isInsideRoot(root: string, path: string): boolean {
  const base = pathKey(root)
  const candidate = pathKey(path)
  return candidate === base || candidate.startsWith(`${base}/`)
}

/**
 * A path as the project spells it, given where it landed with every symbolic link followed: inside the root as it
 * stands, or inside the root's own real location and spelled again from the root. Null when it landed elsewhere.
 */
export function respelled(root: string, realRoot: string | null, landed: string): string | null {
  if (isInsideRoot(root, landed)) {
    return landed
  }
  if (realRoot === null || !isInsideRoot(realRoot, landed)) {
    return null
  }
  const rest = relativeTo(realRoot, landed)
  return rest === undefined ? root : `${toForwardSlashes(root).replace(/\/$/, '')}/${rest}`
}
