import { describe, expect, test } from 'claude-code/testing'

import { catchOutcome, runnerArgv } from '../hooks/catchCheck'
import { failedCountIn, failedFilesIn, failedTestsIn, fallbackTool, isTestRun, namedOtherFiles, namedTestFile, nodeRunnerCrashed, nodeTestLauncher, readRun, runnerNamed, runsWholeFolder, testRunLocation, workspaceTarget } from '../hooks/runners'
import { ELSEWHERE } from '../hooks/shell'
import {
  AVA_REAL_FAIL,
  AVA_REAL_PREEXISTING,
  AVA_REAL_PASS,
  DOTNET_FAIL,
  DOTNET_MTP_FAIL,
  DOTNET_PASS,
  DOTNET_REAL_FAIL,
  DOTNET_REAL_NO_MATCH,
  DOTNET_REAL_PASS,
  GDUNIT_FAIL,
  GDUNIT_NONE,
  GDUNIT_PASS,
  GRADLE_FAIL,
  GRADLE_PASS,
  MAVEN_COMPILE_ERROR,
  MAVEN_FAIL,
  MAVEN_PASS,
  PLUGIN_KIT_FAIL,
  PLUGIN_KIT_PASS,
  NODE_TEST_REAL_EMPTY,
  NODE_TEST_REAL_FAIL,
  NODE_TEST_REAL_IPC_CRASH,
  NODE_TEST_REAL_LOAD_ERROR,
  NODE_TEST_REAL_MISSING,
  NODE_TEST_REAL_PASS,
  NODE_TEST_REAL_TAP_FAIL,
  NODE_TEST_REAL_TAP_PASS,
  PYTEST_COLLECTION_ERROR_QUIET,
  PYTEST_FAIL,
  PYTEST_REAL_DAPR_RED,
  PYTEST_MIXED_SUMMARY,
  PYTEST_NONE,
  PYTEST_PASS,
  PYTEST_PASS_QUIET,
  UNITTEST_ERROR_SKIP,
  UNITTEST_FAIL,
  UNITTEST_IMPORT_ERROR,
  UNITTEST_NONE,
  UNITTEST_PASS,
  UNITTEST_PASS_VERBOSE,
  UNITTEST_SKIP_ONLY,
} from './fixtures/runnerOutputs'

// Python's own unittest (2026-10-19): a Python project with few tests often has no pytest, and its runs went unseen.
describe('unittest, read from real output (Python 3.14)', () => {
  test('its runs are test runs: a file, a dotted module, discover, a venv python, a launcher', () => {
    expect(isTestRun('python -m unittest tests/test_calc.py')).toBe(true)
    expect(isTestRun('python3 -m unittest -v tests.test_calc')).toBe(true)
    expect(isTestRun('py -m unittest discover -s tests -t .')).toBe(true)
    expect(isTestRun('.venv/Scripts/python.exe -m unittest')).toBe(true)
    expect(isTestRun('.venv/bin/python -m unittest tests.test_calc.CalcTest.test_add')).toBe(true)
    expect(isTestRun('uv run python -m unittest')).toBe(true)
  })

  test('a mention, or another module named like it, is not a run', () => {
    expect(isTestRun('pip install unittest-xml-reporting')).toBe(false)
    expect(isTestRun('python -m unittestx')).toBe(false)
    expect(isTestRun('grep -r "python -m unittest" docs')).toBe(false)
  })

  test('OK is green, verbose or not; FAILED is red, for failures, errors or a module that failed to import', () => {
    expect(readRun(UNITTEST_PASS)).toBe('pass')
    expect(readRun(UNITTEST_PASS_VERBOSE)).toBe('pass')
    expect(readRun(UNITTEST_FAIL)).toBe('fail')
    expect(readRun(UNITTEST_ERROR_SKIP)).toBe('fail')
    expect(readRun(UNITTEST_IMPORT_ERROR)).toBe('fail')
  })

  test('no tests ran, or only skips, is no run', () => {
    expect(readRun(UNITTEST_NONE)).toBe('none')
    expect(readRun(UNITTEST_SKIP_ONLY)).toBe('none')
  })

  test('names the failed test files from the traceback, not the loader, with forward slashes', () => {
    expect(failedFilesIn(UNITTEST_FAIL)).toEqual(['C:/work/utfix/tests/test_calc.py'])
    expect(failedFilesIn(UNITTEST_ERROR_SKIP)).toEqual(['C:/work/utfix/tests/test_err.py'])
    expect(failedFilesIn(UNITTEST_IMPORT_ERROR)).toEqual(['C:/work/utfix/tests/test_broken.py'])
    expect(failedCountIn(UNITTEST_FAIL)).toBe(2)
  })

  test('the test file a command names: a path, or a dotted module turned into one', () => {
    expect(namedTestFile('python -m unittest tests/test_calc.py', 'python')).toBe('tests/test_calc.py')
    expect(namedTestFile('python -m unittest tests.test_calc', 'python')).toBe('tests/test_calc.py')
    expect(namedTestFile('python -m unittest tests.test_calc.CalcTest.test_add', 'python')).toBe('tests/test_calc.py')
    expect(namedTestFile('python -m unittest discover -s tests', 'python')).toBeNull()
  })
})

