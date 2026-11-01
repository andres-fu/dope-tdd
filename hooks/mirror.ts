import { globMatches } from './config.ts'
import { MIRROR, baseName, describeSourcePath, describeTestPath, fillTemplate, literalRoot, matchTemplate } from './layout.ts'
import type { FolderLayout, Layout } from './layout.ts'
import { stackOf } from './stacks.ts'
import type { StackName } from './stacks.ts'

/** The path of the file a test is named after: `a.test.ts` → `a.ts`, `test_a.py` → `a.py`, `ATest.cs` → `A.cs`. */
function untested(path: string): string {
  return path
    .replace(/\.(?:test|spec)(\.[cm]?[jt]sx?)$/, '$1')
    .replace(/(^|\/)test_([^/]+\.py)$/, '$1$2')
    .replace(/_test(\.(?:py|gd))$/, '$1')
    .replace(/(?:Tests?|IT)(\.(?:cs|java|gd))$/, '$1')
}

export { isTestRun } from './runners.ts'

export type ClassifiedPath =
  | { kind: 'source'; module: string }
  | { kind: 'test'; module: string }
  /** `inTestFolder`: a helper or fixture there, which is tested through the tests that use it. */
  | { kind: 'other'; inTestFolder?: true }

/**
 * The layout, the package roots it applies under (none means the session root itself), the stack whose extensions it
 * takes, and the folders that follow a layout of their own instead (roots do not apply inside them).
 */
export type LayoutConfig = { layout: Layout; roots: readonly string[]; stack?: StackName; layouts?: readonly FolderLayout[] }

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

/**
 * #272: a path with its dots resolved by reading it, so `./src/a.ts`, `src//a.ts` and `lib/../src/a.ts` are the file they
 * name. Done where a write comes in, so what judges it sees one spelling. It doesn't follow links, so through one a
 * `..` can land elsewhere. A `..` with nothing to walk up from stays, to say the path leaves where it started. A path
 * with nothing to resolve comes back as spelled.
 */
export function withoutDots(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  if (!/(?:^|\/)\.\.?(?:\/|$)|.\/\//.test(slashed)) {
    return path
  }
  const head = /^(?:[A-Za-z]:\/|\/\/?)/.exec(slashed)?.[0] ?? ''
  const kept: string[] = []
  for (const segment of slashed.slice(head.length).split('/')) {
    if (segment === '..' && kept.length > 0 && kept[kept.length - 1] !== '..') {
      kept.pop()
    } else if (segment !== '' && segment !== '.' && !(segment === '..' && head !== '')) {
      kept.push(segment)
    }
  }
  return `${head}${kept.join('/')}`
}

function relativeTo(root: string, path: string): string | undefined {
  const base = pathKey(root)
  const normalized = toForwardSlashes(path)
  return pathKey(normalized).startsWith(`${base}/`) ? normalized.slice(base.length + 1) : undefined
}

export function relativePath(root: string, path: string): string {
  return relativeTo(root, path) ?? path
}

/**
 * The root a file is judged against: the agent worktree it sits in, or else the session's root (#198, 2026-10-28).
 * A subagent with isolation: worktree works in <root>/.claude/worktrees/<name>, a checkout of its own whose paths
 * match no layout when read from the session root. The engine names no root for a subagent's call, so the path
 * says it. Spelled as the path spells it, so classifyPath finds the file inside it.
 *
 * `mainCheckout` is set when the session root is itself a linked git worktree (#233, tester round 7): Claude Code then
 * puts its agents' worktrees under the main checkout's .claude/worktrees, outside the session root. A file inside the
 * session root is still read against it first, so a session that is one of those worktrees keeps its own files.
 */
export function worktreeRootFor(root: string, path: string, mainCheckout?: string): string {
  const rest = relativeTo(root, path) ?? (mainCheckout === undefined ? undefined : relativeTo(mainCheckout, path))
  const worktree = rest === undefined ? null : /^\.claude\/worktrees\/[^/]+(?=\/)/.exec(rest)
  if (rest === undefined || worktree === null) {
    return root
  }
  const normalized = toForwardSlashes(path)
  return normalized.slice(0, normalized.length - rest.length + worktree[0].length)
}

