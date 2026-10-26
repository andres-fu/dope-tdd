# dope-tdd 0.2.4: three fixes from dogfooding, and what to check

0.2.4 is exactly the build this note describes. It fixes three bugs we found using dope-tdd on our own
repositories and on an Astro site. One of them changes how a whole-suite run is read, so please read
the first item even if you don't try the steps.

## What 0.2.4 changes

- **#165: a whole-suite red is no longer charged to the module you're on unless the output says so.**
  Before, a full suite with failures in *other* modules, cut down to its totals (for example
  `npm test > out.txt; grep ...` or `| tail -3`), turned the open module RED, even right after it was
  proven. Totals alone can't say which file failed. Now, for runners that normally list the files
  that failed (Vitest, Jest, node --test, pytest), such a red is a red elsewhere: the open module
  keeps its phase. **What this means for you:** to see your module's own red, run its own test file
  (the start-of-session text already says to). Maven and Gradle pick their test by class name and
  never list files, so their reds still count as the module's.
- **#167: no `dope-tdd.json` and tests beside your sources.** If the default layout
  (`src/x.ts` ↔ `tests/x.test.ts`) matches none of your code, nothing would ever be refused, and before
  this nothing said so. Now Claude is told at the start of the session, with the layout `/tdd setup`
  finds, and asks you to run `/tdd setup`. It does not switch layouts on its own: saving still waits
  for `/tdd setup write`.
- **#168 (part): "see the log" is gone.** When the catch check's throwaway copy can't run the test,
  the UNPROVEN reason now names the step that failed. The copy running your test differently from
  your own run (a nested package, a generated Vite config) still happens; that half of #168 is open.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.4`. If it doesn't, stop there and tell us what it says.

**Step 1: #165, in a project whose suite has a failure outside the module you're working on.**
1. Unlock a module and get it green on its own test file.
2. Run the whole suite cut down to its totals, for example `npm test 2>&1 | tail -3` (Vitest) or
   `npm test > out.txt 2>&1; grep -E "^ℹ (tests|pass|fail)" out.txt` (node --test).
3. Expect the band's last run to read `failed, the output did not say where · not this module`, and
   Claude to be told `dope-tdd: RED, but not on <module>: a file the output did not name failed;
   <module>'s own test did not fail this run.` The module should still show its green.

**Step 2: #167, in a project with tests beside their sources and no `dope-tdd.json`.** Move
`dope-tdd.json` aside if you have one, and start a fresh session. Ask Claude what dope-tdd told it
at the start. Expect a line beginning `The default layout matches none of this project's code, so no
edit is refused until a dope-tdd.json is saved`, naming the layout `/tdd setup` finds. Put your
`dope-tdd.json` back afterwards. In a project laid out like the default, that line should not appear.

**Step 3: #168, only if a green has ever said "see the log" for you.** Redo what you did then. Expect
the reason to name a step, such as `the test did not pass in the throwaway copy with your change in
(red), so your file was left alone`, and never `see the log`.

Paste the exact lines for each step. Anything that doesn't match is a finding, and we'll file each
one as a GitHub issue.