describe('pytest, read from real output', () => {
  test('a pass, quiet or not', () => {
    expect(readRun(PYTEST_PASS)).toBe('pass')
    expect(readRun(PYTEST_PASS_QUIET)).toBe('pass')
  })

  test('a failure, and a mixed summary', () => {
    expect(readRun(PYTEST_FAIL)).toBe('fail')
    expect(readRun(PYTEST_MIXED_SUMMARY)).toBe('fail')
  })

  test('a collection error is red, not a pass, not unread', () => {
    expect(readRun(PYTEST_COLLECTION_ERROR_QUIET)).toBe('fail')
  })

  test('no tests ran is not a run', () => {
    expect(readRun(PYTEST_NONE)).toBe('none')
  })

  test('names the failed and errored files with forward slashes', () => {
    expect(failedFilesIn(PYTEST_FAIL)).toEqual(['tests/test_other.py'])
    expect(failedFilesIn(PYTEST_COLLECTION_ERROR_QUIET)).toEqual(['tests/test_broken.py'])
  })
})

describe('gdUnit4, read from its reporter format (provisional until a real run is on record)', () => {
  test('the overall summary decides: failures or errors are red, otherwise green', () => {
    expect(readRun(GDUNIT_PASS)).toBe('pass')
    expect(readRun(GDUNIT_FAIL)).toBe('fail')
  })

  test('zero test cases is not a run', () => {
    expect(readRun(GDUNIT_NONE)).toBe('none')
  })

  test('names the suite that failed, without the res:// prefix', () => {
    expect(failedFilesIn(GDUNIT_FAIL)).toEqual(['test/player_test.gd'])
    expect(failedFilesIn(GDUNIT_PASS)).toEqual([])
  })
})

describe('Maven, Gradle and dotnet (provisional)', () => {
  test('Surefire totals, and a build that failed before any test ran is no verdict', () => {
    expect(readRun(MAVEN_PASS)).toBe('pass')
    expect(readRun(MAVEN_FAIL)).toBe('fail')
    expect(readRun(MAVEN_COMPILE_ERROR)).toBe('unknown')
  })

  test('Gradle counts, or a successful build whose test task ran', () => {
    expect(readRun(GRADLE_PASS)).toBe('pass')
    expect(readRun(GRADLE_FAIL)).toBe('fail')
  })

  test('dotnet, old summary and new', () => {
    expect(readRun(DOTNET_PASS)).toBe('pass')
    expect(readRun(DOTNET_FAIL)).toBe('fail')
    expect(readRun(DOTNET_MTP_FAIL)).toBe('fail')
  })

  test('says it is provisional', () => {
    expect(runnerNamed('gdunit4').provisional).toBe(true)
    expect(runnerNamed('maven').provisional).toBe(true)
    expect(runnerNamed('dotnet').provisional).toBe(false)
    expect(runnerNamed('pytest').provisional).toBe(false)
    expect(runnerNamed('vitest').provisional).toBe(false)
  })
})

// Seen live (2026-10-19): every `timeout 60 node --test …` run in a session went unseen, so no red or green was recorded.
describe('a test run behind a wrapper command is still a test run', () => {
  test('timeout, time, nice and env, with their options, and stacked', () => {
    expect(isTestRun('timeout 60 node --import ./tests/node/register.mjs --test tests/build.test.ts')).toBe(true)
    expect(isTestRun('timeout -s KILL --kill-after=5 2m npx vitest run')).toBe(true)
    expect(isTestRun('time pytest tests/test_calc.py')).toBe(true)
    expect(isTestRun('time -p pytest')).toBe(true)
    expect(isTestRun('nice -n 10 npm test')).toBe(true)
    expect(isTestRun('env CI=1 npx vitest run')).toBe(true)
    expect(isTestRun('env -u DEBUG -i PATH=/usr/bin pytest')).toBe(true)
    expect(isTestRun('cd app && timeout 30 nice time pytest -q')).toBe(true)
  })

  test('the test file is named through the wrapper', () => {
    expect(namedTestFile('timeout 60 npx vitest run tests/a.test.ts', 'node')).toBe('tests/a.test.ts')
    expect(namedTestFile('env CI=1 python -m pytest tests/test_calc.py', 'python', 'C:/r')).toBe('C:/r/tests/test_calc.py')
  })

  test('command, exec, xvfb-run, a brace group, and sh -c or bash -c', () => {
    const run = 'node --import ./tests/node/register.mjs --test tests/build.test.ts'
    expect(isTestRun(`command ${run}`)).toBe(true)
    expect(isTestRun(`exec ${run}`)).toBe(true)
    expect(isTestRun('xvfb-run -a npx vitest run src/a.test.ts')).toBe(true)
    expect(isTestRun(`{ ${run}; }`)).toBe(true)
    expect(isTestRun(`bash -c "${run}"`)).toBe(true)
    expect(isTestRun(`sh -c '${run}'`)).toBe(true)
  })

  // Seen live (2026-10-19): a probe that only quoted a test command inside node -e counted as an unread run.
  test('a test command quoted inside inline code is text, not a run', () => {
    expect(isTestRun(`node --import ./tests/node/register.mjs -e "console.log(isTestRun('node --test tests/build.test.ts'))"`)).toBe(false)
    expect(isTestRun(`node --eval 'run("npx vitest run")'`)).toBe(false)
    expect(isTestRun(`python -c "print('pytest tests/')"`)).toBe(false)
    expect(isTestRun('node --test "tests/**/*.test.ts"')).toBe(true)
  })

  test('a wrapper around something else is not a test run', () => {
    expect(isTestRun('timeout 5 curl localhost:3000')).toBe(false)
    expect(isTestRun('env')).toBe(false)
    expect(isTestRun('time')).toBe(false)
  })
})

