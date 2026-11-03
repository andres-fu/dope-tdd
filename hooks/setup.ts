import { CONFIG_FILE, describeLayout, globMatches, parseConfig } from './config.ts'
import type { GuardConfig } from './config.ts'
import { LAYOUTS, baseName, matchTemplate } from './layout.ts'
import type { Layout, NodeLayoutName } from './layout.ts'
import { classifyPath, sourcePathFor, splitRoot, testFileFor } from './mirror.ts'
import type { LayoutConfig } from './mirror.ts'
import { STACKS, defaultLayoutOf, detectStackFrom, isCodeFileAny, isCodeFileIn, isTestFileIn, stackMarker } from './stacks.ts'
import type { Stack, StackName } from './stacks.ts'

/** What a walk of the project found: every code file and every directory with a package.json, relative to the root, and the names at the root. */
export type Survey = { files: readonly string[]; packageDirs: readonly string[]; rootEntries?: readonly string[]; unread?: readonly string[] }

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
  // Node code outside the nested packages (a stray Sidebar.jsx, a config file) is weighed, not a veto (Karl, round 3).
  const outside = nodeFiles.filter(file => !inNested(file))
  if (nodeFiles.length === 0 || nested.length === 0) {
    return null
  }
  // The other stack's code anywhere outside the nested packages, not only at the root itself: a FastAPI app keeps its
  // code in app/ (verified review D4, 2026-10-20).
  const atRoot = Object.values(STACKS)
    .filter(stack => stack.name !== 'node')
    .map(stack => {
      const files = survey.files.filter(file => !inNested(file) && isCodeFileIn(stack, file))
      return { stack, count: files.length, flat: files.every(file => !file.includes('/')) }
    })
    .reduce((best, entry) => (entry.count > best.count ? entry : best), { stack: STACKS.node, count: 0, flat: true })
  if (atRoot.count === 0 || atRoot.count <= outside.length) {
    return null
  }
  const where = [...new Set(nodeFiles.filter(inNested).map(file => nested.find(dir => file.startsWith(`${dir}/`))))].join(', ')
  const counted = `${atRoot.count} ${atRoot.stack.name} file${atRoot.count === 1 ? '' : 's'} ${atRoot.flat ? 'at the root' : `outside ${where}`}`
  if (outside.length > 0) {
    const named = outside.slice(0, 3).join(', ') + (outside.length > 3 ? ', ...' : '')
    return { stack: atRoot.stack.name, reason: `${counted} against ${outside.length} node file${outside.length === 1 ? '' : 's'} outside ${where} (${named})` }
  }
  return { stack: atRoot.stack.name, reason: `${counted}; the node code sits only under ${where}` }
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

/** Languages a survey can name but dope-tdd doesn't read: said plainly, not treated as Node (#268). */
const UNREAD_LANGUAGES: Readonly<Record<string, string>> = {
  go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', fs: 'F#', scala: 'Scala', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
}

function unreadLanguageOf(path: string): string | undefined {
  const ext = /\.([a-z]+)$/.exec(path)?.[1] ?? ''
  return Object.hasOwn(UNREAD_LANGUAGES, ext) ? UNREAD_LANGUAGES[ext] : undefined
}

/** Code in each stack, most first. `.cs` is .NET here: Godot's C# only counts once `project.godot` says it is Godot. */
function stackCounts(survey: Survey): { stack: Stack; count: number }[] {
  return Object.values(STACKS)
    .map(stack => ({ stack, count: survey.files.filter(file => isCodeFileIn(stack, file) && !(stack.name === 'godot' && file.endsWith('.cs'))).length }))
    .sort((a, b) => b.count - a.count)
}

const countReason = ({ stack, count }: { stack: Stack; count: number }): string => `${count} ${stack.name} file${count === 1 ? '' : 's'}, no marker at the root`

/** The stack with the most code and why, on the reading path, where C# is .NET. Undefined with no code it reads. */
function mostCode(survey: Survey): { stack: StackName; reason: string } | undefined {
  const top = stackCounts(survey)[0]
  return top === undefined || top.count === 0 ? undefined : { stack: top.stack.name, reason: countReason(top) }
}

export function isUnreadLanguage(path: string): boolean {
  return unreadLanguageOf(path) !== undefined
}

/** How much of the code one stack must hold for it to be the project's stack. A first guess, pinned by tests. */
const CLEAR_SHARE = 0.75

export type ProjectReading =
  | { kind: 'clear'; stack: StackName; reason: string }
  | { kind: 'mixed'; languages: string[] }
  | { kind: 'empty' }
  | { kind: 'unsupported'; languages: string[]; unguarded: StackName[] }

/**
 * #268: only a project with no config file and no marker is read from its code. Any config file, valid or not, and any
 * marker behave as they always did: `Config wins` (docs/decisions/2026-10-31_project-detection.md).
 */
