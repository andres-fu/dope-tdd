import { failedFiles as nodeFailedFiles, runOutcome as readNode, stripAnsi } from './runOutcome.ts'
import type { RunOutcome } from './runOutcome.ts'
import { ELSEWHERE, commandSegments, executedText, locatedSegments } from './shell.ts'
import { STACKS } from './stacks.ts'
import type { StackName } from './stacks.ts'

/**
 * A runner is how a stack's tests get run and read: the files that say it is
 * installed, the program that runs it, the command line for one test file,
 * the shape of a shell command that runs it, and the reader for its summary.
 * Every reader is written from real output and says so in `tests/fixtures`;
 * a reader marked provisional was written from documented formats and is
 * replaced the first time a real run is on record.
 */

export type RunnerKind = 'vitest' | 'jest' | 'ava' | 'node-test' | 'pytest' | 'unittest' | 'gdunit4' | 'maven' | 'gradle' | 'dotnet' | 'plugin-kit'

/** `launcher` replaces the program when the project names one through its lockfile (`uv run python`). */
export type RunnerOptions = { godot?: string | null; launcher?: readonly string[] }

/** A lockfile that names how this project runs its tools: `uv.lock` means `uv run python`. */
export type Launcher = { marker: string; argv: readonly string[] }

export type Runner = {
  kind: RunnerKind
  stack: StackName
  /** Stacks whose projects this runner may serve besides its own: dotnet runs the C# tests of a Godot .NET project. */
  alsoFor: readonly StackName[]
  /** Test file extensions it runs, without the dot. */
  exts: readonly string[]
  /** Files under a directory that say the runner lives there; checked walking up from the project root. */
  markers: readonly string[]
  /** Text a marker must hold to count, when its presence alone says nothing: every Node project has a package.json. */
  markerText?: RegExp
  /** Files that say the runner lives there only when they list it, such as a requirements file naming pytest. */
  listedIn?: { readonly files: readonly string[]; readonly text: RegExp }
  /** The test file itself says it is written for this runner, when nothing at the root does (2026-10-19). */
  testFileSays?: (text: string) => boolean
  /** Programs to run it with, relative to the runner root, first found wins; otherwise `fallback` on PATH. */
  tools: readonly string[]
  fallback: string
  /** The fallback outside Windows, when it differs: stock macOS has `python3` and no `python`. */
  fallbackPosix?: string
  /** Lockfiles that name a launcher, tried when none of `tools` is found: the environment lives outside the repo. */
  launchers?: readonly Launcher[]
  /** A shell command that runs this runner, anchored at a command start. */
  command: RegExp
  /** `tool` is an absolute path when one of `tools` was found, else `fallback`. `testPath` is relative to the project root. */
  argv: (runnerRoot: string, testPath: string, tool: string, options: RunnerOptions) => string[]
  read: (output: string) => RunOutcome
  failedFiles: (output: string) => string[]
  /** The command a person types to run one test file, for a receipt a reviewer can re-run; `launcher` as in argv. */
  describe: (testPath: string, launcher?: readonly string[]) => string
  /** The launcher a marker's text names, when the runner is found through it: Node's own flags in a test script. */
  launcherFrom?: (markerText: string) => readonly string[] | undefined
  /**
   * A launcher argument that lets this runner load .tsx and .jsx files. Node strips TypeScript types on its own but
   * cannot load JSX, so without such a loader node --test is not the runner for those files (2026-10-18).
   */
  jsxLoader?: RegExp
  provisional: boolean
}

