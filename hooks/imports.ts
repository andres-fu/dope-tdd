import type { StackName } from './stacks.ts'

/**
 * What a test file imports from the project, as paths relative to the root it
 * could name. A test covers what it imports: `test/slugify.test.ts` importing
 * `../src/lib/io.js` covers `src/lib/io.ts`, whatever the two files are called.
 * Type-only imports carry no behaviour and are left out.
 */

// import x from './a', import './a', import { b } from "../a.js", export * from './a', import('./a'), require('./a').
const JS_IMPORT = /(?:\bimport\s+(?!type\b)(?:[^'";]*?\s+from\s+)?|\bexport\s+(?!type\b)[^'";]*?\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
// from pkg.calc import add / from .calc import add / import pkg.calc
const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+)/gm
// preload("res://scripts/player.gd") / load("res://...")
const GD_LOAD = /\b(?:pre)?load\(\s*["']res:\/\/([^"']+)["']\s*\)/g

const JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Joins and resolves `.` and `..`; null when the path climbs above the root. */
export function joinRelative(base: string, spec: string): string | null {
  const out: string[] = []
  for (const part of `${base}/${spec}`.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      if (out.length === 0) {
        return null
      }
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

function jsCandidates(testPath: string, spec: string): string[] {
  const joined = joinRelative(dirOf(testPath), spec)
  if (joined === null) {
    return []
  }
  // TypeScript ESM writes the emitted extension: './io.js' names './io.ts'.
  const stem = joined.replace(/\.(?:[cm]?js|jsx)$/, '')
  return [joined, ...JS_EXTS.map(ext => `${stem}.${ext}`), ...JS_EXTS.map(ext => `${stem}/index.${ext}`)]
}

function pyCandidates(testPath: string, dotted: string): string[] {
  const leading = /^\.*/.exec(dotted)?.[0].length ?? 0
  const name = dotted.slice(leading).replace(/\./g, '/')
  if (leading > 0) {
    let base: string | null = dirOf(testPath)
    for (let i = 1; i < leading && base !== null; i++) {
      base = joinRelative(base, '..')
    }
    return base === null || name === '' ? [] : [`${base === '' ? '' : `${base}/`}${name}.py`, `${base === '' ? '' : `${base}/`}${name}/__init__.py`]
  }
  return name === '' ? [] : [`${name}.py`, `src/${name}.py`, `${name}/__init__.py`, `src/${name}/__init__.py`]
}

function matches(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

/** Candidate paths, relative to the root, for everything the test at `testPath` imports from the project. */
export function importCandidates(testPath: string, text: string, stack: StackName): string[] {
  const candidates =
    stack === 'node'
      ? matches(JS_IMPORT, text).flatMap(spec => jsCandidates(testPath, spec))
      : stack === 'python'
        ? [...matches(PY_FROM, text), ...matches(PY_IMPORT, text)].flatMap(dotted => pyCandidates(testPath, dotted))
        : stack === 'godot'
          ? matches(GD_LOAD, text)
          : []
  return [...new Set(candidates)]
}
