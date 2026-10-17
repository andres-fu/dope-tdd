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

// --- node --test, REAL: Node 24.13.0, Windows, 2026-10-16. A CommonJS probe shaped like VibeCast (test/helpers.test.js for helpers.js),
// captured through a pipe, so the default reporter is spec; the TAP runs pass --test-reporter=tap. Paths shortened.
// `node --test test/helpers.test.js`, exit 0.
export const NODE_TEST_REAL_PASS = "✔ adds (0.6471ms)\n✔ adds negatives (0.1147ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 89.1347\n"
// `node --test test/broken.test.js`, exit 1.
export const NODE_TEST_REAL_FAIL = "▶ add\n  ✔ passes (0.5537ms)\n  ✖ fails on purpose (0.7119ms)\n✖ add (2.2722ms)\nℹ tests 2\nℹ suites 1\nℹ pass 1\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 94.9944\n\n✖ failing tests:\n\ntest at test\\broken.test.js:6:3\n✖ fails on purpose (0.7119ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  \n  2 !== 3\n  \n      at TestContext.<anonymous> (C:\\Users\\dev\\vibecast\\test\\broken.test.js:6:41)\n      at Test.runInAsyncScope (node:async_hooks:214:14)\n      at Test.run (node:internal/test_runner/test:1106:25)\n      at Suite.processPendingSubtests (node:internal/test_runner/test:788:18)\n      at Test.postRun (node:internal/test_runner/test:1235:19)\n      at Test.run (node:internal/test_runner/test:1163:12)\n      at async Promise.all (index 0)\n      at async Suite.run (node:internal/test_runner/test:1518:7)\n      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {\n    generatedMessage: true,\n    code: 'ERR_ASSERTION',\n    actual: 2,\n    expected: 3,\n    operator: 'strictEqual',\n    diff: 'simple'\n  }\n"
// `node --test --test-reporter=tap test/helpers.test.js`, exit 0.
export const NODE_TEST_REAL_TAP_PASS = "TAP version 13\n# Subtest: adds\nok 1 - adds\n  ---\n  duration_ms: 0.6734\n  type: 'test'\n  ...\n# Subtest: adds negatives\nok 2 - adds negatives\n  ---\n  duration_ms: 0.1112\n  type: 'test'\n  ...\n1..2\n# tests 2\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 91.9084\n"
// `node --test --test-reporter=tap test/broken.test.js`, exit 1.
export const NODE_TEST_REAL_TAP_FAIL = "TAP version 13\n# Subtest: add\n    # Subtest: passes\n    ok 1 - passes\n      ---\n      duration_ms: 0.5551\n      type: 'test'\n      ...\n    # Subtest: fails on purpose\n    not ok 2 - fails on purpose\n      ---\n      duration_ms: 0.7388\n      type: 'test'\n      location: 'C:\\\\Users\\\\dev\\\\vibecast\\\\test\\\\broken.test.js:6:3'\n      failureType: 'testCodeFailure'\n      error: |-\n        Expected values to be strictly equal:\n        \n        2 !== 3\n        \n      code: 'ERR_ASSERTION'\n      name: 'AssertionError'\n      expected: 3\n      actual: 2\n      operator: 'strictEqual'\n      stack: |-\n        TestContext.<anonymous> (C:\\Users\\dev\\vibecast\\test\\broken.test.js:6:41)\n        Test.runInAsyncScope (node:async_hooks:214:14)\n        Test.run (node:internal/test_runner/test:1106:25)\n        Suite.processPendingSubtests (node:internal/test_runner/test:788:18)\n        Test.postRun (node:internal/test_runner/test:1235:19)\n        Test.run (node:internal/test_runner/test:1163:12)\n        async Promise.all (index 0)\n        async Suite.run (node:internal/test_runner/test:1518:7)\n        async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3)\n      ...\n    1..2\nnot ok 1 - add\n  ---\n  duration_ms: 2.356\n  type: 'suite'\n  location: 'C:\\\\Users\\\\dev\\\\vibecast\\\\test\\\\broken.test.js:4:1'\n  failureType: 'subtestsFailed'\n  error: '1 subtest failed'\n  code: 'ERR_TEST_FAILURE'\n  ...\n1..1\n# tests 2\n# suites 1\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 92.614\n"
// `node --test test/empty.test.js`, exit 0.
export const NODE_TEST_REAL_EMPTY = "✔ test\\empty.test.js (66.6921ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 74.3323\n"
// `node --test test/loaderr.test.js`, exit 1.
export const NODE_TEST_REAL_LOAD_ERROR = "node:internal/modules/cjs/loader:1424\n  throw err;\n  ^\n\nError: Cannot find module '../nope'\nRequire stack:\n- C:\\Users\\dev\\vibecast\\test\\loaderr.test.js\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1421:15)\n    at defaultResolveImpl (node:internal/modules/cjs/loader:1059:19)\n    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1064:22)\n    at Module._load (node:internal/modules/cjs/loader:1227:37)\n    at TracingChannel.traceSync (node:diagnostics_channel:328:14)\n    at wrapModuleLoad (node:internal/modules/cjs/loader:245:24)\n    at Module.require (node:internal/modules/cjs/loader:1504:12)\n    at require (node:internal/modules/helpers:152:16)\n    at Object.<anonymous> (C:\\Users\\dev\\vibecast\\test\\loaderr.test.js:1:1)\n    at Module._compile (node:internal/modules/cjs/loader:1761:14) {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: [\n    'C:\\\\Users\\\\dev\\\\vibecast\\\\test\\\\loaderr.test.js'\n  ]\n}\n\nNode.js v24.13.0\n✖ test\\loaderr.test.js (70.4077ms)\nℹ tests 1\nℹ suites 0\nℹ pass 0\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 77.9539\n\n✖ failing tests:\n\ntest at test\\loaderr.test.js:1:1\n✖ test\\loaderr.test.js (70.4077ms)\n  'test failed'\n"
// `node --test test/nope.test.js`, exit 1.
export const NODE_TEST_REAL_MISSING = "Could not find 'test/nope.test.js'\n"