describe('recognising a test run in a shell command', () => {
  test('each stack, at the start of a command or after a separator', () => {
    expect(isTestRun('npx vitest run tests/a.test.ts')).toBe(true)
    expect(isTestRun('python -m pytest tests/test_calc.py')).toBe(true)
    expect(isTestRun('.venv/Scripts/python.exe -m pytest -q')).toBe(true)
    expect(isTestRun('cd app && pytest')).toBe(true)
    expect(isTestRun('uv run pytest tests/')).toBe(true)
    expect(isTestRun('./addons/gdUnit4/runtest.sh -a res://test/player_test.gd')).toBe(true)
    expect(isTestRun('addons\\gdUnit4\\runtest.cmd -a res://test')).toBe(true)
    expect(isTestRun('godot --headless -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd -a res://test')).toBe(true)
    expect(isTestRun('mvn -q test')).toBe(true)
    expect(isTestRun('./mvnw -Dtest=FooTest test')).toBe(true)
    expect(isTestRun('./gradlew test --tests com.example.FooTest')).toBe(true)
    expect(isTestRun('dotnet test --filter FullyQualifiedName~FooTests')).toBe(true)
  })

  test('a mention is not a run', () => {
    expect(isTestRun('echo "run pytest later"')).toBe(false)
    expect(isTestRun('git log --grep pytest')).toBe(false)
    expect(isTestRun('cat addons/gdUnit4/runtest.sh')).toBe(false)
    expect(isTestRun('mvn compile')).toBe(false)
    expect(isTestRun('dotnet build')).toBe(false)
  })

  test('asking a runner its version, its help or its test list runs no test (Karl, Python trial, 2026-10-19)', () => {
    expect(isTestRun('python -m pytest --version')).toBe(false)
    expect(isTestRun('pytest -h')).toBe(false)
    expect(isTestRun('python -m pytest --collect-only -q tests')).toBe(false)
    expect(isTestRun('pytest --co')).toBe(false)
    expect(isTestRun('python -m unittest --help')).toBe(false)
    expect(isTestRun('npx vitest --version')).toBe(false)
    expect(isTestRun('npx jest --help')).toBe(false)
    expect(isTestRun('dotnet test --help')).toBe(false)
    // A version check beside a real run leaves the run a run, and pytest's -v is verbose, not a version.
    expect(isTestRun('pytest --version && pytest tests/test_calc.py')).toBe(true)
    expect(isTestRun('python -m pytest -v tests/test_calc.py')).toBe(true)
  })

  test('a heredoc written to a file is data: the commands it quotes never ran (seen writing a PR body, 2026-10-09)', () => {
    const body = "cat > body.md <<'EOF'\nTo re-check:\nnpx vitest run server/a.test.ts\ndotnet test --filter Foo\nEOF\ngh pr create --body-file body.md"
    expect(isTestRun(body)).toBe(false)
    expect(testRunLocation(body, 'C:/work')).toBe(null)
    const probe = "cat > /dev/null <<'EOF'\nnpx vitest run probe.test.ts\nEOF\necho probe done"
    expect(isTestRun(probe)).toBe(false)
    expect(testRunLocation(probe, 'C:/work')).toBe(null)
    const commit = "git add a && git commit -q -F - <<'EOF'\nfix: quoted npx vitest run and dotnet test\nEOF\ngit push -q"
    expect(testRunLocation(commit, 'C:/work')).toBe(null)
  })

  test('a heredoc fed to a shell runs, and a run after the terminator is still a run', () => {
    expect(isTestRun("bash <<'EOF'\nnpx vitest run\nEOF")).toBe(true)
    expect(isTestRun("cat > a.md <<'EOF'\nnotes\nEOF\nnpx vitest run")).toBe(true)
    expect(testRunLocation("cat > a.md <<'EOF'\nnotes\nEOF\ncd server && npx vitest run", 'C:/work')).toBe('C:/work/server')
  })
})

describe('the test file a command names, by the stack', () => {
  test('python, godot and java naming rules', () => {
    expect(namedTestFile('python -m pytest tests/pkg/test_calc.py -q', 'python')).toBe('tests/pkg/test_calc.py')
    expect(namedTestFile('runtest.cmd -a res://test/player_test.gd', 'godot')).toBe('test/player_test.gd')
    expect(namedTestFile('mvn -Dtest=FooTest test', 'java')).toBe(null)
    expect(namedTestFile('npx vitest run tests/a.test.ts', 'node')).toBe('tests/a.test.ts')
    expect(namedTestFile('npx vitest run', 'node')).toBe(null)
  })
})

