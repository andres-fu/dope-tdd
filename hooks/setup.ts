import { CONFIG_FILE, describeLayout, globMatches } from './config.ts'
import type { GuardConfig } from './config.ts'
import { LAYOUTS, baseName, matchTemplate } from './layout.ts'
import type { Layout, NodeLayoutName } from './layout.ts'
import { classifyPath, sourcePathFor, splitRoot, testFileFor } from './mirror.ts'
import type { LayoutConfig } from './mirror.ts'
import { STACKS, defaultLayoutOf, detectStackFrom, isCodeFileAny, isCodeFileIn, isTestFileIn, stackMarker } from './stacks.ts'
import type { Stack, StackName } from './stacks.ts'

/** What a walk of the project found: every code file and every directory with a package.json, relative to the root, and the names at the root. */
export type Survey = { files: readonly string[]; packageDirs: readonly string[]; rootEntries?: readonly string[] }

export type Inference = {
  stack: StackName
  stackReason: string
  layout: Layout
  roots: string[]
  testFiles: number
  reason: string
}

const EXAMPLES = 3

export function isTestFile(path: string, stack: Stack = STACKS.node): boolean {
  return isTestFileIn(stack, path)
}

/** Code of the given stack, or of any stack when none is given (a survey before the stack is known). */
export function isCodeFile(path: string, stack?: Stack): boolean {
  return stack === undefined ? isCodeFileAny(path) : isCodeFileIn(stack, path)
}

/**
 * A package.json at the root can belong to an app in a subfolder: all its code sits in nested packages, while another
 * stack's code sits at the root itself (Karl's Axiom backend, 2026-10-19: api.py at the root, React in klq-frontend).
 * Then the root's own code decides, since one dope-tdd.json guards one stack. Null when node code is at the root too.
 */
function nodeOnlyNested(survey: Survey): { stack: StackName; reason: string } | null {
  const nested = survey.packageDirs.filter(dir => dir !== '')
  const nodeFiles = survey.files.filter(file => isCodeFileIn(STACKS.node, file))
  const inNested = (file: string) => nested.some(dir => file.startsWith(`${dir}/`))
  if (nodeFiles.length === 0 || !nodeFiles.every(inNested)) {
    return null
  }
  const atRoot = Object.values(STACKS)
    .filter(stack => stack.name !== 'node')
    .map(stack => ({ stack, count: survey.files.filter(file => !file.includes('/') && isCodeFileIn(stack, file)).length }))
    .reduce((best, entry) => (entry.count > best.count ? entry : best), { stack: STACKS.node, count: 0 })
  if (atRoot.count === 0) {
    return null
  }
  const where = [...new Set(nodeFiles.map(file => nested.find(dir => file.startsWith(`${dir}/`))))].join(', ')
  return { stack: atRoot.stack.name, reason: `${atRoot.count} ${atRoot.stack.name} file${atRoot.count === 1 ? '' : 's'} at the root; the node code sits only under ${where}` }
}

/** The stack a survey points at: a marker at the root first, then whichever stack owns most of the code files, then Node. */
export function inferStack(survey: Survey): { stack: StackName; reason: string } {
  const entries = survey.rootEntries ?? []
  const marked = detectStackFrom(entries)
  if (marked === 'node') {
    const rooted = nodeOnlyNested(survey)
    if (rooted !== null) {
      return rooted
    }
  }
  if (marked !== null) {
    return { stack: marked, reason: `${stackMarker(entries, marked) ?? 'a marker'} at the root` }
  }
  const counts = Object.values(STACKS).map(stack => ({ stack, count: survey.files.filter(file => isCodeFileIn(stack, file)).length }))
  const most = counts.reduce((best, entry) => (entry.count > best.count ? entry : best), { stack: STACKS.node, count: 0 })
  if (most.count === 0) {
    return { stack: 'node', reason: 'no code found, assuming Node' }
  }
  return { stack: most.stack.name, reason: `${most.count} ${most.stack.name} file${most.count === 1 ? '' : 's'}, no marker at the root` }
}

