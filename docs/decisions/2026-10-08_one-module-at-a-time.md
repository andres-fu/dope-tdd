# 2026-10-08 — One module at a time, and failing the documented way

## What was decided
The second architect review (`docs/reviews/2026-10-08_architect-review-2.md`)
found that every verdict word was computed from cycle-global fields, so a red
on module A could be charged to module B. This pass pays its top items:

1. **Per-module state.** `TddStats.modules[module]` holds `{ phase,
   cycleStartMs, sawRed, testTouchedAfterRed, everSawRed, editedSinceRun }`.
   The band shows one module, so the global phase fields mirror the current
   one; every verdict (SAW RED, NEVER SAW RED, TEST CHANGED, refactor) is
   computed from the module's own record. `/tdd` gains `also open: b (red)`
   when another module has a cycle open. A change is a refactor only while
   that module is green on a test that has failed before, so an unlock
   inherited from yesterday is checked, never credited.
2. **"Unverified: change not captured."** The git backstop saw an edit
   (`git apply`, `Copy-Item`, a formatter) that the text capture did not:
   the agent reads that reason instead of silence.
3. **Lock before journal, journal per module, keep what is left behind.**
   A check that loses the lock never touches another check's journal. A file
   left alone after an interrupted check keeps the agent's text beside it as
   `<file>.dope-tdd.kept`, named in the toast, so no change is ever only in
   the log.
4. **Repair on the next tool call**, not only at session start, so a hot
   reload mid-check does not leave a file reverted for a session.
5. **A runner that could not start is not a timeout.** `runFailure` reads the
   rejection's words, whatever shape they arrive in.
6. **A test run while a file is reverted is refused**, so it cannot mint a red
   from the reverted text.
7. **Hold text counts as never-ran** with or without the error flag.
8. **An unreadable file before an edit** is recorded as a change with that
   reason, so the catch check says "unverified" instead of nothing.

## Failing the documented way
`claude plugin validate` lists each gating hook as `without .catch`. The mods
docs (React to events, "Handle a hook that fails") say a hook that throws,
overruns its budget or answers a wrong shape is skipped, and a `.catch`
handler on the registration answers in its place; `next.called` says whether
the guard had already called `next`, and `next(e)` then replays without
running the tool twice. The hand-rolled `safely` wrapper covered only throws.
Each gating hook now carries `.catch`: the call goes through once, the log
names the guard and `next.error.kind`, one toast per load says it happened,
and the status tool answers with the failure. Fail open stays the choice: the
guard is a gauntlet for the agent, not a lock on the user, and a silent skip
would be the one thing it must never do.

## Why
A false TEST CHANGED or a false REFACTOR across modules is the biggest risk
the review named: the product's one promise is that its words are true, and
these were wrong in the brownfield flow it exists for (two modules, one
inherited unlock). The docs alignment is cheaper than the wrapper it replaces
and covers two failure kinds the wrapper could not.

## What is left
On the ledger with the `arch2` and `docs` tags: honest unread wording per
runner, catch-check opt-out, pending modules after a whole-suite run, shell
cwd drift, `/clear` re-seeding, the non-atomic write, REFACTOR colour, and the
publish checklist (version bumps, `repository`, LICENSE, an eval suite).
