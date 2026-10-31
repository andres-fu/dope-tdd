# 2026-10-31: Work out what the project is, and say so

Status: decided 2026-10-31, for 0.2.16. Covers #268 and #257, and the notice in #259.

## The problem
A session decides what a project is from exact file names at its root (`detectStack`). With none of them there, it
assumes Node. So a folder of Python files with no `pyproject.toml` isn't guarded, and nothing says so: a `.py` edit isn't
code to the guard, isn't listed, and doesn't reach NOT WATCHING. A normal C# repo has `MyApp.sln` or `MyApp.csproj`, which
aren't on the list, so it looks the same. Go, Rust and Ruby repos are treated as Node too.

The better answer already exists. `/tdd setup` walks the repo and counts code files (`inferStack`, `inferLayout`), but
only when someone asks. The session also walks the repo already when there is no config, for the layout note (#167), and
throws away what it learned about the language. So the smart path and the path everyone gets are different.

## What is decided
**One answer, in this order:**

1. **Any `dope-tdd.json`, or a marker at the root when the session reads them, behaves exactly as it did.** Stack, layout
   and walk are unchanged.
2. **With no config and no marker, the repo decides.** A session reads the code files it finds, once per root, and uses
   that stack and layout from memory.
3. **If the repo can't decide, it says so.** The Node defaults still run then, and the note says that plainly.

**Three rules for a project that changes:**

- **Config wins.** Detection never edits or overrides a config.
- **An edit is the signal.** There is no watcher and no re-scan. An edit to code of any known stack that the config
  doesn't cover counts as unwatched (`isCodeFileAny`, where today only the configured stack counts).
- **Say it once.** One line per session, then quiet.

A session keeps the stack it starts with until `/tdd setup` looks again, as it always has. So a marker added mid-session
counts from the next session, and until then the repo's answer stands instead of the Node guess. A config counts as soon
as it is saved, because the config is read on every hook.

**Nothing is written without being asked.** The answer is used from memory, and the session offers `/tdd setup write`.
The README promises the config is only written on request, and that stays true.

**The test runner has one project answer.** A test that doesn't exist yet takes the project's runner (#257). A test that
exists keeps the runner its own file points at, because that is the one that can run it.

## What each case does
| Project | What happens |
|---|---|
| Valid config | As today, no walk |
| Valid config, code in a language it doesn't cover | That edit goes through, and is said once, with `/tdd setup` or `exempt` as the way out |
| No config, one clear language | Uses that stack, and the layout the repo shows when the default pairs nothing. Says so and offers to save. If nothing pairs, it says that instead |
| No config, marker missing | The code decides: Python files mean Python |
| `.cs` files and no marker | .NET: the code decides, so a C# repo needs no marker list. Beside other code too, in the notes and in what `/tdd setup` saves |
| Invalid config | As today: reported as broken, and the defaults apply |
| Empty repo, or only languages we can't name (Lua, shell) | Says it found no code it reads, that the Node defaults run and any other code isn't guarded. The next session reads what's there |
| Two languages, neither clearly the main one | Says it can't tell, that the Node defaults run and other code isn't guarded, and that `/tdd setup write` guards one stack, the one with the most code. A layout that pairs nothing is still said beside it |
| Mostly a language we don't read (Go, Rust, Ruby, PHP, Swift, Kotlin, C, C++, F#, and others) | Says it isn't read yet and isn't guarded. Any readable code beside it that the Node defaults leave out is named too, and that saving guards one stack |
| Worktree with no config committed | As no config, read from that worktree |
| Config that names a layout but no stack | As today |

"Clearly" means one stack holds at least three quarters of the code files. That number is a first guess, and tests pin
it so it can change on purpose.

## What this leaves out
Per-folder layouts, and a monorepo with a different stack in each folder. `/tdd setup` and `roots` remain the answer
there, and the session says so. A C# repo with its code in project folders (`MyApp/`, `MyApp.Tests/`) reads as .NET, but no
layout preset pairs that shape, so it is said to pair nothing until a config names it. The pull-request check doesn't read a project's code: it reads `dope-tdd.json` and the
markers, so a project with neither is Node to it until a config is saved. A language we don't read gets a clear message, not support. Adding one later means a
stack entry, a runner and reading its output. Go fits the pairing as it is (`foo_test.go` beside `foo.go`), so it is the
natural first addition. Rust often keeps unit tests inside the source file, so it needs its own design.

## What it costs
The walk is capped in depth and in code files, and skips dependency folders. A session with no named layout already
walks once, so this keeps it at one walk per root, plus one for a worktree with no config of its own.

Only a project with no config and no marker changes behaviour, and there the old answer was a guess. A comparison with
`release` covered band, briefing, edits, `/tdd`, `/tdd setup` and walks. All 14,280 sessions with a config or marker
matched in repos that sit still. So did 42,612 of 42,616 steps in sessions where a config, marker or file changed
part-way or `/tdd setup` ran. In the other 4 a marker was deleted and `/tdd setup write` then read the repo, which is the
new behaviour working as decided. The one difference left, a marker added mid-session, is decided above.

## How we'll know it works
Unit tests for the rules in `tests/setup.test.ts`, and for the wiring in `tests/layouts.test.tsx`. Two new live scenarios in `npm run live`:
Python with no marker, and a C# repo with only a `.sln`. Tester round 8B already plans to
observe the Python case on 0.2.14, which gives us the before.

## How to undo it
Revert the pull requests on `release`. This ships in three: the reading, the edit-time notice (#259), and the runner (#257). The session goes back to markers and Node, and nothing is left behind.