describe('the command that runs one unittest file (2026-10-19)', () => {
  test("unittest runs the file through the venv python when one was found, and a reviewer's receipt says the same", () => {
    expect(runnerArgv('C:/work', 'unittest', 'tests/test_calc.py', 'C:/work/.venv/Scripts/python.exe')).toEqual([
      'C:/work/.venv/Scripts/python.exe',
      '-m',
      'unittest',
      'tests/test_calc.py',
    ])
    expect(runnerNamed('unittest').describe('tests/test_calc.py')).toBe('python -m unittest tests/test_calc.py')
  })
})

describe('the command that runs one test file', () => {
  test('pytest runs through the venv python when one was found, else python on PATH', () => {
    expect(runnerArgv('C:/work', 'pytest', 'tests/test_calc.py', 'C:/work/.venv/Scripts/python.exe')).toEqual([
      'C:/work/.venv/Scripts/python.exe',
      '-m',
      'pytest',
      '-q',
      '-p',
      'no:cacheprovider',
      'tests/test_calc.py',
    ])
    expect(runnerArgv('C:/work', 'pytest', 'tests/test_calc.py')[0]).toBe('python')
  })

  test('gdUnit4 runs headless through the command-line tool, on the project path, with the suite as a res:// path', () => {
    const argv = runnerArgv('C:/game', 'gdunit4', 'test/player_test.gd', 'godot', { godot: 'C:/Godot/Godot.exe' })
    expect(argv[0]).toBe('C:/Godot/Godot.exe')
    expect(argv).toContain('--headless')
    expect(argv).toContain('--ignoreHeadlessMode')
    expect(argv.slice(argv.indexOf('--path'), argv.indexOf('--path') + 2)).toEqual(['--path', 'C:/game'])
    expect(argv.slice(argv.indexOf('-a'), argv.indexOf('-a') + 2)).toEqual(['-a', 'res://test/player_test.gd'])
    expect(runnerArgv('C:/game', 'gdunit4', 'test/player_test.gd')[0]).toBe('godot')
  })

  test('Maven and Gradle select the test class from the file path', () => {
    expect(runnerArgv('C:/app', 'maven', 'src/test/java/com/example/FooTest.java', 'mvn')).toContain('-Dtest=com.example.FooTest')
    expect(runnerArgv('C:/app', 'gradle', 'src/test/java/com/example/FooTest.java', 'C:/app/gradlew.bat')).toEqual([
      'C:/app/gradlew.bat',
      'test',
      '--tests',
      'com.example.FooTest',
      '--console=plain',
    ])
  })

  test('vitest and jest still run through node on the runner found', () => {
    expect(runnerArgv('C:/work', 'vitest', 'tests/a.test.ts')).toEqual(['node', 'C:/work/node_modules/vitest/vitest.mjs', 'run', 'tests/a.test.ts'])
    expect(runnerArgv('C:/work', 'jest', 'tests/a.test.ts', 'C:/work/node_modules/jest/bin/jest.js')).toEqual(['node', 'C:/work/node_modules/jest/bin/jest.js', 'tests/a.test.ts'])
  })
})

describe('where a run executes', () => {
  test('the named test file comes from the segment that runs the tests, resolved against its directory', () => {
    expect(namedTestFile('cd server && npx vitest run src/__tests__/utils/dice.test.ts', 'node', 'C:/work')).toBe('C:/work/server/src/__tests__/utils/dice.test.ts')
    expect(namedTestFile('npx vitest run tests/a.test.ts', 'node', 'C:/work')).toBe('C:/work/tests/a.test.ts')
    expect(namedTestFile('cat tests/b.test.ts && npx vitest run', 'node', 'C:/work')).toBe(null)
  })

  test('the run location is the directory of the test-run segment, or null, or elsewhere', () => {
    expect(testRunLocation('cd server && npx vitest run', 'C:/work')).toBe('C:/work/server')
    expect(testRunLocation('cd ../other && npx vitest run', 'C:/work')).toBe('C:/other')
    expect(testRunLocation('cd && npx vitest run', 'C:/work')).toBe(ELSEWHERE)
    expect(testRunLocation('git status', 'C:/work')).toBe(null)
  })
})

describe('dotnet test, read from a real Roadhouse run', () => {
  test('a pass, a failure, and a filter that matches nothing', () => {
    expect(readRun(DOTNET_REAL_PASS)).toBe('pass')
    expect(readRun(DOTNET_REAL_FAIL)).toBe('fail')
    // Exit code 0 and no summary: the silent-absence shape. It must never read as a pass.
    expect(readRun(DOTNET_REAL_NO_MATCH)).toBe('none')
  })

  test('names the failed test file from the stack trace, with forward slashes, and not a source file', () => {
    expect(failedFilesIn(DOTNET_REAL_FAIL)).toEqual(['C:/work/Roadhouse-Game/test/BandCoreTest.cs'])
    expect(failedFilesIn(DOTNET_REAL_PASS)).toEqual([])
  })

  test('a catch check over a filter that matched nothing is unverified, never missed', () => {
    expect(catchOutcome({ stdout: DOTNET_REAL_NO_MATCH, stderr: '', exitCode: 0 })).toEqual({ kind: 'unverified', reason: 'no tests ran' })
    expect(catchOutcome({ stdout: DOTNET_REAL_FAIL, stderr: '', exitCode: 1 })).toEqual({ kind: 'caught' })
    expect(catchOutcome({ stdout: DOTNET_REAL_PASS, stderr: '', exitCode: 0 })).toEqual({ kind: 'missed' })
  })
})

