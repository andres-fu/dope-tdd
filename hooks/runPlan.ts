// What a read test run does to the session's record, as plain data in and out (#59). `checkShell` in register.tsx
// gathers what needs `$` first (the imports of each failing test, whether a module has a test of its own), applies the
// plan in one state change, then remembers the unlocks it names across sessions.
import type { TddStats } from '../types'
import type { GuardConfig } from './config.ts'
import { classifyPath, pathKey, relativePath } from './mirror.ts'
import {
  closeCyclesForTest,
  recordCarriedRun,
  recordImporter,
  recordOtherPass,
  recordRedFor,
  recordRedUnlock,
  recordRun,
  recordRunTarget,
} from './stats.ts'

export function absolutePath(root: string, path: string): string {
  return /^([A-Za-z]:|[\\/])/.test(path) ? path : `${root}/${path}`
}

/** The test files the runner named as failed, as modules; empty when the output names none. */
function failedModules(root: string, files: readonly string[], config: GuardConfig): string[] {
  return files.flatMap(file => {
    const target = classifyPath(root, absolutePath(root, file), config)
    return target.kind === 'test' ? [target.module] : []
  })
}

/** The runner prints paths relative to where it ran; resolve them there, then name them from the root. */
export function failedTestPaths(root: string, runLocation: string | null, files: readonly string[]): string[] {
  return files.map(path => relativePath(root, /^(?:[A-Za-z]:|\/)/.test(path) ? path : `${runLocation}/${path}`))
}

/** The test files a red run failed, absolute and once each: those the runner named, and the one the command named. */
export function failingTestFiles(root: string, config: GuardConfig, failed: readonly string[], named: string | undefined): string[] {
  const target = named === undefined ? null : classifyPath(root, named, config)
  return [...new Set([...failed.map(path => absolutePath(root, path)), ...(named !== undefined && target?.kind === 'test' ? [named] : [])])]
}

export type RunFacts = {
  readonly outcome: 'pass' | 'fail'
  /** The test file the command names, absolute. */
  readonly named: string | undefined
  /** The run is filtered to some tests by name. */
  readonly filtered: boolean
  /** The modules the named test imports. */
  readonly namedImports: readonly string[]
  /** The failed test files, named from the root (`failedTestPaths`); empty for a green. */
  readonly failed: readonly string[]
  /** The modules each failing test file imports, keyed by its absolute path (`failingTestFiles`). */
  readonly importsOf: Readonly<Record<string, readonly string[]>>
  /** Whether a module has a test of its own, for each module a failing test imports. */
  readonly ownTest: Readonly<Record<string, boolean>>
}

export type RunPlan = {
  readonly state: TddStats
  /** Modules a red unlocked, in order, repeats kept: one reminder line each. */
  readonly redUnlocked: string[]
  /** Unlocks to remember across sessions, in order. */
  readonly remember: { module: string; testPath: string }[]
  /** Failed test files when the current module's own did not fail: a red elsewhere. */
  readonly elsewhere: string[]
  /** Modules whose carried-over unlock this run made active again (#54). */
  readonly carriedOn: string[]
  /** The run closed the current module's own cycle, before it closed other modules' (#41). */
  readonly ownCycleClosed: boolean
  /** False for a green that is not about the current module: it must not close its cycle or start its catch check. */
  readonly countsForCurrent: boolean
}

