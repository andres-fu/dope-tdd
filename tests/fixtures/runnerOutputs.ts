/**
 * Runner output the summary readers are written from. A constant harvested
 * from a real run says so, with the runner's version and the date. A
 * constant reconstructed from the runner's own source or documentation is
 * marked PROVISIONAL: it is replaced the first time a real run is on record,
 * because a reader tested only against text someone typed is the "unread"
 * bug waiting to happen.
 */

// --- pytest 9.1.1 on Python 3.14.2, Windows, 2026-10-08 (real). `python -m pytest tests/test_calc.py`.
export const PYTEST_PASS = String.raw`============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.1.1, pluggy-1.6.0
rootdir: C:\work\pyfix
collected 2 items

tests\test_calc.py ..                                                    [100%]

============================== 2 passed in 0.02s ==============================
`

// Same run with `-q` (real).
export const PYTEST_PASS_QUIET = String.raw`..                                                                       [100%]
2 passed in 0.01s
`

// `python -m pytest tests/test_other.py`, one failing assertion (real).
export const PYTEST_FAIL = String.raw`============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.1.1, pluggy-1.6.0
rootdir: C:\work\pyfix
collected 1 item

tests\test_other.py F                                                    [100%]

================================== FAILURES ===================================
_______________________________ test_add_wrong ________________________________

    def test_add_wrong():
>       assert add(1, 2) == 4
E       assert 3 == 4
E        +  where 3 = add(1, 2)

tests\test_other.py:4: AssertionError
=========================== short test summary info ===========================
FAILED tests/test_other.py::test_add_wrong - assert 3 == 4
============================== 1 failed in 0.10s ==============================
`

// Whole suite, `-q`: a file that fails to import stops pytest at collection (real).
export const PYTEST_COLLECTION_ERROR_QUIET = String.raw`
=================================== ERRORS ====================================
____________________ ERROR collecting tests/test_broken.py ____________________
ImportError while importing test module 'C:\work\pyfix\tests\test_broken.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
C:\Python314\Lib\importlib\__init__.py:88: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
tests\test_broken.py:1: in <module>
    import nonexistent_module
E   ModuleNotFoundError: No module named 'nonexistent_module'
=========================== short test summary info ===========================
ERROR tests/test_broken.py
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.19s
`

// `python -m pytest empty`, a directory with no tests; exit code 5, which the reader must not need (real).
export const PYTEST_NONE = String.raw`============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.1.1, pluggy-1.6.0
rootdir: C:\work\pyfix
collected 0 items

============================ no tests ran in 0.00s ============================
`

// The mixed summary line as pytest prints it when both happen in one run (shape verified).
export const PYTEST_MIXED_SUMMARY = String.raw`=========================== short test summary info ===========================
FAILED tests/test_other.py::test_add_wrong - assert 3 == 4
========================= 1 failed, 2 passed in 0.12s =========================
`

// --- gdUnit4: PROVISIONAL, reconstructed from GdUnitConsoleTestReporter.gd (master, 2026-10-08): the per-test status
// lines, the per-suite "Statistics:" line, then "Overall Summary:", "Executed test suites/cases" and the time.
export const GDUNIT_PASS = String.raw`--------------------------------------------------------------------------------------------------
GdUnit4 Comandline Tool
--------------------------------------------------------------------------------------------------
Run Test Suite: res://test/player_test.gd
	player_test > test_jump                                   PASSED 1ms
	player_test > test_land                                   PASSED 0ms
Statistics: 2 test cases | 0 errors | 0 failures | 0 flaky | 0 skipped | 0 orphans |      PASSED 3ms

Overall Summary: 2 test cases | 0 errors | 0 failures | 0 flaky | 0 skipped | 0 orphans |
Executed test suites: (1/1)
Executed test cases : (2/2)
Total execution time: 3ms
`

export const GDUNIT_FAIL = String.raw`--------------------------------------------------------------------------------------------------
GdUnit4 Comandline Tool
--------------------------------------------------------------------------------------------------
Run Test Suite: res://test/player_test.gd
	player_test > test_jump                                   PASSED 1ms
	player_test > test_land                                   FAILED 2ms
	Report:
	  Expecting: 0 but was 3
	  at test/player_test.gd:14
Statistics: 2 test cases | 0 errors | 1 failures | 0 flaky | 0 skipped | 0 orphans |      FAILED 3ms

Overall Summary: 2 test cases | 0 errors | 1 failures | 0 flaky | 0 skipped | 0 orphans |
Executed test suites: (1/1)
Executed test cases : (2/2)
Total execution time: 3ms
`

export const GDUNIT_NONE = String.raw`--------------------------------------------------------------------------------------------------
GdUnit4 Comandline Tool
--------------------------------------------------------------------------------------------------
Overall Summary: 0 test cases | 0 errors | 0 failures | 0 flaky | 0 skipped | 0 orphans |
Executed test suites: (0/0)
Executed test cases : (0/0)
Total execution time: 0ms
`

