import { CONFIG_FILE, describeLayout } from './config'
import type { GuardConfig } from './config'
import { LAYOUTS } from './layout'
import type { Layout, LayoutName } from './layout'
import { classifyPath, sourcePathFor, splitRoot, testFileFor } from './mirror'
import type { LayoutConfig } from './mirror'

/** What a walk of the project found: every code file and every directory with a package.json, relative to the root. */
export type Survey = { files: readonly string[]; packageDirs: readonly string[] }

export type Inference = { layout: Layout; roots: string[]; testFiles: number; reason: string }

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const CODE_FILE = /\.[cm]?[jt]sx?$/
const EXTS = ['ts', 'tsx', 'js', 'jsx']
const EXAMPLES = 3

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path) && !path.endsWith('.d.ts')
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

function shapeOf(relative: string): Exclude<LayoutName, 'custom'> | null {
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

export function inferLayout(survey: Survey): Inference {
  const roots = inferRoots(survey)
  const tally: Record<Exclude<LayoutName, 'custom'>, number> = { mirror: 0, colocated: 0, __tests__: 0 }
  let testFiles = 0
  for (const file of survey.files.filter(isTestFile)) {
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
  const order: Exclude<LayoutName, 'custom'>[] = ['mirror', 'colocated', '__tests__']
  const best = order.reduce((winner, name) => (tally[name] > tally[winner] ? name : winner), 'mirror')
  const reason =
    testFiles === 0
      ? 'no test files found, assuming the default'
      : `${tally[best]} of ${testFiles} test file${testFiles === 1 ? '' : 's'} ${best === 'mirror' ? 'sit under tests/' : best === 'colocated' ? 'sit next to their source' : 'sit in __tests__ folders'}`
  return { layout: LAYOUTS[best], roots, testFiles, reason }
}

function examples(survey: Survey, config: LayoutConfig): string[] {
  const root = 'R:'
  const known = new Set(survey.files)
  return survey.files
    .filter(isTestFile)
    .flatMap(file => {
      const target = classifyPath(root, `${root}/${file}`, config)
      if (target.kind !== 'test') {
        return []
      }
      const source = EXTS.map(ext => testFileFor(config, target.module, ext).replace(/^.*$/, () => sourceFile(config, target.module, ext))).find(candidate => known.has(candidate))
      return [`  ${file} ↔ ${source ?? `${sourcePathFor(config, target.module)}.* (no source file found)`}`]
    })
    .slice(0, EXAMPLES)
}

function sourceFile(config: LayoutConfig, module: string, ext: string): string {
  return `${sourcePathFor(config, module)}.${ext}`
}

export function suggestedConfig(current: GuardConfig, inferred: Inference): Record<string, unknown> {
  return {
    ...(current.mode === 'enforce' ? {} : { mode: current.mode }),
    ...(current.scope.length === 0 ? {} : { scope: current.scope }),
    ...(current.exempt.length === 0 ? {} : { exempt: current.exempt }),
    ...(inferred.layout.name === 'mirror' ? {} : { layout: inferred.layout.name }),
    ...(inferred.roots.length === 0 ? {} : { roots: inferred.roots }),
  }
}

export function formatSetup(current: GuardConfig, inferred: Inference, survey: Survey, hasConfigFile: boolean): string {
  const config: LayoutConfig = { layout: inferred.layout, roots: inferred.roots }
  const suggestion = JSON.stringify(suggestedConfig(current, inferred), null, 2)
  const same = current.layout.source === inferred.layout.source && current.layout.test === inferred.layout.test && current.roots.join() === inferred.roots.join()
  return [
    'dope-tdd setup',
    `detected layout: ${describeLayout(inferred.layout)}; ${inferred.reason}`,
    ...(inferred.roots.length === 0 ? [] : [`detected roots: ${inferred.roots.join(', ')}`]),
    ...(inferred.testFiles === 0 ? [] : ['examples:', ...examples(survey, config)]),
    `current ${CONFIG_FILE}: ${hasConfigFile ? describeLayout(current.layout) : 'none (mirror by default)'}${current.roots.length === 0 ? '' : `; roots ${current.roots.join(', ')}`}`,
    ...(same
      ? ['the current layout already matches; nothing to write']
      : [`suggested ${CONFIG_FILE}:`, suggestion, `/tdd setup write saves it (mode, scope and exempt are kept)`]),
  ].join('\n')
}