const START = String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*`
const PATHED = String.raw`(?:[\w./\\-]*[\\/])?`
const NODE_BINARY = String.raw`(?:(?:npx|bunx|pnpm(?:\s+(?:exec|dlx))?|yarn(?:\s+exec)?)\s+)?(?:[\w./-]*\/)?(?:vitest|jest|ava)(?=\s|$)|node\s+${PATHED}ava[\\/]entrypoints[\\/]cli\.m?js(?=\s|$)`
// Flags before the script (`--filter api`, `-F @acme/api`, `-r`, `--recursive`) and `yarn workspace <name>`.
const PM_FLAGS = String.raw`(?:\s+(?:--?[\w-]+(?:=\S+)?(?:\s+(?!(?:run|test)\b)[^\s;&|-]\S*)?|workspace\s+\S+))*`
const NODE_SCRIPT = String.raw`(?:npm|pnpm|yarn|bun)${PM_FLAGS}\s+(?:run\s+)?test(?::[\w-]+)?(?=\s|$)`
// Monorepo task runners asked for the test task.
const WORKSPACE_RUN = String.raw`(?:(?:npx|pnpm(?:\s+exec)?|yarn)\s+)?(?:turbo(?:\s+run)?\s+test(?::[\w-]+)?(?=\s|$)|nx\s+(?:test(?=\s|$)|run\s+[\w@/.-]+:test(?::[\w-]+)?(?=\s|$)|run-many\s+[^;&|\n]*?(?:-t|--targets?)[=\s]+test(?=[\s,]|$))|lerna\s+run\s+test(?=\s|$))`
// A Python launcher, with its own flags before the program: `uv run --group test python -m pytest`, `poetry run -q pytest`.
const PY_LAUNCHER = String.raw`(?:(?:uv|poetry|pdm|pipenv|hatch)\s+run(?:\s+-[^\s;&|]+(?:\s+(?!-|python|py\b|pytest)[^\s;&|]+)?)*\s+)?`
// Python's own runner (2026-10-19): `python -m unittest`, with no program of its own to call directly.
const UNITTEST = String.raw`${PY_LAUNCHER}${PATHED}(?:python3?|py)(?:\.exe)?(?:\s+-\S+)*\s+-m\s+unittest(?=\s|$)`
const PYTEST = String.raw`${PY_LAUNCHER}(?:${PATHED}(?:python3?|py)(?:\.exe)?(?:\s+-\S+)*\s+-m\s+pytest|${PATHED}pytest(?:\.exe)?)(?=\s|$)`
const GDUNIT = String.raw`${PATHED}runtest(?:\.cmd|\.sh)?(?=\s|$)|${PATHED}[Gg]odot[\w.-]*\s+[^;&|\n]*?GdUnitCmdTool\.gd`
const JAVA = String.raw`${PATHED}(?:mvnw?(?:\.cmd)?|gradlew?(?:\.bat)?)\s+[^;&|\n]*?\btest\b`
const DOTNET = String.raw`dotnet\s+test(?=\s|$)`
// Node's built-in runner: `node --test`, with any flags before or after it (`--test-reporter=spec` is not `--test`).
const NODE_TEST = String.raw`node(?:\.exe)?\s+(?:[^;&|\n]*?\s)?--test(?=\s|$)`

function commandOf(body: string): RegExp {
  return new RegExp(`${START}(?:${body})`)
}

const NODE_COMMAND = commandOf(`${NODE_BINARY}|${NODE_TEST}|${NODE_SCRIPT}|${WORKSPACE_RUN}`)

// turbo prefixes each line `api:test: `, pnpm -r `server test: `; the task starts with a letter, so `src/a.ts:12:` is no prefix.
const TASK_PREFIX = /^(?:[@\w./-]+:[A-Za-z][\w-]*(?::[\w-]+)*:|[@\w./-]+ test(?::[\w-]+)?:)[ \t]?/gm

const TARGETS = [
  /(?:^|\s)(?:-w|--workspace)(?:=|\s+)(\S+)/,
  /(?:^|\s)(?:--filter|-F)(?:=|\s+)(\S+)/,
  /\byarn\s+workspace\s+(\S+)/,
  /\bnx\s+test\s+([^\s-]\S*)/,
  /\bnx\s+run\s+([\w@/.-]+):test\b/,
]

/**
 * The package a workspace test run is aimed at (`npm test -w server`, `pnpm --filter @acme/api test`), as written:
 * a folder or a package name. pnpm's `...` graph markers and quotes are dropped. Null for a run aimed at no one package.
 */
export function workspaceTarget(command: string): string | null {
  for (const segment of commandSegments(command).map(executedText)) {
    if (!runsTests(segment)) {
      continue
    }
    for (const pattern of TARGETS) {
      const found = pattern.exec(segment)?.[1]
      if (found !== undefined) {
        return found.replace(/^['"]|['"]$/g, '').replace(/^\.\.\.|\.\.\.$/g, '')
      }
    }
    return null
  }
  return null
}

/** The output with each line's workspace prefix taken off, so the runner's own lines read as they would alone. */
export function withoutTaskPrefixes(output: string): string {
  return output.replace(TASK_PREFIX, '')
}

function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)]
}

// --- ava: tests/fixtures/runnerOutputs.ts holds the real output these were written from (ava 8, Windows).
const AVA_FAILED = /^\s*\d+\s+(?:tests? failed|uncaught exceptions?|unhandled rejections?)\b/m
const AVA_PASSED = /^\s*\d+\s+tests? passed\b/m
const AVA_NONE = /Couldn't find any files to test/
// In a failure's detail block, the file and line on a line of their own: `source\utils\a.spec.ts:3`.
const AVA_FAILED_FILE = /^\s*((?:[A-Za-z]:)?[\w./\\-]+\.(?:spec|test)\.[cm]?[jt]sx?):\d+\s*$/gm

function readAva(output: string): RunOutcome {
  const text = stripAnsi(output)
  if (AVA_NONE.test(text)) {
    return 'none'
  }
  if (AVA_FAILED.test(text)) {
    return 'fail'
  }
  return AVA_PASSED.test(text) ? 'pass' : 'unknown'
}

function avaFailedFiles(output: string): string[] {
  return unique([...stripAnsi(output).matchAll(AVA_FAILED_FILE)].flatMap(match => (match[1] === undefined ? [] : [forwardSlashes(match[1])])))
}

// --- node --test: tests/fixtures/runnerOutputs.ts holds the real output these were written from (Node 24, Windows).
// The spec and TAP reporters end with the same counts, `ℹ tests 2` or `# tests 2`; the prefix is left loose, because a
// console on another code page prints the ℹ as something else. A failure names its file as `test at test\x.test.js:6:3`
// (spec) or `location: 'C:\\work\\x.test.js:6:3'` (TAP, backslashes doubled).
const NODE_TEST_SUMMARY = /^.{0,4}tests (\d+)\r?\n.{0,4}suites \d+\r?\n.{0,4}pass (\d+)\r?\n.{0,4}fail (\d+)\r?\n.{0,4}cancelled (\d+)\r?\n/m
const NODE_TEST_NOT_FOUND = /^Could not find '[^'\n]+'\s*$/m
// A summary a filter thinned (`| grep -E "ℹ (tests|pass|fail)"`): each count on a line of its own, nothing after it.
const NODE_TEST_COUNT = (word: string): RegExp => new RegExp(String.raw`^.{0,4}${word} (\d+)\s*$`, 'm')
// Node's runner failing to read a test file's child process (Node 24, a test that prints non-ASCII text): it reports
// the file as one failed test. The stack line is Node's own, so a test printing the message does not look like it.
const NODE_RUNNER_CRASH = /Unable to deserialize cloned data[^\n]*\r?\n\s+at #processRawBuffer \(node:internal\/test_runner\//
const NODE_TEST_FAILED_FILE = /^(?:test at |\s*location: ')((?:[A-Za-z]:)?[^'\n]+?\.(?:test|spec)\.[cm]?[jt]sx?):\d+:\d+/gm

// Node's own flags a test script may need to load its tests (`node --import tsx --test`), wherever they stand in the
// script. Only these are carried into a check's command: the runner's own flags (`--test-name-pattern`, reporters) and
// the files to run would change what the check runs, so they never are.
const NODE_VALUE_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--conditions', '-C', '--env-file', '--env-file-if-exists'])
const NODE_FLAG_WITH_VALUE = /^(?:--import|--require|--loader|--experimental-loader|--conditions|--env-file|--env-file-if-exists)=/
const NODE_SWITCH = /^--(?:no-)?experimental-[\w-]+(?:=\S+)?$|^--(?:no-warnings|no-deprecation|enable-source-maps)$/
const NODE_TEST_SCRIPT = /^test(?::[\w-]+)?$/
const NODE_TEST_INVOCATION = /\bnode(?:\.exe)?\s((?:[^&|;]*?\s)?--test(?=\s|$)[^&|;]*)/

/**
 * The launcher a package's node --test script implies: `node` and the loader flags it passes, so a check runs one test
 * file the way the script runs them all. Undefined when the script passes none, or no script runs node --test.
 */