// --- Maven Surefire: PROVISIONAL, the documented report shape.
export const MAVEN_PASS = String.raw`[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.example.FooTest
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.041 s -- in com.example.FooTest
[INFO]
[INFO] Results:
[INFO]
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
[INFO]
[INFO] BUILD SUCCESS
`

export const MAVEN_FAIL = String.raw`[INFO] Running com.example.FooTest
[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.052 s <<< FAILURE! -- in com.example.FooTest
[ERROR] com.example.FooTest.bar -- Time elapsed: 0.010 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   FooTest.bar:12 expected: <1> but was: <2>
[INFO]
[ERROR] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0
[INFO]
[INFO] BUILD FAILURE
`

export const MAVEN_COMPILE_ERROR = String.raw`[ERROR] COMPILATION ERROR :
[ERROR] /work/src/main/java/com/example/Foo.java:[7,9] ';' expected
[INFO] BUILD FAILURE
`

// --- Gradle: PROVISIONAL, with --console=plain.
export const GRADLE_PASS = String.raw`> Task :compileJava
> Task :compileTestJava
> Task :test

BUILD SUCCESSFUL in 4s
3 actionable tasks: 3 executed
`

export const GRADLE_FAIL = String.raw`> Task :test FAILED

FooTest > bar() FAILED
    org.opentest4j.AssertionFailedError at FooTest.java:12

3 tests completed, 1 failed

FAILURE: Build failed with an exception.
`

// --- dotnet test: PROVISIONAL, VSTest's summary and the newer testing platform's.
export const DOTNET_PASS = String.raw`Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 12 ms - Foo.Tests.dll (net8.0)
`

export const DOTNET_FAIL = String.raw`  Failed Foo.Tests.FooTests.Bar [3 ms]
  Error Message:
   Assert.Equal() Failure
Failed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3, Duration: 15 ms - Foo.Tests.dll (net8.0)
`

export const DOTNET_MTP_FAIL = String.raw`failed Bar (3ms)
  Assert.Equal() Failure

Test summary: total: 3, failed: 1, succeeded: 2, skipped: 0, duration: 0.4s
`

// --- dotnet test, REAL: .NET SDK 8.0.425, Roadhouse (Godot 4.6.2 mono, gdUnit4.api 5.0.0, adapter 3.0.0), Windows, 2026-10-09.
// `dotnet test Roadhouse.csproj --nologo --filter "FullyQualifiedName~BandCoreTest"`. Paths shortened.
export const DOTNET_REAL_PASS = String.raw`  Determining projects to restore...
  Restored C:\work\Roadhouse-Game\Roadhouse.csproj (in 18.07 sec).
  Roadhouse -> C:\work\Roadhouse-Game\.godot\mono\temp\bin\Debug\Roadhouse.dll
Test run for C:\work\Roadhouse-Game\.godot\mono\temp\bin\Debug\Roadhouse.dll (.NETCoreApp,Version=v8.0)
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:     4, Skipped:     0, Total:     4, Duration: 20 ms - Roadhouse.dll (net8.0)
`

// Same run with one assertion in BandCoreTest broken (50.0 expected as 51.0); exit code 1.
export const DOTNET_REAL_FAIL = String.raw`  Determining projects to restore...
  All projects are up-to-date for restore.
  Roadhouse -> C:\work\Roadhouse-Game\.godot\mono\temp\bin\Debug\Roadhouse.dll
Test run for C:\work\Roadhouse-Game\.godot\mono\temp\bin\Debug\Roadhouse.dll (.NETCoreApp,Version=v8.0)
A total of 1 test files matched the specified pattern.
Error:
	Expecting:
	    '50'
	 in range between
	    '50.999999999' <> '51.000000001'
  Failed TheFirstRecruitCostsFifty [121 ms]
  Error Message:
   Expecting:
    '50'
 in range between
    '50.999999999' <> '51.000000001'
  Stack Trace:
     at Roadhouse.Tests.BandCoreTest.TheFirstRecruitCostsFifty() in C:\work\Roadhouse-Game\test\BandCoreTest.cs:line 15


Failed!  - Failed:     1, Passed:     3, Skipped:     0, Total:     4, Duration: 38 ms - Roadhouse.dll (net8.0)
`

// A filter that names no suite: exit code 0, and not a word about passing. The silent-absence shape Roadhouse's own README warns about.
export const DOTNET_REAL_NO_MATCH = [
  '  Determining projects to restore...',
  '  All projects are up-to-date for restore.',
  '  Roadhouse -> C:\\work\\Roadhouse-Game\\.godot\\mono\\temp\\bin\\Debug\\Roadhouse.dll',
  'Test run for C:\\work\\Roadhouse-Game\\.godot\\mono\\temp\\bin\\Debug\\Roadhouse.dll (.NETCoreApp,Version=v8.0)',
  'A total of 1 test files matched the specified pattern.',
  'No test matches the given testcase filter `FullyQualifiedName~NoSuchSuiteXyz` in C:\\work\\Roadhouse-Game\\.godot\\mono\\temp\\bin\\Debug\\Roadhouse.dll',
  '',
].join('\n')

