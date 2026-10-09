import { describe, expect, test } from 'claude-code/testing'

import { runnerArgv } from '../hooks/catchCheck'
import { failedFilesIn, isTestRun, namedTestFile, readRun, runnerNamed, testRunLocation } from '../hooks/runners'
import { ELSEWHERE } from '../hooks/shell'
import {
  DOTNET_FAIL,
  DOTNET_MTP_FAIL,
  DOTNET_PASS,
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