export function needsWalk(configText: string | null, marked: StackName | undefined): boolean {
  return configText === null && marked === undefined
}

/** What the code of a project with no marker says it is. A repo that can't decide says so. */
export function readProject(survey: Survey): ProjectReading {
  const counts = stackCounts(survey).filter(entry => entry.count > 0)
  const code = counts.reduce((sum, entry) => sum + entry.count, 0)
  const unread = new Map<string, number>()
  for (const path of survey.unread ?? []) {
    const language = unreadLanguageOf(path) ?? ''
    unread.set(language, (unread.get(language) ?? 0) + 1)
  }
  const unreadTotal = survey.unread?.length ?? 0
  if (code === 0 && unreadTotal === 0) {
    return { kind: 'empty' }
  }
  const unreadMost = [...unread.entries()].sort((a, b) => b[1] - a[1])
  if (unreadTotal > code) {
    // Node's defaults run here, so any other stack's code is left out with the unread language.
    return { kind: 'unsupported', languages: unreadMost.map(([language]) => language), unguarded: counts.map(entry => entry.stack.name).filter(name => name !== 'node').sort() }
  }
  const top = counts[0]
  if (top !== undefined && top.count / (code + unreadTotal) >= CLEAR_SHARE) {
    return { kind: 'clear', stack: top.stack.name, reason: countReason(top) }
  }
  const languages = [...counts.map(({ stack, count }): [string, number] => [stack.name, count]), ...unreadMost].sort((a, b) => b[1] - a[1])
  return { kind: 'mixed', languages: languages.slice(0, 2).map(([language]) => language) }
}

/** The stack a reading sets; only a clear one does. */
export function projectStack(reading: ProjectReading): StackName | undefined {
  return reading.kind === 'clear' ? reading.stack : undefined
}

const SAVING_GUARDS_ONE = '/tdd setup write guards one stack, the one with the most code.'

/** What the briefing says about a reading. Node's defaults are what run unless it is clear, so the note says that. */
export function projectNote(reading: ProjectReading): string {
  switch (reading.kind) {
    case 'clear':
      return `No ${CONFIG_FILE} here, so this project was read from its code as ${reading.stack} (${reading.reason}). To keep that, the user can run /tdd setup write.`
    case 'mixed':
      return `This project mixes ${reading.languages.join(' and ')}, so nothing here says which it is. The Node defaults run, so other code is not guarded. ${SAVING_GUARDS_ONE}`
    case 'empty':
      return 'No code Dope TDD reads here yet, so the Node defaults run and any other code is not guarded. The next session reads the project from what is here then.'
    case 'unsupported': {
      const alsoLeftOut = reading.unguarded.length === 0 ? '' : ` The ${reading.unguarded.join(' and ')} code here isn't guarded either. ${SAVING_GUARDS_ONE}`
      return `Dope TDD doesn't read ${reading.languages.join(' and ')} yet, so edits to that code are not guarded.${alsoLeftOut}`
    }
  }
}

/**
 * The briefing's note on the project. A layout that pairs nothing means nothing is guarded, so that warning stays ahead
 * of a clear reading, and beside a reading that isn't clear, which must always be said.
 */
export function briefingNote(reading: ProjectReading | null, layoutNote: string | null): string | null {
  if (reading === null) {
    return layoutNote
  }
  if (reading.kind === 'clear') {
    return layoutNote ?? projectNote(reading)
  }
  return layoutNote === null ? projectNote(reading) : `${projectNote(reading)} ${layoutNote}`
}

/** The repo's layout, when the default pairs none of its code. A default that pairs something stays, as it always did. */
export function inferenceFor(survey: Survey, config: GuardConfig): Inference | null {
  return layoutMismatch(survey, config) === null ? null : inferLayout(survey, config.stack)
}

/** The config a session runs on: the layout the repo shows, from memory, when there is one. Nothing is written. */
export function withInference(config: GuardConfig, inferred: Inference | null): GuardConfig {
  return inferred === null ? config : { ...config, layout: inferred.layout, roots: inferred.roots }
}

/** All one walk settles for a project with nothing else to go on. */
export type ProjectAnswer = {
  reading: ProjectReading
  inferred: Inference | null
  /** The layout note while the reading applies. */
  layoutNote: string | null
  /** The note the default layout alone earns, which a config saved mid-session falls back on (#214). */
  defaultNote: string | null
}

export function answerFrom(survey: Survey): ProjectAnswer {
  const reading = readProject(survey)
  const stack = projectStack(reading)
  const config = parseConfig(null, stack)
  const inferred = stack === undefined ? null : inferenceFor(survey, config)
  return { reading, inferred, layoutNote: layoutMismatch(survey, withInference(config, inferred), mostCode(survey)?.stack), defaultNote: layoutMismatch(survey, parseConfig(null, undefined)) }
}

