# 2026-10-08 — Unlocks remembered across sessions; hollow tests called out

## What was decided
1. **A test touch is remembered per repository for seven days.** Each touch
   (Edit, Write, or a shell write seen by the git backstop) writes
   `{ testPath, atMs }` under `unlocks:<root>` in the plugin's store. At
   `session.start` the entries whose test file still exists and are younger
   than seven days seed the session's unlocked map and are marked
   *inherited* with their timestamp.
2. **The agent gets the history once.** The first allowed source edit of an
   inherited module appends: `src/<module> is unlocked because
   <test> was touched 2H AGO in an earlier session. Run that test first if
   you have not this session.` `/tdd` and the status tool list every
   inherited unlock with its age for as long as the session lasts. A fresh
   touch in this session supersedes the inherited mark.
3. **A touched test with no assertion is called out.** On an Edit or Write
   to a test file, the file is read and matched for `expect(`, `assert`,
   `.should`; if nothing matches, the agent is told: `<test> has no
   assertion. A test that asserts nothing passes no matter what the code
   does.` Advisory, never blocking, no count yet.

## Why
The owner's two concerns of the day: "it forgets between sessions, which
punishes the right behaviour", and "it can't tell a good test from a hollow
one, this worries me". Memory removes the most annoying false block the
agent hits. The assertion check is the cheap first layer against hollow
tests; the catch check (revert the change, expect the test to fail) is the
real layer and is next.

## Alternatives considered
- Treat "test newer than source" by mtime as unlocked: no store needed, but
  a fresh clone has arbitrary timestamps and nothing to tell the agent.
- Unlock forever once touched: the gaming vector the owner wants closed;
  seven days is long enough for a week of work and short enough that a
  stale test does not unlock a module for a quarter.
- Judge test quality with a model: Probity's approach; non-deterministic
  and slower. Deterministic checks first.

## Trade-offs accepted
- One store read and write per touch; one read at session start.
- The store key is the absolute root path, so a moved checkout starts fresh.
- The assertion regex is a heuristic for JS/TS test idioms; a custom
  matcher library could be flagged wrongly, which is why it only advises.
