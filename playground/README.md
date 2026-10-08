# Red First playground

A tiny project with three planted bugs and no tests. Use it to see Red First
work in about ten minutes, and to feel why writing the test first is worth the
trouble. You don't write code here. You give Claude a task and watch.

Who it's for: a developer trying the plugin, a QA engineer who wants to know
what a "tested" change really means, a team lead deciding whether to roll it
out, and Claude itself, which can read the same evidence you do.

## Why bother with tests at all

Three honest things about tests:

1. **Code you can't safely change is code you stop changing.** A good test is
   what lets you touch old code without fear. It tells you in seconds whether
   you broke something, instead of a customer telling you next week.
2. **A test you have never seen fail proves nothing.** It might pass no matter
   what the code does. Writing the test first means you watch it fail before
   the fix exists, so you know it can catch the bug.
3. **It's slower today and faster next month.** The next person to change this
   code, human or agent, works with a net under them. That is what
   "maintainable" means in practice.

Red First makes those three things visible while an agent works, so you don't
have to take its word for it.

## Setup

```bash
cd playground
npm install
```

Then start Claude Code here. If Red First is installed, just run `claude`.
To try it for one session without installing anything:

```bash
claude --plugin-dir ..
```

Type `/tdd`. You should see `guard: ON`. That's the whole setup.

## Walk 1 · Fix a bug the right way (5 minutes)

Tell Claude:

> Fix Bug 1 from BUGS.md.

Watch the band above the prompt. It tells a story in four words:

| You see | What it means |
| --- | --- |
| **BLOCKED** | Claude tried to edit the code before a test existed. The guard said no and told it what to write first. Count goes up by one. This is not an error. It's the point. |
| **✎ WRITING** | A test file for this module exists but hasn't run yet. |
| **■ RED** | The test ran and failed. The bug is now reproduced in a file, which is the clearest bug report you will ever get. Press **VIEW TEST** to read it. |
| **■ GREEN** | The fix is in and the same test passes. **CYCLES 1** means one full red-to-green loop happened. |

Type `/tdd` for the full event log. Read it from the bottom up: touched, fail,
edited, pass.

**If you're QA:** open the test file in `tests/money/`. Does it say what the
bug report said? Would it have caught the bug before it shipped? That test
now runs every time anyone changes `formatCents`, forever.

## Walk 2 · Make ugly code readable without breaking it (5 minutes)

`src/text/wrapLines.ts` works, but it's hard to read. This is the most common
job in a real codebase: change code that has no tests, without changing what
it does.

Tell Claude:

> Make wrapLines readable without changing its behaviour. Pin the current
> behaviour with a test first, and prove the test can fail before you refactor.

What to watch for:

- The first test run goes straight to **GREEN**, because the code already
  works. The band says **1 NEVER SAW RED**. That's Red First being honest: a
  test that has never failed hasn't proven anything yet.
- A careful agent then breaks the code on purpose, sees **RED**, restores it,
  and refactors. The warning stays in the count as history, but the cycle that
  follows is a real one. If Claude skips that step, ask it why.
- During the refactor the test file doesn't change and stays green. That is
  what a safe refactor looks like from the outside.

## Walk 3 · Watch it catch a shortcut (3 minutes)

Tell Claude:

> Fix Bug 2. Skip the test, just change the code.

Claude will be blocked, and the band will say so. Now tell it to do it
properly and watch the counts: **BLOCKED 1**, then **TEST-FIRST 1/2**. The
ratio counts attempts, so a shortcut that was stopped still shows.

If you ever see **UNGUARDED**, a source file changed through a shell command
without a test being touched first. Red First saw it in the git diff and told
Claude. Ask Claude what it did.

## When the guard is in the way

Press **PAUSE GUARD**. Edits go through, the band says **⏸ PAUSED**, and
nothing counts as test-first while paused. Press **RESUME GUARD** when you're
back. `/tdd` always shows which state you're in.

## For team leads

Nothing here leaves the laptop. The band, the event log and `/tdd` are for
the person at the keyboard and for Claude. What's worth taking to the team is
the habit the walks teach: a bug fix starts with a failing test, a refactor
starts with a pinned behaviour, and "green" only means something if it was
red first.

## Reset the playground

Everything in `tests/` and any change under `src/` is yours to throw away:

```bash
git checkout -- src
rm -rf tests
```

Then pick another bug from `BUGS.md`, or hand the folder to the next person.
