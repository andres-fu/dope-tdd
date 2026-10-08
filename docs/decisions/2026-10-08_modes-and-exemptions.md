# 2026-10-08 — Guard modes, scope and exemptions in a repo file

## What was decided
An optional `red-first.json` at the repository root, read on every guarded
call, with three fields:

- `mode`: `enforce` (default, today's behaviour), `warn` (never deny; an
  untested source edit is counted as unguarded and Claude is told "write
  tests/X.test.ts next and see it fail"), `observe` (never deny, count
  everything, say nothing to Claude, for a baseline).
- `scope`: path globs; when set, the mode applies inside them and every
  other source path is observed.
- `exempt`: path globs the guard neither blocks nor counts (entry file,
  generated code). They are skipped before any accounting.

Resolution per source path: exempt, then out of scope (observe), then the
mode. Shell writes follow the same policy, before the call (deny only under
enforce) and after it (the git backstop skips exempt paths and stays silent
for observed ones). The catch check, the unlock memory and the hollow-test
line run in every mode; `observe` only silences what Claude is told. `/tdd`
and the status tool print `mode: ... in <scope>`, `exempt: ...`, and
`config: red-first.json: <reason> (using defaults)` when the file is broken,
so an exception is always on the record. Globs: `**` crosses directories,
`*` stays within one, exact paths match themselves.

## Why
"It's gameable and it annoys on legitimate non-test work: config, a spike,
the entry file. That's why it got paused on throughline." The owner's answer:
"we don't want it gamed, we want good code." A pause hides edits; an
exemption or a mode is explicit and visible. Scope is the brownfield story:
warn everywhere, enforce in the area being reclaimed.

## Alternatives considered
- The plugin manifest's `userConfig`: per-user settings in the `/config`
  menu. Right for personal preferences, wrong for rules a team shares
  through the repo. It can hold personal defaults later.
- Pause as the only escape hatch: what dogfooding showed does not work.
- Pattern rules in code (Probity-style): more expressive, more to learn;
  three fields cover the cases seen so far.

## Trade-offs accepted
- One small file read per guarded call (no cache), so an edit to the file
  takes effect immediately.
- Out-of-scope paths are observed, not warned; a team that wants nudges
  everywhere sets `mode: warn` and no scope.
- The glob matcher is minimal: no brace sets, no negation.