/** Package directories that hold a `src/`, grouped into `parent/*` globs when siblings share a parent. */
function inferRoots(survey: Survey): string[] {
  const withSource = survey.packageDirs.filter(dir => dir !== '' && survey.files.some(file => file.startsWith(`${dir}/src/`)))
  const byParent = new Map<string, string[]>()
  for (const dir of withSource) {
    const slash = dir.lastIndexOf('/')
    const parent = slash === -1 ? '' : dir.slice(0, slash)
    byParent.set(parent, [...(byParent.get(parent) ?? []), dir])
  }
  const roots = [...byParent.entries()].flatMap(([parent, dirs]) => (dirs.length > 1 && parent !== '' ? [`${parent}/*`] : dirs))
  return roots.sort()
}

function shapeOf(relative: string): NodeLayoutName | null {
  if (relative.startsWith('tests/')) {
    return 'mirror'
  }
  if (relative.includes('__tests__/')) {
    return '__tests__'
  }
  if (relative.startsWith('src/')) {
    return 'colocated'
  }
  return null
}

function nodeInference(survey: Survey, stackReason: string): Inference {
  const roots = inferRoots(survey)
  const tally: Record<NodeLayoutName, number> = { mirror: 0, colocated: 0, __tests__: 0 }
  let testFiles = 0
  for (const file of survey.files.filter(file => isTestFileIn(STACKS.node, file))) {
    const split = splitRoot(file, roots)
    if (split === null) {
      continue
    }
    testFiles++
    const shape = shapeOf(split.rest)
    if (shape !== null) {
      tally[shape]++
    }
  }
  const order: NodeLayoutName[] = ['mirror', 'colocated', '__tests__']
  const best = order.reduce((winner, name) => (tally[name] > tally[winner] ? name : winner), 'mirror')
  const reason =
    testFiles === 0
      ? 'no test files found, assuming the default'
      : `${tally[best]} of ${testFiles} test file${testFiles === 1 ? '' : 's'} ${best === 'mirror' ? 'sit under tests/' : best === 'colocated' ? 'sit next to their source' : 'sit in __tests__ folders'}`
  return { stack: 'node', stackReason, layout: LAYOUTS[best], roots, testFiles, reason }
}

/**
 * For every other stack: the preset under which the most test files pair with
 * a source file that exists, then the most that read as tests at all; ties go
 * to the stack's default. Exempt paths (an addons folder) do not count.
 */
function presetInference(survey: Survey, stack: Stack, stackReason: string): Inference {
  const root = 'R:'
  const files = survey.files.filter(file => !stack.exempt.some(glob => globMatches(glob, file)))
  const known = new Set(files)
  const testFiles = files.filter(file => isTestFileIn(stack, file))
  const fallback = defaultLayoutOf(stack)
  if (testFiles.length === 0) {
    return { stack: stack.name, stackReason, layout: fallback, roots: [], testFiles: 0, reason: 'no test files found, assuming the default' }
  }
  // Under a name-paired layout a test pairs with any code file of that basename, wherever it sits.
  const sourceNames = new Set(files.filter(file => !isTestFileIn(stack, file)).map(file => baseName(file).replace(/\.[^.]+$/, '')))
  const score = (layout: Layout): { pairs: number; matched: number } => {
    const config: LayoutConfig = { layout, roots: [], stack: stack.name }
    let pairs = 0
    let matched = 0
    for (const file of testFiles) {
      const target = classifyPath(root, `${root}/${file}`, config)
      // Only a test the layout's own template places is evidence for that layout; the named-like-a-test rescue is not.
      if (target.kind !== 'test' || matchTemplate(layout.test, file, stack.exts) === null) {
        continue
      }
      matched++
      const paired =
        layout.pairing === 'name' ? sourceNames.has(baseName(target.module)) : stack.exts.some(ext => known.has(sourceFile(config, target.module, ext)))
      if (paired) {
        pairs++
      }
    }
    return { pairs, matched }
  }
  let best = { layout: fallback, ...score(fallback) }
  for (const layout of Object.values(stack.layouts)) {
    const candidate = { layout, ...score(layout) }
    if (candidate.pairs > best.pairs || (candidate.pairs === best.pairs && candidate.matched > best.matched)) {
      best = candidate
    }
  }
  const reason = `${best.pairs} of ${testFiles.length} test file${testFiles.length === 1 ? '' : 's'} pair with a source under ${best.layout.name}`
  return { stack: stack.name, stackReason, layout: best.layout, roots: [], testFiles: testFiles.length, reason }
}

