import { describe, expect, test } from 'claude-code/testing'

import { catchOutcome, runnerArgv } from '../hooks/catchCheck'
import { failedFilesIn, failedTestsIn, fallbackTool, isTestRun, namedTestFile, readRun, runnerNamed, testRunLocation, workspaceTarget } from '../hooks/runners'
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
  PYTEST_COLLECTION_ERROR_QUIET,
  PYTEST_FAIL,
  PYTEST_REAL_DAPR_RED,
  PYTEST_MIXED_SUMMARY,
  PYTEST_NONE,
  PYTEST_PASS,
  PYTEST_PASS_QUIET,
} from './fixtures/runnerOutputs'

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