/**
 * Whether two files sit in the same checkout of the session: both in the main one, or both in one agent worktree
 * (#198). Unlocks are kept by module name, so a test touched in one checkout would otherwise unlock the same module in
 * another, and "a test before this code" would be met by a test in a different copy of the code.
 */
export function sameCheckout(root: string, a: string, b: string, mainCheckout?: string): boolean {
  // A path in no worktree, even a relative one from a runner's output, is the session's own checkout: a session with
  // no worktrees is judged exactly as before.
  return pathKey(worktreeRootFor(root, a, mainCheckout)) === pathKey(worktreeRootFor(root, b, mainCheckout))
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

/** The fixed folders a layout template starts with: `tests/{module}.test.{ext}` lives under `tests/`. */
export function fixedPrefix(template: string): string {
  return template.slice(0, Math.max(0, template.indexOf('{')))
}

/** A file nobody's: a helper in a test folder is marked, since it is tested through the tests that use it (#259). */
function nobodys(rest: string, layout: Layout): ClassifiedPath {
  const tests = fixedPrefix(layout.test)
  const ownTree = tests !== '' && tests !== fixedPrefix(layout.source) && rest.startsWith(tests)
  return ownTree || (layout.test.includes('__tests__/') && /(?:^|\/)__tests__\//.test(rest)) ? { kind: 'other', inTestFolder: true } : { kind: 'other' }
}

function withPkg(pkg: string, module: string): string {
  return pkg === '' ? module : `${pkg}/${module}`
}

/** The deepest folder with a layout of its own that `relative` sits in; `fold` says whether case counts. */
function folderFor(layouts: readonly FolderLayout[] | undefined, relative: string, fold: boolean): FolderLayout | undefined {
  const key = (path: string): string => (fold ? path.toLowerCase() : path)
  return (layouts ?? [])
    .filter(entry => key(relative).startsWith(`${key(entry.folder)}/`))
    .sort((a, b) => b.folder.length - a.folder.length)[0]
}

export function classifyPath(root: string, path: string, config: LayoutConfig = DEFAULT_LAYOUT_CONFIG): ClassifiedPath {
  const relative = relativeTo(root, path)
  if (relative === undefined || relative.endsWith('.d.ts')) {
    return { kind: 'other' }
  }
  const folder = folderFor(config.layouts, relative, foldsCase(root))
  // A folder's module ids join with `//`, which no path gives: `dashboard//x` (dashboard/src/x.ts) is never the main
  // layout's `dashboard/x` (src/dashboard/x.ts), so one test can never unlock both (review #5).
  const split = folder === undefined ? splitRoot(relative, config.roots) : { pkg: `${folder.folder}/`, rest: relative.slice(folder.folder.length + 1) }
  if (split === null) {
    return { kind: 'other' }
  }
  return classifyIn(split, folder?.layout ?? config.layout, config.stack)
}

function classifyIn(split: { pkg: string; rest: string }, layout: Layout, stack: StackName | undefined): ClassifiedPath {
  const exts = stackOf(stack).exts
  // By name the module is the basename on both sides, wherever the files sit.
  const reduce = (module: string): string => (layout.pairing === 'name' ? baseName(module) : module)
  // The test template first: under a colocated layout a test file is also of the source's shape.
  const test = matchTemplate(layout.test, split.rest, exts)
  if (test !== null) {
    return { kind: 'test', module: withPkg(split.pkg, reduce(test.module)) }
  }
  // A file named like a test is never source, whatever the layout says: `src/foo.test.ts` under the default
  // mirror layout is the colocated test for foo, and `tests/foo.spec.ts` is foo's test too.
  if (stackOf(stack).testFile.test(split.rest)) {
    const stem = untested(split.rest)
    const asSource = matchTemplate(layout.source, stem, exts)
    const asTest = matchTemplate(layout.test, stem.replace(/(\.[^./]+)$/, '.test$1'), exts)
    const module = asSource?.module ?? asTest?.module
    // Named like a test but in no place this layout knows: nobody's test, and still nobody's source.
    return module === undefined ? nobodys(split.rest, layout) : { kind: 'test', module: withPkg(split.pkg, reduce(module)) }
  }
  // A file inside a tests folder of its own that is not a test (a fixture, a conftest) is nobody's source.
  const testsRoot = literalRoot(layout.test)
  if (testsRoot !== null && testsRoot !== literalRoot(layout.source) && split.rest.startsWith(`${testsRoot}/`)) {
    return { kind: 'other', inTestFolder: true }
  }
  const source = matchTemplate(layout.source, split.rest, exts)
  if (source !== null) {
    return { kind: 'source', module: withPkg(split.pkg, reduce(source.module)) }
  }
  return nobodys(split.rest, layout)
}

/** The inverse of `withPkg`: the package root a module id starts with, under these root globs. */
export function moduleParts(module: string, roots: readonly string[]): { pkg: string; rest: string } {
  return splitRoot(module, roots) ?? { pkg: '', rest: module }
}

function joined(pkg: string, relative: string): string {
  return pkg === '' ? relative : `${pkg}/${relative}`
}

/** Where a module id starts and which layout places it: a folder of its own, else a package root, else the root. */
/** The deepest folder a module id says it came from: `<folder>//<module>`, the folder as the config spells it. */
function folderOfModule(layouts: readonly FolderLayout[] | undefined, module: string): FolderLayout | undefined {
  return (layouts ?? []).filter(entry => module.startsWith(`${entry.folder}//`)).sort((a, b) => b.folder.length - a.folder.length)[0]
}

function placed(config: LayoutConfig, module: string): { pkg: string; rest: string; layout: Layout } {
  const folder = folderOfModule(config.layouts, module)
  return folder === undefined
    ? { ...moduleParts(module, config.roots), layout: config.layout }
    : { pkg: folder.folder, rest: module.slice(folder.folder.length + 2), layout: folder.layout }
}

/**
 * How messages name a module: its source path when a folder with a layout of its own placed it, because its id there
 * (`dashboard/lib/pkce`) reads like a path and is not one (#24); its id otherwise, as it always was.
 */
export function moduleLabel(config: LayoutConfig, module: string): string {
  return folderOfModule(config.layouts, module) === undefined ? module : sourcePathFor(config, module)
}

/**
 * `tests/utils/a.test.ts(x)`, or `packages/app/tests/utils/a.test.ts(x)` under roots: what the agent is told to touch.
 * `sourceExt` is the extension of the source being edited, when one is: the test is then named with it (`a.js` →
 * `a.test.js`), because the agent creates exactly the file it is told to, and in a plain-JS repo a `.ts(x)` test is
 * one the runner never runs (#53). A layout that names its own display extension keeps it.
 */
export function testPathFor(config: LayoutConfig, module: string, sourceExt?: string): string {
  const { pkg, rest, layout } = placed(config, module)
  const stack = stackOf(config.stack)
  const known = sourceExt !== undefined && stack.exts.includes(sourceExt) ? sourceExt : undefined
  return joined(pkg, describeTestPath(layout, rest, layout.displayExt ?? known ?? stack.displayExt))
}

/** The extension of a path's file name, without the dot; undefined for a name with none. */
export function extOf(path: string): string | undefined {
  const name = path.slice(path.replace(/\\/g, '/').lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : undefined
}

/** `src/utils/a`: how messages name the source of a module. */
export function sourcePathFor(config: LayoutConfig, module: string): string {
  const { pkg, rest, layout } = placed(config, module)
  return joined(pkg, describeSourcePath(layout, rest))
}

/** A concrete test file path for a module, with this extension. */
export function testFileFor(config: LayoutConfig, module: string, ext: string): string {
  const { pkg, rest, layout } = placed(config, module)
  return joined(pkg, fillTemplate(layout.test, rest, ext))
}

/** The top-level directories git is asked about: where the templates start, or where the roots start; the whole root when a template starts anywhere. */
export function watchedDirs(config: LayoutConfig): string[] {
  const folders = (config.layouts ?? []).map(entry => entry.folder.split('/')[0] ?? entry.folder)
  if (config.roots.length > 0) {
    return [...new Set([...config.roots.map(root => root.split('/')[0] ?? root), ...folders])]
  }
  const dirs = [literalRoot(config.layout.source), literalRoot(config.layout.test)]
  return dirs.includes(null) ? ['.'] : [...new Set([...(dirs as string[]), ...folders])]
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