export function nodeTestLauncher(packageJsonText: string): string[] | undefined {
  let scripts: unknown
  try {
    scripts = (JSON.parse(packageJsonText) as { scripts?: unknown }).scripts
  } catch {
    return undefined
  }
  if (typeof scripts !== 'object' || scripts === null) {
    return undefined
  }
  for (const [name, script] of Object.entries(scripts)) {
    const invocation = typeof script === 'string' && NODE_TEST_SCRIPT.test(name) ? NODE_TEST_INVOCATION.exec(script)?.[1] : undefined
    if (invocation === undefined) {
      continue
    }
    const tokens = [...invocation.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map(match => match[0].replace(/^(["'])(.*)\1$/, '$2'))
    const flags: string[] = []
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] ?? ''
      const value = tokens[i + 1]
      if (NODE_VALUE_FLAGS.has(token) && value !== undefined) {
        flags.push(token, value)
        i += 1
      } else if (NODE_FLAG_WITH_VALUE.test(token) || NODE_SWITCH.test(token)) {
        flags.push(token)
      }
    }
    return flags.length === 0 ? undefined : ['node', ...flags]
  }
  return undefined
}

/** True when node --test could not read a test file's output: its red is the runner's, not the test's. */
export function nodeRunnerCrashed(output: string): boolean {
  return NODE_RUNNER_CRASH.test(stripAnsi(output))
}

function readNodeTest(output: string): RunOutcome {
  const text = stripAnsi(output)
  if (NODE_RUNNER_CRASH.test(text)) {
    return 'unknown'
  }
  const summary = NODE_TEST_SUMMARY.exec(text)
  if (summary === null) {
    return NODE_TEST_NOT_FOUND.test(text) ? 'none' : readThinnedNodeTest(text)
  }
  if (Number(summary[3]) > 0 || Number(summary[4]) > 0) {
    return 'fail'
  }
  // Only skips and todos: nothing ran that could have failed.
  return Number(summary[2]) > 0 ? 'pass' : 'none'
}

/**
 * The counts a filter kept. A red needs tests and fail; a green needs every test to have passed, because what the
 * filter dropped (cancelled, skipped, todo) could hide behind a pass count short of the total.
 */
function readThinnedNodeTest(text: string): RunOutcome {
  const count = (word: string): number | undefined => {
    const found = NODE_TEST_COUNT(word).exec(text)?.[1]
    return found === undefined ? undefined : Number(found)
  }
  const tests = count('tests')
  const fail = count('fail')
  if (tests === undefined || fail === undefined) {
    return 'unknown'
  }
  if (fail > 0 || (count('cancelled') ?? 0) > 0) {
    return 'fail'
  }
  // No pass line is never green: undefined equals no total.
  const pass = count('pass')
  if (tests === 0 && pass === 0) {
    return 'none'
  }
  return pass === tests ? 'pass' : 'unknown'
}

/** A segment of the command runs Node's built-in runner directly. */
export function isNodeTestRun(command: string): boolean {
  const direct = commandOf(NODE_TEST)
  return commandSegments(command).some(segment => direct.test(withoutInlineCode(executedText(segment))))
}

function nodeTestFailedFiles(output: string): string[] {
  return unique([...stripAnsi(output).matchAll(NODE_TEST_FAILED_FILE)].flatMap(match => (match[1] === undefined ? [] : [forwardSlashes(match[1].replace(/\\\\/g, '\\'))])))
}

// --- pytest: tests/fixtures/runnerOutputs.ts holds the real output these were written from.
const PYTEST_SUMMARY = /^=*\s*((?:\d+ (?:passed|failed|errors?|skipped|xfailed|xpassed|warnings?|deselected|rerun)(?:, )?)+)\s+in\s+[\d.]+s(?:\s*\([^)]*\))?\s*=*\s*$/m
const PYTEST_NONE = /^=*\s*no tests ran in [\d.]+s\s*=*\s*$/m
const PYTEST_FAILED_FILE = /^(?:FAILED|ERROR)\s+((?:[A-Za-z]:)?[\w./\\-]+\.py)(?=::|\s|$)/gm

function readPytest(output: string): RunOutcome {
  const text = stripAnsi(output)
  if (PYTEST_NONE.test(text)) {
    return 'none'
  }
  const counts = PYTEST_SUMMARY.exec(text)?.[1]
  if (counts === undefined) {
    return 'unknown'
  }
  const failed = Number(/(\d+) failed/.exec(counts)?.[1] ?? 0)
  const errors = Number(/(\d+) errors?/.exec(counts)?.[1] ?? 0)
  if (failed > 0 || errors > 0) {
    return 'fail'
  }
  if (/\d+ passed/.test(counts)) {
    return 'pass'
  }
  // Only skipped, xfailed or deselected: nothing ran that could have failed.
  return 'none'
}

function pytestFailedFiles(output: string): string[] {
  return unique([...stripAnsi(output).matchAll(PYTEST_FAILED_FILE)].flatMap(match => (match[1] === undefined ? [] : [forwardSlashes(match[1])])))
}

// --- unittest: tests/fixtures/runnerOutputs.ts holds the real output these were written from. Its report goes to stderr:
// `Ran N tests in Xs`, a blank line, then `OK` or `FAILED (failures=1, errors=1)`, each with an optional `(skipped=1)`.
const UNITTEST_RAN = /^Ran (\d+) tests? in [\d.]+s\s*$/m
const UNITTEST_RESULT = /^Ran \d+ tests? in [\d.]+s\s*\r?\n\s*\r?\n(OK|FAILED|NO TESTS RAN)\b(?:\s*\(([^)]*)\))?/m
// Each failure's header, and the traceback under it up to the next header or the closing rule.
const UNITTEST_BLOCK = /^(?:FAIL|ERROR): [^\n]*\r?\n-{20,}\r?\n([\s\S]*?)(?=^={20,}\r?$|^-{20,}\r?$)/gm
const UNITTEST_FRAME = /^\s*File "([^"]+\.py)", line \d+/gm