// --- ava, REAL: ava 8.0.1 with tsx, Nano-Collective/nanocoder, Windows, 2026-10-09.
// `node node_modules/ava/entrypoints/cli.js <file>`. FAIL: a two-test probe file with one failing on purpose; PASS: source/config/preferences.spec.ts, middle lines cut.
export const AVA_REAL_FAIL = "\r\n  ✔ probe passes\r\n  ✘ [fail]: probe fails on purpose\r\n  ─\r\n\r\n  probe fails on purpose\r\n\r\n  source\\utils\\zz-dope-probe.spec.ts:3\r\n\r\n   2: test('probe passes', t => { t.is(1, 1); });              \n   3: test('probe fails on purpose', t => { t.is(1 + 1, 3); });\n   4:                                                          \r\n\r\n  Difference (- actual, + expected):\n\n  - 2\n  + 3\r\n\r\n  › <anonymous> (source/utils/zz-dope-probe.spec.ts:3:41)\r\n\r\n  ─\r\n\r\n  1 test failed\r\n"
export const AVA_REAL_PASS = "\n\npreferences.spec.ts\n  ✔ loadPreferences loads valid JSON file\n  ✔ loadPreferences returns empty object when file does not exist\n  ✔ loadPreferences returns empty object for invalid JSON\n  ─\n\n\n  112 tests passed\n"

// --- ava, REAL: nanocoder source/utils/path-validation.spec.ts on Windows before any change, 2026-10-09: 11 failures that were already there (POSIX paths, symlink EPERM). List lines only.
export const AVA_REAL_PREEXISTING = "\n  ✘ [fail]: security: rejects an in-project symlink whose target escapes Error thrown in test\n  ✘ [fail]: security: allows an in-project symlink that stays inside Error thrown in test\n  ✔ resolveFilePath: resolves real files within a real project root\n  ✔ resolveFilePath: containmentRoot lets a deep session cwd still reach the project root (sim regression)\n  ✔ isValidFilePath: accepts simple relative paths\n  ✔ isValidFilePath: accepts paths with special characters\n  ✔ isValidFilePath: rejects empty paths\n  ✔ isValidFilePath: rejects directory traversal attempts\n  ✔ isValidFilePath: rejects absolute Unix paths\n  ✔ isValidFilePath: rejects absolute Windows paths\n  ✔ isValidFilePath: rejects paths with null bytes\n  ✔ isValidFilePath: rejects home directory shorthand paths\n  ✔ isValidFilePath: rejects paths starting with separators\n  ✔ isValidFilePath: accepts Next.js dynamic route paths with brackets\n  ✔ isValidFilePath: accepts hidden files (starting with dot)\n  ✘ [fail]: resolveFilePath: resolves simple relative paths\n  ✘ [fail]: resolveFilePath: resolves nested paths\n  ✔ resolveFilePath: throws on invalid paths\n  ✔ resolveFilePath: prevents escape via path resolution\n  ✘ [fail]: resolveFilePath: ensures resolved path stays within project Resolved path should be within project\n  ─\n\n  11 tests failed\n"
// --- pytest, REAL: dapr-agents, the red run of tests/memory/test_liststore.py through uv, 2026-10-10. Header and summary lines as printed.
export const PYTEST_REAL_DAPR_RED = "============================= test session starts =============================\ncollected 4 items\n\ntests/memory/test_liststore.py FFF.                                     [100%]\n\n=========================== short test summary info ===========================\nFAILED tests/memory/test_liststore.py::test_messages_are_isolated_per_workflow_instance_id\nFAILED tests/memory/test_liststore.py::test_reset_memory_clears_only_that_id\nFAILED tests/memory/test_liststore.py::test_add_interaction_uses_given_id - A...\n======================== 3 failed, 1 passed in 16.14s =========================\n"

// --- Runners whose summary dope-tdd does not read yet: the output is recognised so the agent is told plainly once,
// instead of an "unread" on every run. Harvested from real runs on Linux, 2026-10-13: Node 22.22.0, mocha 10.7.3.

// `node --test a.test.mjs`, one pass and one fail, piped (Node then picks the TAP reporter) (real, tail).
export const NODE_TEST_TAP_FAIL = '  ...\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 108.156709\n'
// `node --test --test-reporter=spec a.test.mjs`, the summary lines (real).
export const NODE_TEST_SPEC_FAIL = '✖ fails (0.848479ms)\n  AssertionError [ERR_ASSERTION]: 2 == 3\nℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 101.115368\n'
// `npx mocha a.test.mjs` and `npx mocha b.test.mjs` (real).
export const MOCHA_FAIL = '\n\n  ✔ adds\n  1) fails\n\n  1 passing (4ms)\n  1 failing\n\n  1) fails:\n\n      AssertionError [ERR_ASSERTION]: 2 == 3\n      + expected - actual\n\n      -2\n      +3\n'
export const MOCHA_PASS = '\n\n  ✔ adds\n\n  1 passing (1ms)\n'
