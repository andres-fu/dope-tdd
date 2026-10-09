# 2026-10-08 — The red is the key, not the ceremony

## What was decided
A module unlocks for a source edit in two ways now, not one:

1. Claude touched its test in this session, as before.
2. Its own test was seen red in this session: a run that named the test
   file and failed, or a whole-suite run whose FAIL lines named it.

The deny names both doors: "write the failing test first. Touch
`tests/x.test.ts`, or run it and see it fail, before editing `src/x`." A
green run alone unlocks nothing. The unlock is remembered across sessions
like a touch is, and Claude reads "unlocked by a red run of its own test"
in the tool result.

A test re-saved with identical bytes still counts as a touch, and is now
also a recorded workaround, `touched unchanged`, said to Claude in the same
result: "a touch that changes nothing proves nothing; say why."

## Why
Tester zero's refactor step. The session had run the module's test against
the committed code and seen it fail, then pass, which is the evidence
test-first asks for, and the plugin refused the edit because nobody had
touched the test file in that session. The agent read the plugin's source,
understood the rule, and reached for a no-op re-save to satisfy it. The rule
was inviting the hollow touch it should have been catching.

The change costs no rigor. A "refactor" that changes behaviour still goes
red on the unchanged test at the next run, and the catch check still runs
on a fix: the unlock carries the test path, so the check knows which file
to run.

## What is left
- An editor save outside Claude is still invisible; only Claude's own
  tool calls and what git shows around them count.
- A red elsewhere does not unlock: only the module's own test, named in
  the command or in a FAIL line.