function readUnittest(output: string): RunOutcome {
  const text = stripAnsi(output)
  const result = UNITTEST_RESULT.exec(text)
  if (result === null) {
    return 'unknown'
  }
  if (result[1] === 'FAILED') {
    return 'fail'
  }
  if (result[1] === 'NO TESTS RAN') {
    return 'none'
  }
  const ran = Number(UNITTEST_RAN.exec(text)?.[1] ?? 0)
  const skipped = Number(/\bskipped=(\d+)/.exec(result[2] ?? '')?.[1] ?? 0)
  // Only skips: nothing ran that could have failed.
  return ran > skipped ? 'pass' : 'none'
}

/** The test file of each failure: the traceback's first frame in a test file, so the loader's own frame is passed over. */
function unittestFailedFiles(output: string): string[] {
  const rule = STACKS.python.testFile
  return unique(
    [...stripAnsi(output).matchAll(UNITTEST_BLOCK)].flatMap(block => {
      const frame = [...(block[1] ?? '').matchAll(UNITTEST_FRAME)].map(match => forwardSlashes(match[1] ?? '')).find(path => rule.test(path))
      return frame === undefined ? [] : [frame]
    }),
  )
}

// --- gdUnit4: the console reporter's format strings (GdUnitConsoleTestReporter.gd); provisional until a real run is on record.
const GDUNIT_SUMMARY = /Overall Summary:\s*(\d+) test cases \| (\d+) errors \| (\d+) failures \| (\d+) flaky \| (\d+) skipped \| (\d+) orphans/
const GDUNIT_EXECUTED = /Executed test cases\s*:\s*\((\d+)\/(\d+)\)/
const GDUNIT_SUITE = /Run Test Suite:\s*(res:\/\/\S+|\S+\.gd)/
const GDUNIT_FAILED = /(?:^|\s)FAILED(?:\s|$|\s\(retry)/

function readGdUnit(output: string): RunOutcome {
  const text = stripAnsi(output)
  const summary = GDUNIT_SUMMARY.exec(text)
  if (summary === null) {
    const executed = GDUNIT_EXECUTED.exec(text)
    return executed !== null && executed[2] === '0' ? 'none' : 'unknown'
  }
  const cases = Number(summary[1])
  const errors = Number(summary[2])
  const failures = Number(summary[3])
  if (errors > 0 || failures > 0) {
    return 'fail'
  }
  return cases === 0 ? 'none' : 'pass'
}

function gdUnitFailedFiles(output: string): string[] {
  const failed: string[] = []
  let current: string | null = null
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const suite = GDUNIT_SUITE.exec(line)
    if (suite !== null) {
      current = (suite[1] ?? '').replace(/^res:\/\//, '')
      continue
    }
    if (current !== null && GDUNIT_FAILED.test(line)) {
      failed.push(current)
    }
  }
  return unique(failed)
}

// --- Maven Surefire; provisional until a real run is on record.
const MAVEN_TOTAL = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)(?!.*Time elapsed)/g
const MAVEN_NO_TESTS = /No tests to run\./
const MAVEN_BUILD = /BUILD (SUCCESS|FAILURE)/

function readMaven(output: string): RunOutcome {
  const text = stripAnsi(output)
  const totals = [...text.matchAll(MAVEN_TOTAL)]
  const last = totals[totals.length - 1]
  if (last !== undefined) {
    const run = Number(last[1])
    const broken = Number(last[2]) + Number(last[3])
    return broken > 0 ? 'fail' : run === 0 ? 'none' : 'pass'
  }
  if (MAVEN_NO_TESTS.test(text)) {
    return 'none'
  }
  // A build that failed before any test ran (a compile error) is no verdict.
  return 'unknown'
}

// --- Gradle; provisional until a real run is on record. With --console=plain a passing run prints the task line and BUILD SUCCESSFUL.
const GRADLE_COUNTS = /(\d+) tests completed, (\d+) failed/
const GRADLE_TEST_TASK = /^> Task :(?:[\w-]+:)*test(?:\s|$)/m
const GRADLE_NO_SOURCE = /^> Task :(?:[\w-]+:)*test NO-SOURCE/m
const GRADLE_SUCCESS = /BUILD SUCCESSFUL/

function readGradle(output: string): RunOutcome {
  const text = stripAnsi(output)
  const counts = GRADLE_COUNTS.exec(text)
  if (counts !== null) {
    return Number(counts[2]) > 0 ? 'fail' : 'pass'
  }
  if (GRADLE_NO_SOURCE.test(text)) {
    return 'none'
  }
  if (GRADLE_SUCCESS.test(text) && GRADLE_TEST_TASK.test(text)) {
    return 'pass'
  }
  return 'unknown'
}

// --- dotnet test, read from real output (Roadhouse, .NET SDK 8.0.425, gdUnit4 C# adapter 3.0.0, 2026-10-09): VSTest prints
// "Passed!/Failed!  - Failed: n, Passed: n, Skipped: n, Total: n, Duration: ..."; a filter that matches nothing prints
// "No test matches the given testcase filter `...`" and exits 0, which is no run, never a pass. The newer testing platform's
// "Test summary: total: n, failed: n, succeeded: n, skipped: n" is still provisional.
const DOTNET_VSTEST = /(?:Passed|Failed)!\s+-\s+Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/
const DOTNET_MTP = /Test summary:\s*total:\s*(\d+),\s*failed:\s*(\d+),\s*succeeded:\s*(\d+),\s*skipped:\s*(\d+)/
const DOTNET_NO_TESTS = /No test is available|No test matches the given testcase filter/
// A failed test's stack trace names the file and line: `at Ns.Class.Method() in C:\path\FooTest.cs:line 15`.
const DOTNET_TRACE_FILE = /\bin\s+((?:[A-Za-z]:)?[^\n]*?\.cs):line\s+\d+/g

function readDotnet(output: string): RunOutcome {
  const text = stripAnsi(output)
  const vstest = DOTNET_VSTEST.exec(text)
  if (vstest !== null) {
    const failed = Number(vstest[1])
    const total = Number(vstest[4])
    return failed > 0 ? 'fail' : total === 0 ? 'none' : 'pass'
  }
  const mtp = DOTNET_MTP.exec(text)
  if (mtp !== null) {
    const total = Number(mtp[1])
    const failed = Number(mtp[2])
    return failed > 0 ? 'fail' : total === 0 ? 'none' : 'pass'
  }
  return DOTNET_NO_TESTS.test(text) ? 'none' : 'unknown'
}

