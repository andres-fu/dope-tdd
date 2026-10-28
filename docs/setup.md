# Setting up a project

Where Dope TDD looks for your tests, how to change that, and which languages it reads. `/tdd setup` does most of this for you.

## Where your tests live

Out of the box Dope TDD pairs `src/<module>.ts` with `tests/<module>.test.ts`
in a Node project, `src/pkg/calc.py` with `tests/pkg/test_calc.py` in a Python
project, and `scripts/player.gd` with `test/scripts/player_test.gd` in a Godot
project, which is gdUnit4's own rule. The project's root files say which it is
(`package.json`, `pyproject.toml`, `project.godot`, `pom.xml`); `"stack"` in
`dope-tdd.json` pins it. If your tests sit elsewhere, say so once:

```json
{ "layout": "colocated" }
```

`mirror` (the default), `colocated` (`src/a.test.ts` next to `src/a.ts`),
`__tests__` (`src/__tests__/a.test.ts`), or your own pair of templates:

```json
{ "layout": { "source": "lib/{module}.{ext}", "test": "spec/{module}.spec.{ext}" } }
```

With no `dope-tdd.json`, Dope TDD looks once at the start of a session: if
the default layout matches none of the project's code, nothing would ever be
refused, so Claude is told so, with the layout `/tdd setup` finds (for
example `colocated` under `site`), and asks you to run `/tdd setup`.

A monorepo adds `"roots": ["packages/*"]` and each package is its own project.
One `dope-tdd.json` guards one stack: in a repository with a Python backend
and a React frontend, pick the stack you want guarded and list the other
half in `exempt` (`"exempt": ["frontend/**"]`).
A folder whose tests sit differently from the rest names its own layout, with
templates that start inside the folder:

```json
{ "layout": { "source": "{module}.{ext}", "test": "test/{module}.test.{ext}" }, "layouts": { "dashboard": "colocated" } }
```

Here `dashboard/src/lib/a.ts` pairs with `dashboard/src/lib/a.test.ts`, a
refusal names that file, and everything outside `dashboard/` keeps the main
layout. The deepest folder wins; `roots` do not apply inside one.
Not sure? `/tdd setup` reads the repo and shows the stack and layout it finds,
the command a test runs with (`test command: python -m pytest <test file>`),
and the JSON to use; `/tdd setup write` saves it.

## Languages

Node is supported. The other stacks are **experimental**: the guard, the
runs and the counts work, but their catch check has no throwaway copy and
would undo your change on disk for one test run, so it stays off until
`"catchCheck": true` is in `dope-tdd.json`; until then a green there is
UNPROVEN · not checked, and says why.

| Stack | Runner for the catch check | Summary reader | Layout presets |
| --- | --- | --- | --- |
| Node | Vitest, Jest, ava from `node_modules`; Node's built-in runner (`node --test <file>`) when a `test` script in `package.json` runs `node --test` | from real output (`node --test`: spec and TAP reporters) | `mirror`, `colocated`, `__tests__`, `flat` |
| Python (experimental) | pytest, through the project's venv when there is one, when a pytest config, a requirements file or Pipfile that lists pytest, or a test written for pytest says so; Python's own `unittest` otherwise | from real output | `mirror`, `package`, `colocated`, `flat` |
| Godot 4 (experimental) | gdUnit4 for GDScript, headless, on `godot` in `dope-tdd.json`, else `GODOT_BIN`, else PATH (reader provisional); `dotnet test` for C# (read from a real Roadhouse run) | mixed | `godot`, `godot-src`, `godot-pascal`, `godot-flat`, `godot-csharp` |
| Java (experimental) | Maven, Gradle | provisional | `maven` |
| .NET (experimental) | `dotnet test` | from real output | `dotnet` |

Presets named `flat`, `godot-flat` and `godot-csharp` pair **by name**: the module is the
file's basename, so `scripts/show/BeatDeck.cs` and `test/BeatDeckTest.cs`
meet at `BeatDeck` wherever each sits. Your own templates can do the same
with `"pairing": "name"` and a `{name}` token on the test side. The runner
for the catch check is chosen by the test file's extension, so a C# test in
a Godot project runs through `dotnet test` and a GDScript one through gdUnit4.

A provisional reader was written from the runner's own source or docs, not
from a run, and is replaced the first time a real run is on record. Until
then a run it cannot read is reported as unread, never guessed. Adding a
language is a row in `hooks/stacks.ts`, a row in `hooks/runners.ts`, a
fixture of real output and a test; the hooks module reads the tables and
knows no language by name.