describe('the fallback program when nothing in the project names one', () => {
  test('python on Windows, python3 elsewhere: stock macOS has no python', () => {
    expect(fallbackTool(runnerNamed('pytest'), 'C:/work/app')).toBe('python')
    expect(fallbackTool(runnerNamed('pytest'), '/Users/beth/app')).toBe('python3')
    expect(fallbackTool(runnerNamed('vitest'), '/Users/beth/app')).toBe(runnerNamed('vitest').fallback)
  })
})

describe('monorepo test commands and their prefixed output', () => {
  test('workspace runs are test runs: pnpm filters and recursion, yarn and npm workspaces, turbo, nx, lerna', () => {
    for (const command of [
      'pnpm --filter api test',
      'pnpm -F @acme/api test',
      'pnpm -r test',
      'pnpm --recursive run test',
      'yarn workspace api test',
      'npm test --workspace=server',
      'npm run test -w server',
      'turbo run test',
      'npx turbo test --filter=api',
      'nx test api',
      'npx nx run api:test',
      'nx run-many -t test',
      'lerna run test',
    ]) {
      expect(isTestRun(command)).toBe(true)
    }
  })

  test('other workspace tasks are not', () => {
    for (const command of ['pnpm --filter api build', 'turbo run build', 'nx build api', 'pnpm -r lint', 'nx run api:build', 'yarn workspace api add vitest']) {
      expect(isTestRun(command)).toBe(false)
    }
  })

  test('turbo and pnpm -r prefix each line with the package and task; the summary and the failed files still read', () => {
    const turbo = 'api:test: \napi:test:  FAIL  src/a.test.ts > adds\napi:test:  Test Files  1 failed (1)\napi:test:       Tests  1 failed (1)\n'
    const pnpm = 'server test:  ✓ src/b.test.ts (2 tests)\nserver test:  Test Files  1 passed (1)\nserver test:       Tests  2 passed (2)\n'
    expect(readRun(turbo)).toBe('fail')
    expect(failedFilesIn(turbo)).toEqual(['src/a.test.ts'])
    expect(readRun(pnpm)).toBe('pass')
    expect(readRun('Test Suites: 1 failed, 1 total\nTests:       1 failed, 2 passed, 3 total\n')).toBe('fail')
  })
})

describe('the package a workspace run targets', () => {
  test('read from npm, pnpm, yarn and nx; none for a plain run', () => {
    expect(workspaceTarget('npm test -w server')).toBe('server')
    expect(workspaceTarget('npm run test --workspace=packages/api')).toBe('packages/api')
    expect(workspaceTarget('pnpm --filter @acme/api test')).toBe('@acme/api')
    expect(workspaceTarget('pnpm -F ./packages/api... test')).toBe('./packages/api')
    expect(workspaceTarget('yarn workspace api test')).toBe('api')
    expect(workspaceTarget('nx test api')).toBe('api')
    expect(workspaceTarget('npx nx run api:test')).toBe('api')
    expect(workspaceTarget('npx vitest run tests/x.test.ts')).toBe(null)
    expect(workspaceTarget('pnpm -r test')).toBe(null)
  })
})

describe('ava, read from real output', () => {
  test('its runs are test runs, however it is started', () => {
    expect(isTestRun('npx ava source/utils/a.spec.ts')).toBe(true)
    expect(isTestRun('pnpm exec ava source/utils/a.spec.ts')).toBe(true)
    expect(isTestRun('node node_modules/ava/entrypoints/cli.js source/utils/a.spec.ts')).toBe(true)
    expect(isTestRun('cat node_modules/ava/readme.md')).toBe(false)
  })

  test('the summary decides: a failed test is red, a clean run is green; the failed file is named with forward slashes', () => {
    expect(readRun(AVA_REAL_FAIL)).toBe('fail')
    expect(failedFilesIn(AVA_REAL_FAIL)).toEqual(['source/utils/zz-dope-probe.spec.ts'])
    expect(readRun(AVA_REAL_PASS)).toBe('pass')
    expect(failedFilesIn(AVA_REAL_PASS)).toEqual([])
  })

  test('an uncaught exception or no files found is not a pass', () => {
    expect(readRun('  ✔ one\n  ─\n\n  1 uncaught exception\n  2 tests passed\n')).toBe('fail')
    expect(readRun("  ✘ Couldn't find any files to test\n")).toBe('none')
  })
})

