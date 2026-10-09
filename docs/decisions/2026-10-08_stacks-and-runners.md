# 2026-10-08 — Stacks and runners as tables

## What was decided
A language is a row in `hooks/stacks.ts` and the way its tests run is a row
in `hooks/runners.ts`. The hooks module reads both tables and knows no
language by name.

A **stack** says what a language is: the extensions `{ext}` accepts in a
layout template, how a test file is named, the layout presets and the
default, the file at a project root that identifies the project
(`project.godot`, `pom.xml`, `package.json`, `pyproject.toml`, ...), and the
paths the guard leaves alone (`addons/**` in a Godot project).

A **runner** says how its tests get run and read: the files that say it is
installed, the programs that run it (a venv's python, `mvnw`, `gradlew`) with
a fallback on PATH, the command line for one test file, the shape of a shell
command that runs it, the reader for its summary, and the test files it
named as failed. `readRun` asks every reader; the first that recognises the
output decides.

The stack is named in `dope-tdd.json` (`"stack": "python"`), else detected
from the root's files once per session, else Node. `/tdd setup` detects it
the same way and scores a stack's layout presets by how many test files pair
with a source that exists, so a package with mirrored tests reads as
`package` and a `src/` project as `mirror`.

Rows today:

| Stack | Runner | Reader written from | Layouts |
| --- | --- | --- | --- |
| node | vitest, jest | real output (since the first pass) | mirror, colocated, `__tests__` |
| python | pytest | real output, pytest 9.1.1, 2026-10-08 | mirror, package, colocated |
| godot | gdunit4 | the reporter's format strings in its source; **provisional** | godot, godot-src, godot-pascal |
| java | maven, gradle | documented formats; **provisional** | maven |
| dotnet | dotnet test | documented formats; **provisional** | dotnet |

A provisional reader is replaced the first time a real run is on record.
The gdUnit4 row runs the suite headless through the command-line tool with
the debugger kept off, as gdUnit4's own wrapper does, on the binary named by
`godot` in the config, else `GODOT_BIN`, else `godot` on PATH.

## Why
The first tester who is not us builds a Godot game with gdUnit4 and a
Python pipeline. Before this pass the runner names, the summary regex, the
extension pattern and the test-file rule were each hard-coded in a different
file, and reaching him meant touching all of them. Now it means two rows, a
fixture, and a test; the .NET row is there largely to prove that holds.

## What is left
- gdUnit4, Maven, Gradle and dotnet readers against real output (the
  roommate's game first).
- A truly flat Python `tests/` folder (`tests/test_mod.py` for `pkg/mod.py`)
  needs a lookup from a survey; today the package dirs must mirror.
- C# under Godot, Kotlin under Gradle, GUT as a second Godot runner.
- `/tdd setup` offering observe mode to a newcomer.

## Update, 2026-10-09: pairing by name
A layout may pair `by name`: the module is the file's basename, so
`scripts/show/BeatDeck.cs` and `test/BeatDeckTest.cs` meet at `BeatDeck`
wherever each sits, with no index to maintain. Presets: `flat` for Node
(`test/{name}.test.ts`) and Python (`tests/test_{name}.py`), `godot-flat`
and `godot-csharp` for Godot. The Godot stack now takes `.cs` as code, and
the runner for a catch check is chosen by the test file's extension, so a
C# test in a Godot .NET project runs through `dotnet test` (which needs no
marker file) and a GDScript one through gdUnit4. Setup scores a name-paired
preset by how many tests share a basename with a source. Known limit: two
sources with the same basename in different folders collapse into one
module; tests named after a feature rather than a class (Roadhouse's
`BandCoreTest` tests `RecruitCost`) pair with nothing and unlock nothing.