/** A read run, red or green, applied to the record. */
export function applyRun(s: TddStats, facts: RunFacts, root: string, config: GuardConfig, nowMs: number): RunPlan {
  const { outcome, named, filtered, namedImports } = facts
  const target = named === undefined ? null : classifyPath(root, named, config)
  const redUnlocked: string[] = []
  const remember: { module: string; testPath: string }[] = []
  let elsewhere: string[] = []
  let targeted = s
  const current = s.current
  // The run is the current module's test, or a test that imports it: the band stays on the module being worked on.
  const keepsCurrent =
    current !== null && named !== undefined && (pathKey(current.testPath) === pathKey(named) || namedImports.includes(current.module))
  if (target?.kind === 'test' && named !== undefined && !keepsCurrent) {
    // A red on the module's own test is the evidence a touch stands for: it unlocks the module, and the band follows it.
    const testPath = named
    if (outcome === 'fail' && s.unlocked[target.module] === undefined) {
      targeted = recordRedUnlock(targeted, target.module, testPath, true)
      remember.push({ module: target.module, testPath })
      redUnlocked.push(target.module)
    } else {
      targeted = recordRunTarget(targeted, target.module)
    }
  }
  if (outcome === 'fail') {
    const { failed } = facts
    // Every test file the runner named as failed unlocks its module the same way, without becoming current.
    for (const path of failed) {
      const seen = classifyPath(root, absolutePath(root, path), config)
      if (seen.kind === 'test' && targeted.unlocked[seen.module] === undefined) {
        targeted = recordRedUnlock(targeted, seen.module, absolutePath(root, path), false)
        remember.push({ module: seen.module, testPath: absolutePath(root, path) })
        redUnlocked.push(seen.module)
      }
    }
    // A failing test is a red for every module it imports: unlocked if they were not, and their cycle saw red.
    const failingTests = failingTestFiles(root, config, failed, named)
    const coveredByFailure: string[] = []
    for (const testFile of failingTests) {
      for (const module of facts.importsOf[testFile] ?? []) {
        coveredByFailure.push(module)
        targeted = recordImporter(targeted, module, testFile)
        if (targeted.unlocked[module] === undefined && facts.ownTest[module] === false) {
          targeted = recordRedUnlock(targeted, module, testFile, false)
          remember.push({ module, testPath: testFile })
          redUnlocked.push(module)
        }
      }
    }
    const own = targeted.current?.module
    // Only a module this test now unlocks: one with a test of its own (#37) would be left red with nothing to close it.
    for (const module of [...new Set(coveredByFailure)].filter(module => module !== own && targeted.unlocked[module] !== undefined)) {
      targeted = recordRedFor(targeted, module, nowMs)
    }
    // The suite is red; the module is red only if its own test, or a test that imports it, is among the files that failed.
    const ownFailed = own !== undefined && (failedModules(root, failed, config).includes(own) || coveredByFailure.includes(own))
    elsewhere = failed.length > 0 && own !== undefined && !ownFailed ? [...failed] : []
  }
  // A green of another module's own test, when the band could not follow it there (that module is not unlocked) and
  // the test does not import the current module, says nothing about the current module (seen on dope-tdd, 2026-10-18).
  const otherGreen =
    outcome === 'pass' && target?.kind === 'test' && !keepsCurrent && targeted.current?.module !== target.module ? target.module : null
  const countsForCurrent = otherGreen === null
  let afterRun = otherGreen === null ? recordRun(targeted, outcome === 'pass', nowMs, elsewhere) : recordOtherPass(targeted, otherGreen, nowMs)
  const ownCycleClosed = afterRun.cycles > s.cycles
  const carriedOn: string[] = []
  // #54: a whole-file run of the test behind a carried-over unlock, red or green, is the run its first edit waits for.
  // Only a run that names the file: a suite run need not have run it, and a filtered one ran only some of it.
  if (named !== undefined && !filtered) {
    const carried = Object.keys(afterRun.inherited).filter(module => {
      const testPath = afterRun.unlocked[module]
      return testPath !== undefined && pathKey(testPath) === pathKey(named)
    })
    if (carried.length > 0) {
      afterRun = recordCarriedRun(afterRun, carried, nowMs)
      carriedOn.push(...carried)
    }
  }
  if (outcome === 'pass' && (named !== undefined || !filtered)) {
    // The test file passed, or the whole suite did: no other module it is the test for stays red behind it.
    afterRun = closeCyclesForTest(afterRun, named ?? null, afterRun.current?.module, nowMs)
  }
  return { state: afterRun, redUnlocked, remember, elsewhere, carriedOn, ownCycleClosed, countsForCurrent }
}
