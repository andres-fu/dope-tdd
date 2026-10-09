# Dope TDD

**D.O.P.E.** Deny, Observe, Prove, Evidence.
*Don't overdub, prove every bar.*

The TDD companion for Claude Code. It **denies** a source edit until its test
exists, **observes** every edit and every run, through the shell too,
**proves** that each test catches the change it guards by undoing the change
and running the test, and keeps the **evidence** where you and Claude can
both read it. The motto: in the studio an overdub covers a bad take instead
of recording it again; bending a test until it passes is the overdub, and
the catch check hears it. Every bar is every change.

It is a Claude Code mod, so it runs inside Claude Code, in the path of every
Edit, Write and shell call. An edit to untested source is refused before it
happens, not flagged after. A test run's result is held until the catch check
has reverted the change, run the test and restored it, so the line Claude
reads back carries the verdict. A rule in CLAUDE.md is advice Claude can
forget or argue with; this is a gate it has to pass, and every refusal says
why, so it can.

## What it enforces

It stands in the path of four tools: Edit, Write, Bash and PowerShell. At
each moment it decides before the action runs:

| Claude is about to... | Dope TDD... | Word |
| --- | --- | --- |
| Edit untested source | Refuses, names the test to write first | BLOCKED |
| Touch a test | Unlocks the module; see it fail first | WRITING |
| Run the module's own test and see it fail | Unlocks it too: the red is the evidence a touch stands for | RED |
| Run the tests | Reads the runner's summary, not the exit code | RED, GREEN |
| Go green without a red | Says the test has proven nothing yet | NEVER SAW RED |
| Go green after red | Reverts, runs that test, restores, attaches the verdict | CAUGHT, MISSED |
| Bend the test, skip, comment out, loosen config | Counts it and asks why | WORKAROUNDS |

The mechanism is the one Anthropic describes under
[Guard or change a tool call](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call);
`claude plugin validate .` prints the actions it steps into. The full table,
with what you see on each surface, is in `docs/testers.md`.

`/tdd` prints the state, `/tdd why` the words, `/tdd setup` the layout it
detects, and `/tdd receipt` the receipt for the current module with the two
commands a reviewer runs to re-check the proof without the plugin, ready to
paste into a pull request.

Status: private prototype, being dogfooded on throughline. See `DOGFOOD.md`
and `docs/decisions/`. Product brief: https://claude.ai/code/artifact/558d3bb2-c32c-4b7f-94e2-f3099742469d

## Install

From GitHub (the repository is private for now, so you need access to it):

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

Or from a clone, which loads the folder in place so edits apply live:

```bash
claude plugin marketplace add C:/path/to/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

Requires Claude Code v2.1.287+. The hooks run everywhere the plugin loads.
The band above the prompt draws in the terminal and in the Desktop app's Code
tab; in the VS Code extension's chat panel nothing draws, so there the
evidence is in the tool results, `/tdd` and the status tool.

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

A monorepo adds `"roots": ["packages/*"]` and each package is its own project.
Not sure? `/tdd setup` reads the repo and shows the stack and layout it finds
with the JSON to use; `/tdd setup write` saves it.

## Languages

| Stack | Runner for the catch check | Summary reader | Layout presets |
| --- | --- | --- | --- |
| Node | Vitest, Jest | from real output | `mirror`, `colocated`, `__tests__`, `flat` |
| Python | pytest, through the project's venv when there is one | from real output | `mirror`, `package`, `colocated`, `flat` |
| Godot 4 | gdUnit4 for GDScript, headless, on `godot` in `dope-tdd.json`, else `GODOT_BIN`, else PATH (reader provisional); `dotnet test` for C# (read from a real Roadhouse run) | mixed | `godot`, `godot-src`, `godot-pascal`, `godot-flat`, `godot-csharp` |
| Java | Maven, Gradle | provisional | `maven` |
| .NET | `dotnet test` | from real output | `dotnet` |

Presets named `flat` and `godot-csharp` pair **by name**: the module is the
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

## Try it in ten minutes

`playground/` is a tiny project with planted bugs and no tests. Its
[README](playground/README.md) walks a newcomer, a QA engineer or a team lead
through fixing a bug test-first, pinning behaviour before a refactor, and
watching the guard stop a shortcut. It doubles as the plugin's live test
fixture.

## How it decides

- `src/**/X.ts(x)` can't be edited (Edit, Write, or a shell write) until
  `tests/**/X.test.ts(x)` was created or edited in this session.
- Phases: idle → WRITING (test touched) → RED (a run reported failures) →
  GREEN (a run passed). A run is a `vitest`, `jest`, `npm test`-style command
  at the start of a shell command; its result is read from the runner's own
  summary line, not the exit code.
- After every shell command, `git diff` under `src/` and `tests/` is the
  source of truth: source files changed without a test touched count as
  unguarded, and tests written through the shell count as touched.
- The project must be a git repository; without one the shell backstop
  records nothing.

## What the band says

Above the prompt, three rows: the phase (WRITING, RED, GREEN, PAUSED, IDLE)
with the run trail; the current module with its verdict (SAW RED or NEVER
SAW RED, then CAUGHT, MISSED, UNVERIFIED or REFACTOR from the catch check);
and the session tally. `/tdd why` explains every word, `/tdd` prints the
full status and event log, and Claude reads the same lines in its tool
results as it works.

## Settings, checked into the repo

An optional `dope-tdd.json` at the repository root sets how strict the guard
is and where. Every setting shows in `/tdd`, so nothing is hidden.

```json
{
  "mode": "warn",
  "scope": ["src/billing/**"],
  "exempt": ["src/main.tsx", "src/generated/**"]
}
```

- `mode`: `enforce` (default) denies a source edit until its test is
  touched; `warn` allows it, counts it as unguarded, and tells Claude what to
  write next; `observe` allows it, counts it, and says nothing, for a
  baseline before a team turns the guard on.
- `scope`: when set, the mode applies only inside these paths and everything
  else is observed. This is how to bring the guard into one area of an old
  codebase at a time.
- `exempt`: paths the guard never touches or counts, such as an entry file
  or generated code. Prefer this to pausing; a pause hides edits, an
  exemption is on the record.

Everything else, including the catch check and the evidence, runs in every
mode. Modes only decide whether an edit is denied and whether Claude is told.

## Develop

```bash
claude plugin test .
claude plugin validate .
```

Tests live in `tests/`; the hooks module is `hooks/register.tsx`, with the
logic in small pure modules beside it.

## Try it, and tell us

Testers start at `docs/testers.md`. Report with the **Tester report** issue
template; the one moment the plugin was wrong, silent or annoying is the most
useful thing you can send.

## License

MIT. Copyright (c) 2026 Andres Fuentes. See `LICENSE`.