function dotnetFailedFiles(output: string): string[] {
  const paths = [...stripAnsi(output).matchAll(DOTNET_TRACE_FILE)].flatMap(match => (match[1] === undefined ? [] : [forwardSlashes(match[1])]))
  return unique(paths.filter(path => STACKS.dotnet.testFile.test(path)))
}

/** `src/test/java/com/x/FooTest.java` → `com.x.FooTest`; a path outside that layout keeps its stem. */
function javaClassName(testPath: string): string {
  const slashed = forwardSlashes(testPath).replace(/\.java$/, '')
  const at = slashed.indexOf('/java/')
  return (at === -1 ? slashed : slashed.slice(at + '/java/'.length)).replace(/\//g, '.')
}

function stem(testPath: string): string {
  const slashed = forwardSlashes(testPath)
  const name = slashed.slice(slashed.lastIndexOf('/') + 1)
  return name.replace(/\.[^.]+$/, '')
}

function noFailedFiles(): string[] {
  return []
}

// `claude plugin test` (2026-10-18): a Claude Code plugin's own test kit. It runs a whole folder, prints a header per
// file (`tests\band.test.tsx:`), a (pass) or (fail) line per test, then ` 741 pass`, ` 3 fail`, `Ran 744 tests …`.
const PLUGIN_KIT_SUMMARY = /^\s*(\d+) pass\r?\n\s*(\d+) fail\r?\nRan (\d+) tests? across \d+ files?\./m
const PLUGIN_KIT_FILE = /^(\S[^\n]*?\.(?:test|spec)\.[cm]?[jt]sx?):\s*$/
const PLUGIN_KIT_COMMAND = commandOf(String.raw`${PATHED}claude(?:\.exe)?\s+plugin\s+test(?=\s|$)`)

function readPluginKit(output: string): RunOutcome {
  const summary = PLUGIN_KIT_SUMMARY.exec(stripAnsi(output))
  if (summary === null) {
    return 'unknown'
  }
  return Number(summary[2]) > 0 ? 'fail' : Number(summary[3]) > 0 ? 'pass' : 'none'
}

/** The file header above each (fail) line, a file that did not load among them. */
function pluginKitFailedFiles(output: string): string[] {
  const text = stripAnsi(output)
  if (!PLUGIN_KIT_SUMMARY.test(text)) {
    return []
  }
  const failed: string[] = []
  let file: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const header = PLUGIN_KIT_FILE.exec(line)
    if (header !== null) {
      file = forwardSlashes(header[1] ?? '')
    } else if (line.startsWith('(fail) ') && file !== null) {
      failed.push(file)
    }
  }
  return unique(failed)
}