/** The layout note for the config in force: the reading's while one applies, else the default's (#167, #214). */
export function activeLayoutNote(answer: ProjectAnswer | null, config: GuardConfig, defaultNote: string | null): string | null {
  if (answer !== null) {
    return answer.layoutNote
  }
  return config.layoutGuessed === true ? defaultNote : null
}

/** What `/tdd setup` detects: the stack the config pins, else on the reading path the one with the most code, else what the survey says. */
export function setupInference(survey: Survey, current: GuardConfig, reading: ProjectReading | null): Inference {
  if (current.stackSource === 'config') {
    return inferLayout(survey, current.stack)
  }
  const most = reading === null ? undefined : mostCode(survey)
  return most === undefined ? inferLayout(survey) : inferLayout(survey, most.stack, most.reason)
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
    return { stack: stack.name, stackReason, ...coveringLayout(files, stack, fallback), roots: [], testFiles: 0 }
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

/**
 * With no tests to read a layout from, the default stays unless it leaves code out that another preset covers: Python's
 * default only covers src/, so a root-level api.py paired with nothing and went unguarded (Karl's Axiom backend,
 * 2026-10-19). Ties keep the earlier preset, so the default wins any tie and package beats colocated and flat.
 */
function coveringLayout(files: readonly string[], stack: Stack, fallback: Layout): { layout: Layout; reason: string } {
  const code = files.filter(file => isCodeFileIn(stack, file) && !isTestFileIn(stack, file))
  const covered = (layout: Layout) => code.filter(file => classifyPath('R:', `R:/${file}`, { layout, roots: [], stack: stack.name }).kind === 'source').length
  const fallbackCount = covered(fallback)
  const best = Object.values(stack.layouts).reduce(
    (winner, layout) => {
      const count = covered(layout)
      return count > winner.count ? { layout, count } : winner
    },
    { layout: fallback, count: fallbackCount },
  )
  if (best.layout === fallback) {
    return { layout: fallback, reason: 'no test files found, assuming the default' }
  }
  return { layout: best.layout, reason: `no test files found; ${best.layout.name} covers ${best.count} of ${code.length} code files, ${fallback.name} covers ${fallbackCount}` }
}

/** `named` is the stack already settled, when it is, for `why`; otherwise the survey decides. */
export function inferLayout(survey: Survey, named?: StackName, why = `named in ${CONFIG_FILE}`): Inference {
  const chosen = named === undefined ? inferStack(survey) : { stack: named, reason: why }
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

/**
 * What to tell Claude when no dope-tdd.json names a layout and the default matches none of the project's code (#167):
 * then nothing is ever refused, and before this nothing said so. Null when a config file names the layout, the default
 * pairs some code, or there is no code to pair. `read`: the stack a reading settled, so the note names the same one.
 */
export function layoutMismatch(survey: Survey, current: GuardConfig, read?: StackName): string | null {
  if (current.layoutGuessed !== true) {
    return null
  }
  const stack = STACKS[current.stack]
  const code = survey.files.filter(file => isCodeFileIn(stack, file) && !isTestFileIn(stack, file))
  const config: LayoutConfig = { layout: current.layout, roots: current.roots, stack: current.stack }
  if (code.length === 0 || code.some(file => classifyPath('R:', `R:/${file}`, config).kind === 'source')) {
    return null
  }
  const inferred = inferLayout(survey, read)
  const where = inferred.roots.length === 0 ? '' : ` under ${inferred.roots.join(', ')}`
  return (
    `The default layout matches none of this project's code, so no edit is refused until a ${CONFIG_FILE} is saved: ` +
    `ask the user to run /tdd setup. It finds ${describeLayout(inferred.layout)}${where}.`
  )
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

/** `testCommand`: how a test runs under the detected config, with a placeholder; absent when no runner was found. */
export function formatSetup(current: GuardConfig, inferred: Inference, survey: Survey, hasConfigFile: boolean, testCommand?: string): string {
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
    ...(testCommand === undefined ? [] : [`test command: ${testCommand}`]),
    // Karl's round 4 (2026-10-20): with no file, `; stack node` beside `detected stack: python` read as a contradiction.
    // Both were true: until the file names a stack, the guard reads only the markers at the root. So it says that.
    !hasConfigFile && current.stack !== inferred.stack
      ? `current ${CONFIG_FILE}: none. Until one is saved, the guard runs as ${current.stack} (${current.stackSource === 'default' ? 'the default, with no marker at the root' : 'from the markers at the root'}), not ${inferred.stack}`
      : `current ${CONFIG_FILE}: ${hasConfigFile ? describeLayout(current.layout) : 'none (mirror by default)'}${current.roots.length === 0 ? '' : `; roots ${current.roots.join(', ')}`}${currentStack}`,
    ...(same
      ? ['the current layout already matches; nothing to write']
      : [`suggested ${CONFIG_FILE}:`, suggestion, `/tdd setup write saves it (mode, scope and exempt are kept)`]),
  ].join('\n')
}