describe('pytest through a launcher with flags (seen on dapr-agents, 2026-10-09)', () => {
  test('uv run --group test, uv run --with, poetry run -q: all test runs, and the test file is still named', () => {
    expect(isTestRun('uv run --group test python -m pytest tests/memory/test_liststore.py 2>&1 | tail -15')).toBe(true)
    expect(isTestRun('uv run --with pytest pytest tests/test_a.py')).toBe(true)
    expect(isTestRun('poetry run -q pytest tests/test_a.py')).toBe(true)
    expect(isTestRun('uv run --group test python -m ruff check .')).toBe(false)
    expect(namedTestFile('uv run --group test python -m pytest tests/memory/test_liststore.py', 'python')).toBe('tests/memory/test_liststore.py')
  })

  test('its real summary, with Windows line endings, reads red and green', () => {
    expect(readRun('FAILED tests/memory/test_liststore.py::test_reset_memory_clears_only_that_id\r\n======================== 3 failed, 1 passed in 16.14s =========================\r\n')).toBe('fail')
    expect(readRun('tests/memory/test_liststore.py::test_add_interaction_uses_given_id PASSED [100%]\r\n\r\n============================== 4 passed in 4.79s ==============================\r\n')).toBe('pass')
  })
})

describe('the names of the tests that failed, so old failures can be told from new ones', () => {
  test('ava: the name after [fail]:, without the reason ava appends', () => {
    expect(failedTestsIn(AVA_REAL_FAIL)).toEqual(['probe fails on purpose'])
    const old = failedTestsIn(AVA_REAL_PREEXISTING)
    expect(old).toHaveLength(5)
    expect(old).toContain('security: rejects an in-project symlink whose target escapes')
    expect(old).toContain('resolveFilePath: resolves simple relative paths')
  })

  test('pytest: file::test from the summary, without the message', () => {
    expect(failedTestsIn(PYTEST_REAL_DAPR_RED)).toEqual([
      'tests/memory/test_liststore.py::test_messages_are_isolated_per_workflow_instance_id',
      'tests/memory/test_liststore.py::test_reset_memory_clears_only_that_id',
      'tests/memory/test_liststore.py::test_add_interaction_uses_given_id',
    ])
  })

  test('vitest, jest, gdUnit4 and dotnet name theirs too; a pass names none', () => {
    expect(failedTestsIn(' FAIL  test/slugify.test.ts > slugify > keeps accents\n\n Test Files  1 failed (1)\n')).toEqual(['test/slugify.test.ts > slugify > keeps accents'])
    expect(failedTestsIn('  ● slugify › keeps accents\n\nTests:       1 failed, 1 total\n')).toEqual(['slugify › keeps accents'])
    expect(failedTestsIn(GDUNIT_FAIL)).toEqual(['player_test > test_land'])
    expect(failedTestsIn(DOTNET_FAIL)).toEqual(['Foo.Tests.FooTests.Bar'])
    expect(failedTestsIn(AVA_REAL_PASS)).toEqual([])
    expect(failedTestsIn(PYTEST_PASS)).toEqual([])
  })
})