export const RUNNERS: readonly Runner[] = [
  {
    kind: 'vitest',
    describe: testPath => `npx vitest run ${testPath}`,
    alsoFor: [],
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    stack: 'node',
    markers: ['node_modules/vitest/vitest.mjs'],
    tools: ['node_modules/vitest/vitest.mjs'],
    fallback: 'node_modules/vitest/vitest.mjs',
    command: NODE_COMMAND,
    argv: (_root, testPath, tool) => ['node', tool, 'run', testPath],
    read: readNode,
    failedFiles: nodeFailedFiles,
    provisional: false,
  },
  {
    kind: 'jest',
    describe: testPath => `npx jest ${testPath}`,
    alsoFor: [],
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    stack: 'node',
    markers: ['node_modules/jest/bin/jest.js'],
    tools: ['node_modules/jest/bin/jest.js'],
    fallback: 'node_modules/jest/bin/jest.js',
    command: NODE_COMMAND,
    argv: (_root, testPath, tool) => ['node', tool, testPath],
    read: readNode,
    failedFiles: nodeFailedFiles,
    provisional: false,
  },
  {
    kind: 'ava',
    describe: testPath => `npx ava ${testPath}`,
    alsoFor: [],
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    stack: 'node',
    markers: ['node_modules/ava/entrypoints/cli.js', 'node_modules/ava/entrypoints/cli.mjs'],
    tools: ['node_modules/ava/entrypoints/cli.js', 'node_modules/ava/entrypoints/cli.mjs'],
    fallback: 'node_modules/ava/entrypoints/cli.js',
    command: NODE_COMMAND,
    argv: (_root, testPath, tool) => ['node', tool, testPath],
    read: readAva,
    failedFiles: avaFailedFiles,
    provisional: false,
  },
  {
    kind: 'node-test',
    describe: (testPath, launcher) => `${(launcher ?? ['node']).join(' ')} --test ${testPath}`,
    alsoFor: [],
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    stack: 'node',
    // Nothing to install: a package test script that says `node --test` is the sign. Last of the Node runners, so an installed one wins.
    markers: ['package.json'],
    markerText: /"test(?::[\w-]+)?"\s*:\s*"(?:[^"\\]|\\.)*?\bnode(?:\.exe)?\s(?:[^"\\]|\\.)*?--test(?=[\s"\\])/,
    tools: [],
    fallback: 'node',
    command: NODE_COMMAND,
    argv: (_root, testPath, tool, options) => [...(options.launcher ?? [tool]), '--test', testPath],
    launcherFrom: nodeTestLauncher,
    jsxLoader: /(?:^|[=/\s])(?:tsx|@swc-node\/register|esbuild-register|ts-node(?:\/esm)?)(?:$|[/\s])/,
    read: readNodeTest,
    failedFiles: nodeTestFailedFiles,
    provisional: false,
  },
  {
    kind: 'pytest',
    describe: testPath => `python -m pytest ${testPath}`,
    alsoFor: [],
    exts: ['py'],
    stack: 'python',
    // pytest's own files say pytest by being there.
    markers: ['pytest.ini', 'conftest.py', 'tests/conftest.py'],
    // Karl's round 3 (2026-10-19): requirements.txt was the only marker, so the catch check ran unittest on a pytest
    // file, found 0 tests, and every green went unchecked. A requirements file or Pipfile that lists pytest says pytest.
    // A general Python config file says it only when it mentions pytest: any pyproject.toml once meant pytest, and a
    // unittest-only project then got a check that could not start (verified review D5, 2026-10-20).
    listedIn: {
      files: ['pyproject.toml', 'setup.cfg', 'tox.ini', 'setup.py', 'requirements.txt', 'requirements-dev.txt', 'requirements-test.txt', 'requirements/dev.txt', 'requirements/test.txt', 'Pipfile'],
      text: /^\s*["']?pytest\b|\[tool\.pytest|\[tool:pytest\]|\[pytest\]|["']pytest\b/m,
    },
    // With no marker at all: a test that imports pytest, or plain test functions with no unittest, is a pytest test.
    testFileSays: text => /^\s*(?:import|from)\s+pytest\b/m.test(text) || (/^def test_/m.test(text) && !/\bunittest\b/.test(text)),
    tools: ['.venv/Scripts/python.exe', '.venv/bin/python', 'venv/Scripts/python.exe', 'venv/bin/python'],
    fallback: 'python',
    fallbackPosix: 'python3',
    launchers: [
      { marker: 'uv.lock', argv: ['uv', 'run', 'python'] },
      { marker: 'poetry.lock', argv: ['poetry', 'run', 'python'] },
      { marker: 'pdm.lock', argv: ['pdm', 'run', 'python'] },
      { marker: 'Pipfile.lock', argv: ['pipenv', 'run', 'python'] },
    ],
    command: commandOf(PYTEST),
    argv: (_root, testPath, tool, options) => [...(options.launcher ?? [tool]), '-m', 'pytest', '-q', '-p', 'no:cacheprovider', testPath],
    read: readPytest,
    failedFiles: pytestFailedFiles,
    provisional: false,
  },
  {
    // After pytest: a project that shows pytest's markers gets pytest, which runs unittest tests too; one with none of
    // them runs Python's own unittest, which every Python has.
    kind: 'unittest',
    describe: testPath => `python -m unittest ${testPath}`,
    alsoFor: [],
    exts: ['py'],
    stack: 'python',
    markers: [],
    tools: ['.venv/Scripts/python.exe', '.venv/bin/python', 'venv/Scripts/python.exe', 'venv/bin/python'],
    fallback: 'python',
    fallbackPosix: 'python3',
    command: commandOf(UNITTEST),
    argv: (_root, testPath, tool, options) => [...(options.launcher ?? [tool]), '-m', 'unittest', testPath],
    read: readUnittest,
    failedFiles: unittestFailedFiles,
    provisional: false,
  },
  {
    kind: 'gdunit4',
    describe: testPath => `addons/gdUnit4/runtest.sh -a res://${forwardSlashes(testPath)}` + '  (runtest.cmd on Windows)',
    alsoFor: [],
    exts: ['gd'],
    stack: 'godot',
    markers: ['addons/gdUnit4/bin/GdUnitCmdTool.gd'],
    tools: [],
    fallback: 'godot',
    command: commandOf(GDUNIT),
    // The wrapper's own invocation, headless, with the debugger kept off so a parse error cannot hang the run.
    argv: (root, testPath, tool, options) => [
      options.godot ?? tool,
      '--headless',
      '--path',
      root,
      '-s',
      '-d',
      '--remote-debug',
      'tcp://127.0.0.1:0',
      'res://addons/gdUnit4/bin/GdUnitCmdTool.gd',
      '-a',
      `res://${forwardSlashes(testPath)}`,
      '--ignoreHeadlessMode',
    ],
    read: readGdUnit,
    failedFiles: gdUnitFailedFiles,
    provisional: true,
  },
  {
    kind: 'maven',
    describe: testPath => `mvn -Dtest=${javaClassName(testPath)} test`,
    alsoFor: [],
    exts: ['java'],
    stack: 'java',
    markers: ['pom.xml'],
    tools: ['mvnw.cmd', 'mvnw'],
    fallback: 'mvn',
    command: commandOf(JAVA),
    argv: (_root, testPath, tool) => [tool, '-B', '-ntp', `-Dtest=${javaClassName(testPath)}`, '-Dsurefire.failIfNoSpecifiedTests=false', 'test'],
    read: readMaven,
    failedFiles: noFailedFiles,
    provisional: true,
  },
  {
    kind: 'gradle',
    describe: testPath => `./gradlew test --tests ${javaClassName(testPath)}`,
    alsoFor: [],
    exts: ['java'],
    stack: 'java',
    markers: ['build.gradle', 'build.gradle.kts'],
    tools: ['gradlew.bat', 'gradlew'],
    fallback: 'gradle',
    command: commandOf(JAVA),
    argv: (_root, testPath, tool) => [tool, 'test', '--tests', javaClassName(testPath), '--console=plain'],
    read: readGradle,
    failedFiles: noFailedFiles,
    provisional: true,
  },
  {
    kind: 'dotnet',
    describe: testPath => `dotnet test --filter FullyQualifiedName~${stem(testPath)}`,
    stack: 'dotnet',
    alsoFor: ['godot'],
    exts: ['cs'],
    // No marker: `dotnet test` runs from the project root wherever the SDK is on PATH.
    markers: [],
    tools: [],
    fallback: 'dotnet',
    command: commandOf(DOTNET),
    argv: (_root, testPath, tool) => [tool, 'test', '--nologo', '--filter', `FullyQualifiedName~${stem(testPath)}`],
    read: readDotnet,
    failedFiles: dotnetFailedFiles,
    provisional: false,
  },
  {
    kind: 'plugin-kit',
    // It runs the whole folder, never one file: the command a reviewer types is the whole kit.
    describe: () => 'claude plugin test .',
    alsoFor: [],
    exts: ['ts', 'tsx'],
    stack: 'node',
    // Last of all: node --test wins where it can run the file, so the kit serves the .tsx files it cannot load.
    markers: ['.claude-plugin/plugin.json'],
    tools: [],
    fallback: 'claude',
    command: PLUGIN_KIT_COMMAND,
    argv: (_root, _testPath, tool) => [tool, 'plugin', 'test', '.'],
    read: readPluginKit,
    failedFiles: pluginKitFailedFiles,
    // A catch check would re-run the whole kit (about 30 seconds): opt in with "catchCheck": true.
    provisional: true,
  },
]

export function runnerNamed(kind: RunnerKind): Runner {
  const runner = RUNNERS.find(entry => entry.kind === kind)
  if (runner === undefined) {
    throw new Error(`no runner named ${kind}`)
  }
  return runner
}

/** The program on PATH when the project names none: a root with a drive letter is Windows, anything else is POSIX. */
export function fallbackTool(runner: Runner, root: string): string {
  return /^[A-Za-z]:/.test(root) ? runner.fallback : (runner.fallbackPosix ?? runner.fallback)
}

