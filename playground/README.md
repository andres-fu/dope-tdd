# Dope TDD playground

A tiny project with three planted bugs and no tests. Use it to see Dope TDD
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
3. **Green is not the finish line.** Test-driven development has three steps:
   red, green, refactor. Once the test passes, you clean the code up: better
   names, smaller functions, no duplication. The test is what makes that
   safe. Skip the third step and the codebase gets worse one fix at a time.
4. **It's slower today and faster next month.** The next person to change this
   code, human or agent, works with a net under them. That is what
   "maintainable" means in practice.

Dope TDD makes those four things visible while an agent works, so you don't
have to take its word for it.

## Setup

```bash
cd playground
npm install
```

Then start Claude Code here. If Dope TDD is installed, just run `claude`.
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

**Now the third step.** Tell Claude:

> The test is green. Clean up formatCents: clear names, no duplication, nothing
> clever. Keep the test green and don't touch it.

Watch two things: the band stays **GREEN** across the cleanup, and the test
file's **UPDATED** time doesn't move. Code changed, behaviour didn't, and you
didn't have to read the diff to know that. This is the step most people skip
and the one that keeps a codebase healthy.

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
  works. The band says **1 NEVER SAW RED**. That's Dope TDD being honest: a
  test that has never failed hasn't proven anything yet.
- A careful agent then breaks the code on purpose, sees **RED**, restores it,
  and refactors. The warning stays in the count as history, but the cycle that
  follows is a real one. If Claude skips that step, ask it why.
- During the refactor the test file doesn't change and stays green. That is
  what a safe refactor looks like from the outside.
- Read the result. Single-letter names should be gone, the loop should say
  what it does, and it should need no comments to follow. If it still looks
  like the original with new variable names, ask Claude to go further.

## Walk 3 · Watch it catch a shortcut (3 minutes)

Tell Claude:

> Fix Bug 2. Skip the test, just change the code.

Claude will be blocked, and the band will say so. Now tell it to do it
properly and watch the counts: **BLOCKED 1**, then **TEST-FIRST 1/2**. The
ratio counts attempts, so a shortcut that was stopped still shows.

If you ever see **UNGUARDED**, a source file changed through a shell command
without a test being touched first. Dope TDD saw it in the git diff and told
Claude. Ask Claude what it did.

## When the guard is in the way

Two honest answers, in order of preference:

1. **Make the exception explicit.** A `dope-tdd.json` in the project root
   can exempt files that have no business being unit tested (an entry file,
   generated code) or switch the guard to `warn` mode, where nothing is
   denied but every untested edit is counted and Claude is told what to write
   next. Both show up in `/tdd`, so the exception is on the record. This is
   how you bring the guard into an old codebase: `warn` everywhere, `enforce`
   in the area you're reclaiming.
2. **Pause, briefly.** Press **PAUSE GUARD**. Edits go through, the band says
   **⏸ PAUSED**, and nothing counts as test-first while paused. Press
   **RESUME GUARD** when you're back. A pause is for a spike you'll throw
   away, not for a file you'd rather not test.

## What "clean" means here

Four rules, in order, from Kent Beck. Code is clean when it:

1. passes all the tests;
2. says what it means, so the next reader doesn't have to guess;
3. has no duplicated knowledge, so a change happens in one place;
4. has nothing it doesn't need.

Plus one habit: leave every file a little cleaner than you found it. That is
the whole hygiene routine. Dope TDD can't judge a name, but it can show you
that the tests stayed green and untouched while the cleanup happened, which is
the proof that the cleanup was safe.

## For team leads

Nothing here leaves the laptop. The band, the event log and `/tdd` are for
the person at the keyboard and for Claude. What's worth taking to the team is
the habit the walks teach: a bug fix starts with a failing test, a refactor
starts with a pinned behaviour, "green" only means something if it was red
first, and the work isn't done until the code is cleaner than before.

## Reset the playground

Everything in `tests/` and any change under `src/` is yours to throw away:

```bash
git checkout -- src
rm -rf tests
```

Then pick another bug from `BUGS.md`, or hand the folder to the next person.
