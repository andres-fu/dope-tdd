# 2026-10-08 — Workarounds on the record

## What was decided
Ways around the guard are not denied; they are recorded, counted, shown, and
said to the agent in the same tool result with a request to say why. Six
kinds, each an event with its detail:

1. **config loosened**: `dope-tdd.json` moved to a weaker mode, gained an
   exemption, or got a scope that leaves more out. A tightening is logged but
   not counted.
2. **paused**: the PAUSE GUARD button. Resuming is logged, not counted.
3. **test changed**: red, then the test edited, then green with the module's
   code unchanged (from the honesty pass).
4. **skipped**: a test edit added `.skip`, `.only`, `.todo` or an `xit`-style
   marker. Detail: how many.
5. **assertions removed**: a test edit lowered the number of assertion calls.
   Detail: before → after.
6. **commented out**: a source edit turned lines of code into `//` comments.
   Detail: how many lines (a line that is still code elsewhere in the file,
   such as a closing brace, is not counted).

`/tdd` has `workarounds: N (kind n, ...)`, the band says `N WORKAROUNDS`,
`/tdd why` explains the word. The agent reads, for example:
`dope-tdd: tests/money/formatCents.test.ts gained 1 skip/only marker. A
skipped test guards nothing. Recorded; say why in your reply.`

## Why
The owner: track gaming and workarounds, malicious or not. Uncle Bob's point
in the Pocock interview: agents treat written rules as guidelines, and a
gauntlet with a silent side door is not a gauntlet. The owner also wants the
agent able to touch settings, so the answer is a record and a reason, not a
deny. The lines are dry on purpose; the request "say why in your reply" is
the mechanism that turns a workaround into something the person can read.

## Alternatives considered
- Denying skip markers and config edits outright: rejected; there are honest
  reasons for both, and a deny hides the reason.
- Counting every config edit: rejected; tightening is not a workaround.
- A smarter commented-out detector (block comments, moved lines): deferred;
  line comments cover what an agent does in a hurry.

## Trade-offs accepted
- Test edits made through the shell have no before-text, so skip and
  assertion signals only come from Edit and Write.
- Assertion counting is a regex over the file; a custom assertion helper is
  invisible to it (the same limit as the hollow-test line).
- Six kinds is a list, not a taxonomy; the next one found in a live run gets
  added the same way.