/** The runners that can run this stack's tests; with a test path, only those that run its extension. */
export function runnersFor(stack: StackName, testPath?: string): readonly Runner[] {
  const ext = testPath === undefined ? null : forwardSlashes(testPath).replace(/^.*\./, '')
  return RUNNERS.filter(runner => (runner.stack === stack || runner.alsoFor.includes(stack)) && (ext === null || runner.exts.includes(ext)))
}

/** A shell command that runs any known runner, or a package's test script. */
// What may sit beside a test run without writing anything: a cd, and the filters its output is piped through.
const HARMLESS = /^\s*(?:cd|echo|tail|head|grep|sort|uniq|wc|true)(?:\s|$)/

/** Only test runs, cds and output filters: nothing in it writes source, so a change seen while it ran came from elsewhere. */
export function isPureTestRun(command: string): boolean {
  const segments = commandSegments(command).map(executedText).filter(segment => segment.trim() !== '')
  const runs = (segment: string) => runsTests(segment)
  return segments.some(runs) && segments.every(segment => runs(segment) || HARMLESS.test(segment))
}

/** A run that always covers the whole folder (the plugin kit): its red belongs to whichever files it names, if any. */
export function runsWholeFolder(command: string): boolean {
  return commandSegments(command).some(segment => PLUGIN_KIT_COMMAND.test(executedText(segment)))
}