describe("Node's built-in runner, read from real output (node --test, Node 24, Windows)", () => {
  test('its runs are test runs: a file, a quoted glob, a reporter flag; a package script is one already', () => {
    expect(isTestRun('node --test test/helpers.test.js')).toBe(true)
    expect(isTestRun('node --test "test/**/*.test.js"')).toBe(true)
    expect(isTestRun('node --test --test-reporter=spec test/helpers.test.js')).toBe(true)
    expect(isTestRun('node --test-reporter=tap --test test/helpers.test.js')).toBe(true)
    expect(isTestRun('node.exe --test test/helpers.test.js 2>&1 | tail -40')).toBe(true)
    expect(isTestRun('npm test')).toBe(true)
    expect(isTestRun('node index.js')).toBe(false)
    expect(isTestRun('node --test-reporter=spec index.js')).toBe(false)
    expect(isTestRun('node scripts/smoke-test.js')).toBe(false)
  })

  test('the test file it names, and none for a glob', () => {
    expect(namedTestFile('node --test test/sources/spotify.test.js', 'node')).toBe('test/sources/spotify.test.js')
    expect(namedTestFile('node --test "test/**/*.test.js"', 'node')).toBe(null)
  })

  test('the spec summary decides: a failure is red, a clean run is green', () => {
    expect(readRun(NODE_TEST_REAL_PASS)).toBe('pass')
    expect(readRun(NODE_TEST_REAL_FAIL)).toBe('fail')
    expect(failedCountIn(NODE_TEST_REAL_FAIL)).toBe(1)
    expect(failedCountIn(NODE_TEST_REAL_PASS)).toBe(0)
  })

  test('the TAP summary reads the same', () => {
    expect(readRun(NODE_TEST_REAL_TAP_PASS)).toBe('pass')
    expect(readRun(NODE_TEST_REAL_TAP_FAIL)).toBe('fail')
    expect(failedCountIn(NODE_TEST_REAL_TAP_FAIL)).toBe(1)
  })

  test('a file that throws while loading is red; a file it cannot find is no run', () => {
    expect(readRun(NODE_TEST_REAL_LOAD_ERROR)).toBe('fail')
    expect(failedFilesIn(NODE_TEST_REAL_LOAD_ERROR)).toEqual(['test/loaderr.test.js'])
    expect(readRun(NODE_TEST_REAL_MISSING)).toBe('none')
  })

  test('an empty file is the one pass node reports for it; a run of only skips is no run', () => {
    expect(readRun(NODE_TEST_REAL_EMPTY)).toBe('pass')
    const skipped = NODE_TEST_REAL_PASS.replace('ℹ pass 2', 'ℹ pass 0').replace('ℹ skipped 0', 'ℹ skipped 2')
    expect(readRun(skipped)).toBe('none')
  })

  test('a summary whose glyph a console code page mangled still reads', () => {
    expect(readRun(NODE_TEST_REAL_FAIL.replace(/ℹ/g, 'Γä╣'))).toBe('fail')
  })

  test('names the failed test, not its suite, and the failed file with forward slashes', () => {
    expect(failedTestsIn(NODE_TEST_REAL_FAIL)).toEqual(['fails on purpose'])
    expect(failedTestsIn(NODE_TEST_REAL_TAP_FAIL)).toEqual(['fails on purpose'])
    expect(failedTestsIn(NODE_TEST_REAL_PASS)).toEqual([])
    expect(failedFilesIn(NODE_TEST_REAL_FAIL)).toEqual(['test/broken.test.js'])
    expect(failedFilesIn(NODE_TEST_REAL_TAP_FAIL)).toEqual(['C:/Users/dev/vibecast/test/broken.test.js'])
  })

  test('a summary a filter thinned still reads, as long as tests, pass and fail are all there (#18)', () => {
    const kept = (output: string, pattern: RegExp) => output.split('\n').filter(line => pattern.test(line)).join('\n')
    // `| grep -E "✖|ℹ (tests|pass|fail)"` and `| head -30 | grep …`, as the VibeCast agent ran them
    expect(readRun(kept(NODE_TEST_REAL_FAIL, /✖|ℹ (tests|pass|fail)/))).toBe('fail')
    expect(readRun(kept(NODE_TEST_REAL_PASS, /✖|ℹ (tests|pass|fail)/))).toBe('pass')
    expect(readRun(kept(NODE_TEST_REAL_TAP_FAIL, /^# (tests|pass|fail) /))).toBe('fail')
    // `| grep -E "^ℹ (tests|fail)"`: a red says so on its own; a green needs its pass count
    expect(readRun(kept(NODE_TEST_REAL_FAIL, /^ℹ (tests|fail) /))).toBe('fail')
    expect(readRun(kept(NODE_TEST_REAL_PASS, /^ℹ (tests|fail) /))).toBe('unknown')
  })

  test('a thinned summary is never green when anything could hide behind it', () => {
    expect(readRun('ℹ tests 3\nℹ pass 2\nℹ fail 0\n')).toBe('unknown')
    expect(readRun('ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ cancelled 1\n')).toBe('fail')
    expect(readRun('ℹ pass 2\nℹ fail 0\n')).toBe('unknown')
    expect(readRun('ℹ tests 0\nℹ pass 0\nℹ fail 0\n')).toBe('none')
    // A log line that happens to start with the words is not a count
    expect(readRun('ℹ tests 2 queued\nℹ pass 2\nℹ fail 0\n')).toBe('unknown')
  })

  test('the runner crashing on its child process output is no run, not a red (#26)', () => {
    expect(readRun(NODE_TEST_REAL_IPC_CRASH)).toBe('unknown')
    expect(nodeRunnerCrashed(NODE_TEST_REAL_IPC_CRASH)).toBe(true)
    expect(nodeRunnerCrashed(NODE_TEST_REAL_FAIL)).toBe(false)
    expect(nodeRunnerCrashed(NODE_TEST_REAL_LOAD_ERROR)).toBe(false)
    // The words alone, printed by a test, are not Node's own crash
    expect(nodeRunnerCrashed("console: 'Unable to deserialize cloned data due to invalid or unsupported version.'")).toBe(false)
  })

  test('one file runs through node --test, and that is the command a reviewer re-runs', () => {
    expect(runnerArgv('C:/vibecast', 'node-test', 'test/helpers.test.js')).toEqual(['node', '--test', 'test/helpers.test.js'])
    expect(runnerNamed('node-test').describe('test/helpers.test.js')).toBe('node --test test/helpers.test.js')
  })
})

describe("node --test with Node's own flags in the test script (seen on dope-tdd itself, 2026-10-18)", () => {
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts })

  test('a loader before --test is carried, with its value', () => {
    expect(nodeTestLauncher(pkg({ test: 'node --import ./tests/node/register.mjs --test tests/*.test.ts' }))).toEqual([
      'node',
      '--import',
      './tests/node/register.mjs',
    ])
  })

  test('each spelling of a loader, and runtime switches, are carried in order', () => {
    expect(nodeTestLauncher(pkg({ test: 'node --import=tsx -r dotenv/config --experimental-strip-types --no-warnings --test test/' }))).toEqual([
      'node',
      '--import=tsx',
      '-r',
      'dotenv/config',
      '--experimental-strip-types',
      '--no-warnings',
    ])
  })

  test('a loader after --test counts, and a quoted value loses its quotes', () => {
    expect(nodeTestLauncher(pkg({ 'test:unit': 'node --test --import "tsx" test/' }))).toEqual(['node', '--import', 'tsx'])
  })

  test("the runner's own flags and the files to run are never carried", () => {
    expect(nodeTestLauncher(pkg({ test: 'node --test-reporter=spec --test-name-pattern "slow" --test test/' }))).toBeUndefined()
  })

  test('no flags, no node --test script, or no readable package: nothing to carry', () => {
    expect(nodeTestLauncher(pkg({ test: 'node --test test/' }))).toBeUndefined()
    expect(nodeTestLauncher(pkg({ test: 'vitest run', start: 'node --import tsx index.js' }))).toBeUndefined()
    expect(nodeTestLauncher('{ not json')).toBeUndefined()
  })

  test('the catch check and the receipt both run the file through the carried flags', () => {
    const launcher = ['node', '--import', './tests/node/register.mjs']
    expect(runnerArgv('C:/dope-tdd', 'node-test', 'tests/runPlan.test.ts', undefined, { launcher })).toEqual([
      'node',
      '--import',
      './tests/node/register.mjs',
      '--test',
      'tests/runPlan.test.ts',
    ])
    expect(runnerNamed('node-test').describe('tests/runPlan.test.ts', launcher)).toBe('node --import ./tests/node/register.mjs --test tests/runPlan.test.ts')
  })
})

describe('which loaders let node --test run .tsx and .jsx (2026-10-18)', () => {
  test('a JSX-capable loader is recognised, a plain TypeScript loader is not', () => {
    const jsx = runnerNamed('node-test').jsxLoader
    expect(jsx?.test('tsx')).toBe(true)
    expect(jsx?.test('--import=tsx')).toBe(true)
    expect(jsx?.test('@swc-node/register')).toBe(true)
    expect(jsx?.test('./tests/node/register.mjs')).toBe(false)
    expect(runnerNamed('vitest').jsxLoader).toBeUndefined()
  })
})

// Kit runs (2026-10-18): until now `claude plugin test` output was unread, so a plugin's kit tests never saw red.
describe('claude plugin test, read from real output', () => {
  test('a run with failures is a fail; an all-pass run is a pass', () => {
    expect(readRun(PLUGIN_KIT_FAIL)).toBe('fail')
    expect(readRun(PLUGIN_KIT_PASS)).toBe('pass')
  })

  test('the failed files are the headers above each (fail), a file that did not load among them', () => {
    expect(failedFilesIn(PLUGIN_KIT_FAIL)).toEqual(['tests/band.test.tsx', 'tests/overrideFlow.test.tsx'])
    expect(failedFilesIn(PLUGIN_KIT_PASS)).toEqual([])
  })

  test('it is a test run, and its command runs the whole folder', () => {
    expect(isTestRun('claude plugin test .')).toBe(true)
    expect(isTestRun('cd /c/r && claude plugin test . 2>&1')).toBe(true)
    expect(isTestRun('claude plugin validate .')).toBe(false)
    expect(runnerNamed('plugin-kit').describe('tests/band.test.tsx')).toBe('claude plugin test .')
  })

  test('it is provisional: the catch check does not re-run the whole kit by itself', () => {
    expect(runnerNamed('plugin-kit').provisional).toBe(true)
  })

  test('it always runs the whole folder; other runners run what the command names', () => {
    expect(runsWholeFolder('claude plugin test .')).toBe(true)
    expect(runsWholeFolder('cd /c/r && claude plugin test . 2>&1')).toBe(true)
    expect(runsWholeFolder('npx vitest run')).toBe(false)
    expect(runsWholeFolder('node --test tests/a.test.ts')).toBe(false)
  })
})

// Seen live 2026-10-18: `node --test tools/pr-check/check.spec-node.ts` names a file the stack's test rule does not
// match, so it looked like an unnamed suite run, and its red and green were credited to the current module.
describe('namedOtherFiles: files a test command names that are not tests by the stack rule', () => {
  test('a spec outside the layout is named, resolved where the segment runs', () => {
    expect(namedOtherFiles('node --test tools/pr-check/check.spec-node.ts', 'node', 'C:/r')).toEqual(['C:/r/tools/pr-check/check.spec-node.ts'])
    expect(namedOtherFiles('cd tools && node --test pr-check/flow.spec-node.ts', 'node', 'C:/r')).toEqual(['C:/r/tools/pr-check/flow.spec-node.ts'])
  })

  test('a test by the rule, a glob, an option or no file names nothing else', () => {
    expect(namedOtherFiles('npx vitest run tests/a.test.ts', 'node', 'C:/r')).toEqual([])
    expect(namedOtherFiles('node --test "tests/*.test.ts"', 'node', 'C:/r')).toEqual([])
    expect(namedOtherFiles('node --import ./tests/node/register.mjs --test tests/a.test.ts', 'node', 'C:/r')).toEqual([])
    expect(namedOtherFiles('npm test', 'node', 'C:/r')).toEqual([])
    expect(namedOtherFiles('ls tools/x.ts', 'node', 'C:/r')).toEqual([])
  })
})