/** `named` is the stack the config pins, when it does; otherwise the survey decides. */
export function inferLayout(survey: Survey, named?: StackName): Inference {
  const chosen = named === undefined ? inferStack(survey) : { stack: named, reason: `named in ${CONFIG_FILE}` }
  if (chosen.stack !== 'node') {
    return presetInference(survey, STACKS[chosen.stack], chosen.reason)
  }
  const byShape = nodeInference(survey, chosen.reason)
  // A flat test/ folder fits none of the mirrored shapes; then the presets are scored like any other stack's.
  const noShapeFits = byShape.testFiles > 0 && byShape.reason.startsWith('0 of ')
  return noShapeFits ? presetInference(survey, STACKS.node, chosen.reason) : byShape
}

function examples(survey: Survey, config: LayoutConfig, stack: Stack): string[] {
  const root = 'R:'
  const known = new Set(survey.files)
  return survey.files
    .filter(file => isTestFileIn(stack, file))
    .flatMap(file => {
      const target = classifyPath(root, `${root}/${file}`, config)
      if (target.kind !== 'test') {
        return []
      }
      const source = stack.exts.map(ext => testFileFor(config, target.module, ext).replace(/^.*$/, () => sourceFile(config, target.module, ext))).find(candidate => known.has(candidate))
      return [`  ${file} ↔ ${source ?? `${sourcePathFor(config, target.module)}.* (no source file found)`}`]
    })
    .slice(0, EXAMPLES)
}

function sourceFile(config: LayoutConfig, module: string, ext: string): string {
  return `${sourcePathFor(config, module)}.${ext}`
}

export function suggestedConfig(current: GuardConfig, inferred: Inference): Record<string, unknown> {
  const stack = STACKS[inferred.stack]
  return {
    ...(current.mode === 'enforce' ? {} : { mode: current.mode }),
    ...(current.scope.length === 0 ? {} : { scope: current.scope }),
    ...(current.exempt.filter(glob => !stack.exempt.includes(glob)).length === 0 ? {} : { exempt: current.exempt.filter(glob => !stack.exempt.includes(glob)) }),
    ...(inferred.stack === 'node' ? {} : { stack: inferred.stack }),
    ...(inferred.layout.name === defaultLayoutOf(stack).name ? {} : { layout: inferred.layout.name }),
    ...(inferred.roots.length === 0 ? {} : { roots: inferred.roots }),
    ...(current.godot === null ? {} : { godot: current.godot }),
  }
}

export function formatSetup(current: GuardConfig, inferred: Inference, survey: Survey, hasConfigFile: boolean): string {
  const stack = STACKS[inferred.stack]
  const config: LayoutConfig = { layout: inferred.layout, roots: inferred.roots, stack: inferred.stack }
  const suggestion = JSON.stringify(suggestedConfig(current, inferred), null, 2)
  const same =
    current.stack === inferred.stack &&
    current.layout.source === inferred.layout.source &&
    current.layout.test === inferred.layout.test &&
    current.roots.join() === inferred.roots.join()
  const currentStack = current.stack === 'node' && current.stackSource === 'default' ? '' : `; stack ${current.stack}`
  return [
    'dope-tdd setup',
    ...(inferred.stack === 'node' && inferred.stackReason.startsWith('no code') ? [] : [`detected stack: ${inferred.stack} (${inferred.stackReason})`]),
    `detected layout: ${describeLayout(inferred.layout)}; ${inferred.reason}`,
    ...(inferred.roots.length === 0 ? [] : [`detected roots: ${inferred.roots.join(', ')}`]),
    ...(inferred.testFiles === 0 ? [] : ['examples:', ...examples(survey, config, stack)]),
    `current ${CONFIG_FILE}: ${hasConfigFile ? describeLayout(current.layout) : 'none (mirror by default)'}${current.roots.length === 0 ? '' : `; roots ${current.roots.join(', ')}`}${currentStack}`,
    ...(same
      ? ['the current layout already matches; nothing to write']
      : [`suggested ${CONFIG_FILE}:`, suggestion, `/tdd setup write saves it (mode, scope and exempt are kept)`]),
  ].join('\n')
}