// The quoted code handed to an interpreter (`node -e "..."`, `python -c "..."`) is text to that interpreter: a runner
// named inside it does not run here (seen live, 2026-10-19: a probe quoting `node --test x` in node -e counted as a run).
const INLINE_CODE = /(\s(?:-e|--eval|-p|--print|-c)\s+)(['"])(?:\\[\s\S]|(?!\2)[\s\S])*\2/g

function withoutInlineCode(segment: string): string {
  return segment.replace(INLINE_CODE, "$1''")
}

// A runner asked its version, its help or its test list runs nothing: `python -m pytest --version` counted as a run
// with no summary to read, and stayed unread in the counts (Karl's Python trial, 2026-10-19). Short `-v`/`-V` are
// left out on purpose: pytest's -v is verbose, not a version.
const RUNS_NOTHING = /\s(?:--version|--help|-h|--collect-only|--co)(?=\s|$)/

const TEST_FILTER = /(?:^|\s)(?:-t|-k|-g|-m|--testNamePattern|--filter|--grep|--match)(?:[\s=]|$)/
// `python -m pytest`: that -m names the module Python runs, before any of the runner's own flags (Karl's round 3,
// 2026-10-19: read as pytest's marker filter, every python -m run counted as filtered).
const PYTHON_MODULE = /((?:^|[\s/\\])(?:python3?|py)(?:\.exe)?(?:\s+-[XW]\s+\S+|\s+-(?!m(?:\s|$))\S+)*)\s+-m\s+\S+/g

/** The run is filtered to some tests by name, marker or pattern, so it ran only part of the file. */
export function filtersTests(command: string): boolean {
  return TEST_FILTER.test(command.replace(PYTHON_MODULE, '$1'))
}

/** A segment that runs a known runner, with any inline code it hands an interpreter left out. */
function runsTests(segment: string): boolean {
  const text = withoutInlineCode(segment)
  return !RUNS_NOTHING.test(text) && RUNNERS.some(runner => runner.command.test(text))
}

export function isTestRun(command: string): boolean {
  return commandSegments(command).some(segment => runsTests(executedText(segment)))
}

/** The first reader that recognises the output decides; readers that see nothing of theirs say unknown and pass. */
export function readRun(output: string): RunOutcome {
  for (const runner of RUNNERS) {
    const outcome = runner.read(withoutTaskPrefixes(output))
    if (outcome !== 'unknown') {
      return outcome
    }
  }
  return 'unknown'
}

// The name of each failed test, by the shape each runner prints it in (tests/fixtures/runnerOutputs.ts has them).
const FAILED_TEST_NAMES: readonly RegExp[] = [
  // ava: `✘ [fail]: name`, sometimes followed by the reason it appends
  /^\s*✘ \[fail\]: (.+?)(?:\s+(?:Error thrown in test|Assertion failed|Rejected promise returned by test|Test timed out|Difference \(.*))?\s*$/gm,
  // pytest: `FAILED file::test - message` and `ERROR file::test`
  /^(?:FAILED|ERROR)\s+(\S+::\S+)/gm,
  // vitest: ` FAIL  file > describe > name`
  /^\s*FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?\s+>\s+.+?)\s*$/gm,
  // jest: `● describe › name` (not "Test suite failed to run")
  /^\s*●\s+(?!Test suite failed to run)(.+?)\s*$/gm,
  // gdUnit4: `suite > test   FAILED`
  /^\s*(\S+\s+>\s+\S+)\s+FAILED\b/gm,
  // node --test spec: the `failing tests:` block repeats each failed test, not its suite, under its location
  /^test at [^\n]+\r?\n✖ (.+?) \([\d.]+m?s\)\s*$/gm,
  // node --test TAP: `not ok 2 - name`, unless its YAML says it is a suite that failed through its subtests
  /^\s*not ok \d+ - (.+?)\r?\n\s*---\r?\n(?:\s*(?!failureType:)\w+:[^\n]*\r?\n)*?\s*failureType: '(?!subtestsFailed)/gm,
  // dotnet: VSTest `Failed Name [3 ms]`, Microsoft.Testing.Platform `failed Name (3ms)`
  /^\s*[Ff]ailed\s+([\w.<>`,+-]+)\s+[[(]\d/gm,
]

// How many tests the summary says failed: ava, vitest and jest, pytest, dotnet, node --test.
const FAILED_COUNTS: readonly RegExp[] = [
  /^\s*(\d+)\s+tests? failed\b/m,
  /^\s*Tests:?\s+(\d+) failed\b/m,
  /^=*\s*(\d+) failed\b[^\n]*\bin\s+[\d.]+s\b/m,
  /\bFailed:\s+(\d+),/,
  /^.{0,4}pass \d+\r?\n.{0,4}fail (\d+)\r?\n/m,
  /^FAILED \([^)]*\bfailures=(\d+)/m,
  /^FAILED \([^)]*\berrors=(\d+)/m,
]

/** The failed count from the runner's summary, or null when it prints none: more than the names read means output was cut. */
export function failedCountIn(output: string): number | null {
  const text = withoutTaskPrefixes(stripAnsi(output))
  const counts = FAILED_COUNTS.flatMap(pattern => {
    const found = pattern.exec(text)?.[1]
    return found === undefined ? [] : [Number(found)]
  })
  return counts.length === 0 ? null : Math.max(...counts)
}

/** The names of the tests that failed, in the order printed, once each; empty for a pass or output it cannot read. */
export function failedTestsIn(output: string): string[] {
  const text = withoutTaskPrefixes(stripAnsi(output))
  return unique(FAILED_TEST_NAMES.flatMap(pattern => [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1].trim()]))))
}

// The shape of a red that never reached an assertion, by runner (tests/fixtures/runnerOutputs.ts has each):
const ERRORS_ONLY: readonly ((text: string) => boolean)[] = [
  // pytest: a file that would not collect, or a summary of errors with no failed test in it
  text => /\berrors? during collection\b/.test(text) || (/^=*\s*(?:\d+ \w+, )*\d+ errors? in [\d.]+s\b/m.test(text) && !/\b\d+ failed\b/.test(text)),
  // unittest: `FAILED (errors=1)` with no failures= count
  text => /^FAILED \((?![^)]*failures=)[^)]*errors=\d+/m.test(text),
  // node --test: every entry under `failing tests:` is a whole file, which is how a file that would not load fails
  text => {
    const block = text.split(/✖ failing tests:/)[1]
    const entries = block === undefined ? [] : [...block.matchAll(/^✖ (.+?) \([\d.]+m?s\)\s*$/gm)].map(match => match[1] ?? '')
    return entries.length > 0 && entries.every(name => /\.[cm]?[jt]sx?$/.test(name))
  },
  // Maven: the build stopped at compiling, before any test ran
  text => /\bCOMPILATION ERROR\b/.test(text) && !/\bTests run:/.test(text),
]

/**
 * A red where nothing failed on what a test checks: an import that broke, a file that would not collect, load or compile.
 * False for a pass, for any failed assertion, and for output it cannot read. A pin's first red proves the pin only
 * when a test failed on an assertion (2026-10-19, after Karl's trial: a flaky or broken environment proved pins too).
 */
export function failedOnlyOnErrors(output: string): boolean {
  const text = withoutTaskPrefixes(stripAnsi(output))
  return ERRORS_ONLY.some(shape => shape(text))
}

export function failedFilesIn(output: string): string[] {
  return unique(RUNNERS.flatMap(runner => runner.failedFiles(withoutTaskPrefixes(output))))
}

const TOKEN = /[\w./\\:*-]+/g

/** `tests.test_calc.CalcTest` → `tests/test_calc.py`: the path up to the first part named like a test file. */
function dottedTestFile(token: string): string | null {
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(token)) {
    return null
  }
  const parts = token.split('.')
  const at = parts.findIndex(part => /^test_\w*$|^\w+_test$/.test(part))
  return at === -1 ? null : `${parts.slice(0, at + 1).join('/')}.py`
}

function namedIn(text: string, stack: StackName): string | null {
  const rule = STACKS[stack].testFile
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0].replace(/^res:\/\//, '')
    // A glob (`"test/**/*.test.js"`) names no one file.
    if (token.includes('*')) {
      continue
    }
    if (rule.test(forwardSlashes(token))) {
      return token
    }
    // unittest names a module, not a file: `tests.test_calc`, or down to `tests.test_calc.CalcTest.test_add`.
    const dotted = stack === 'python' ? dottedTestFile(token) : null
    if (dotted !== null) {
      return dotted
    }
  }
  return null
}

/**
 * The test file a command names, by the stack's naming rule. Without a root,
 * as written (a `res://` prefix dropped). With a root, taken from the segment
 * that runs the tests and resolved against the directory that segment runs
 * in, so `cd server && npx vitest run src/x.test.ts` names `<root>/server/src/x.test.ts`.
 */
export function namedTestFile(command: string, stack: StackName, root?: string): string | null {
  if (root === undefined) {
    return namedIn(command, stack)
  }
  for (const { segment, cwd } of locatedSegments(command, root)) {
    if (!runsTests(segment)) {
      continue
    }
    const named = namedIn(segment, stack)
    if (named === null) {
      return null
    }
    const slashed = forwardSlashes(named)
    return /^(?:[A-Za-z]:)?\//.test(slashed) ? slashed : `${cwd}/${slashed}`
  }
  return null
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|gd|cs|java|kt|go|rb)$/i
// Options whose value is a file the runner loads, not a file it tests (`--import ./tests/node/register.mjs`).
const LOADS_A_FILE = /^(?:--import|--require|-r|--loader|--experimental-loader|--config|-c)$/

/**
 * Code files a test command names that are not tests by the stack's rule, absolute (2026-10-18). Seen live:
 * `node --test tools/pr-check/check.spec-node.ts` named no test by the rule, so it read as an unnamed suite run and
 * its red and green were credited to the current module. A run that names only such files is about them (runPlan.ts).
 */
export function namedOtherFiles(command: string, stack: StackName, root: string): string[] {
  const rule = STACKS[stack].testFile
  for (const { segment, cwd } of locatedSegments(command, root)) {
    if (!runsTests(segment)) {
      continue
    }
    const tokens = [...segment.matchAll(TOKEN)].map(match => match[0])
    return tokens.flatMap((token, index) => {
      const previous = tokens[index - 1] ?? ''
      const path = forwardSlashes(token)
      if (token.startsWith('-') || token.includes('*') || LOADS_A_FILE.test(previous) || !CODE_FILE.test(path) || rule.test(path)) {
        return []
      }
      return [/^(?:[A-Za-z]:)?\//.test(path) ? path : `${cwd}/${path.replace(/^\.\//, '')}`]
    })
  }
  return []
}

/** The directory the command's test run executes in, or null when no segment runs tests. ELSEWHERE when a `cd` went somewhere unseen. */
export function testRunLocation(command: string, root: string): string | null {
  for (const { segment, cwd } of locatedSegments(command, root)) {
    if (runsTests(executedText(segment))) {
      return cwd === ELSEWHERE ? ELSEWHERE : cwd
    }
  }
  return null
}
