# 2026-10-06 — TDD guard mod for Claude Code sessions

## What was decided
A Claude Code session mod, `tdd-guard`, enforces the CLAUDE.md test-first rule:
an Edit/Write to `src/**/X.ts(x)` is denied unless the mirrored
`tests/**/X.test.ts(x)` was written or edited earlier in the same session.
A band above the prompt shows the cycle: red/green from the last Vitest run,
run pass/fail counts, test-first ratio of source edits, and blocked-edit count.

## Why
The three-phase rule depends on discipline; a guard makes "test first" the
path of least resistance and the band makes the cycle visible while pairing.

## Alternatives considered
- Requiring a failing Vitest run before any source edit — more faithful
  red-green, but brittle to detect from command output.
- Warn-only — no friction, but easy to ignore.
- A side pane with per-file history — richer, more code than the value it adds.

## Trade-offs accepted
- Touching a test counts as "red" even if the test was not run.
- `src/main.tsx` and files without a mirrored test are blocked until a test
  exists for them; non-`src/` files (docs, config, tests) are never blocked.
- The mod lives outside the repo (session dev-mods folder), so it is per-machine.