// --- Runners whose summary dope-tdd does not read yet: the output is recognised so the agent is told plainly once,
// instead of an "unread" on every run. Harvested from a real run on Linux, 2026-10-13: Node 22.22.0, mocha 10.7.3.

// `npx mocha a.test.mjs` and `npx mocha b.test.mjs` (real).
export const MOCHA_FAIL = '\n\n  ✔ adds\n  1) fails\n\n  1 passing (4ms)\n  1 failing\n\n  1) fails:\n\n      AssertionError [ERR_ASSERTION]: 2 == 3\n      + expected - actual\n\n      -2\n      +3\n'
export const MOCHA_PASS = '\n\n  ✔ adds\n\n  1 passing (1ms)\n'

// Node 24.13 on Windows, a test file that logs emoji: the runner could not read its child process output, and reports
// the file as one failed test (seen in about two runs in three; the same lines in ASCII never do it). Log lines cut to three.
export const NODE_TEST_REAL_IPC_CRASH = "🎵🎶✅ 0\n🎵🎶✅ 🎵🎶✅ 0\n🎵🎶✅ 🎵🎶✅ 🎵🎶✅ 0\n✔ t0 (6.5493ms)\n✔ t1 (0.7035ms)\n✔ t2 (14.4571ms)\n✔ t3 (15.3093ms)\n✖ test\\sources\\youtube.test.js (107.5616ms)\nℹ tests 5\nℹ suites 0\nℹ pass 4\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 114.2529\n\n✖ failing tests:\n\ntest at test\\sources\\youtube.test.js:1:1\n✖ test\\sources\\youtube.test.js (107.5616ms)\n  Error: Unable to deserialize cloned data due to invalid or unsupported version.\n      at #processRawBuffer (node:internal/test_runner/runner:375:20)\n      at FileTest.parseMessage (node:internal/test_runner/runner:311:27)\n      at Socket.<anonymous> (node:internal/test_runner/runner:421:15)\n      at Socket.emit (node:events:508:28)\n      at addChunk (node:internal/streams/readable:559:12)\n      at readableAddChunkPushByteMode (node:internal/streams/readable:510:3)\n      at Readable.push (node:internal/streams/readable:390:5)\n      at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)\n"
