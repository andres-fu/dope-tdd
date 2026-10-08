# 2026-10-08 — The agent is told, in its tool results

## What was decided
The agent is the primary user of the evidence; the band is for a human who
is pairing. So after each of three moments the hook appends one line to the
tool result's context, which the model reads and the user never sees:

- a test touched (Edit or Write): `red-first: <module> unlocked. Run its
  test and see it fail before editing src/<module>.`
- a failing run: `red-first: RED on <module>. Make it pass with the smallest
  change, then run it again.`
- a passing run that completes a cycle: either `GREEN on <module>, saw red.
  Now refactor with the test untouched.` or `GREEN on <module> but it never
  saw red. Break the code on purpose and run again to prove the test can
  fail.`

A pass that completes no cycle says nothing. Nothing is said while paused.
The lines attach to error results too (a failing run usually is one).

## Why
The owner: "you need to be in the know; the UI is just a visual to show
helpful stuff to the user if they are there and want to use you to pair."
In the live runs the agent only read the status when told to; the band is
invisible to it. Each line names the next step of red, green, refactor, so
the practice is coached at the moment it applies instead of in CLAUDE.md.

## Alternatives considered
- A reminder on every tool call: noise; the model would learn to skip it.
- Only the status tool: the agent has to think to call it, and in practice
  did not.

## Trade-offs accepted
- One extra line of context per touch and per run.
- The wording is fixed in `hooks/advice.ts`; teams cannot change it yet.
