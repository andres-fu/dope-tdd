# Testing Dope TDD

Thanks for trying it. Install it, point it at your own project, and start on
real work: that is how it is meant to be used, and it is the test that
matters most. This page is in the order you need it.

## What it is, in three sentences

Dope TDD is a Claude Code plugin that keeps Claude test-first. It **denies**
an edit to source until that module's test has been touched or seen failing,
**observes** every edit and every test run, **proves** a passing test
actually catches the change by undoing the change and running the test again
(the *catch check*), and keeps the **evidence** where you and Claude can both
read it. It runs inside your own session, on your plan, and calls no model of
its own unless you turn on the model approver for override requests (off by
default).

A rule in CLAUDE.md is advice Claude can forget or argue with. This is a gate
it has to pass: the edit is refused before it happens, and every refusal says
why and lists the ways past it.

## Before you start

- Claude Code v2.1.287 or later (`claude --version`). An older Claude Code
  does not load the plugin and says nothing about it: the agent simply runs
  unguarded. With more than one Claude Code installed, check the one that
  actually runs (`which claude`, or `where claude` on Windows).
- A project tested with Vitest, Jest, ava or `node --test`: the fully
  supported path. Python (pytest or `python -m unittest`), Godot 4 (gdUnit4), Java (Maven or Gradle)
  and .NET work too, but their catch check is experimental and off by
  default; see the rough edges.
- Not watched yet: Go, Rust and Ruby, and test commands that hide the runner
  behind another tool (`tox`, `make test`, a shell script). Their runs are not recognised, so the guard sees no red or green
  and the band doesn't move past **red ·** after a run. Pick a project in a supported stack;
  if you try one of these anyway, the `/tdd` output is still a useful report.
- Node and git.
- **What appears in your repository.** `dope-tdd.json` at the root if you run
  `/tdd setup` (the layout and settings; commit it). `dope-tdd.overrides.json`
  the first time Claude asks for an override (the record of which role
  approved what; commit it, it is the audit trail). Inside `.git` (not your
  files): the catch check's throwaway copy while it runs, and a git ref that
  locks it. Session records and kept copies live in `~/.dope-tdd/`, outside
  the repo.

## Install

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd --scope project
```

Run it inside the project you'll test with, so the guard is on there only.

Then, in Claude Code, `/reload-plugins` and `/tdd`. It answers with
`guard: ON` and the mode: the plugin is live. If `/tdd` is not a command, the
plugin did not load; check the Claude Code version first.

Later, `claude plugin update dope-tdd@dope-tdd` pulls the newest version, and
`claude plugin uninstall dope-tdd@dope-tdd` removes it.

## Point it at your project

Run `/tdd setup` before the first edit. It reads where your tests live,
names the command your tests run with, and proposes a `dope-tdd.json`. Out of the box Dope TDD pairs `src/<module>.ts`
with `tests/<module>.test.ts`; co-located tests, `__tests__/` folders and
per-package roots work once the layout is set. Skip this and a project laid
out differently gets refusals that name the wrong test, or a band that says
**NOT WATCHING**. With no `dope-tdd.json` and a default layout that matches
none of your code, Claude is told so at the start, with the layout
`/tdd setup` finds, and asks you to run it.

To watch without steering at first, put `"mode": "observe"` in
`dope-tdd.json`: nothing is refused and no file is ever undone, but every
cycle is still recorded in `/tdd`. `"mode": "warn"` lets untested edits
through with a warning.

## Start your real task

Give Claude the task you were going to give it anyway. Above the prompt the
band starts as `ready · write a failing test, or edit code, and this band
follows`, then tracks the module being worked on. What happens depends on
the kind of change:

- **A bug fix.** Claude is refused when it edits the code first. It writes or
  edits the test (a *touch*, which unlocks the module), runs it and sees it
  fail (**RED**), fixes the code, runs it again (**green ✓**), and Dope TDD
  undoes the fix and runs the test once more: **PROVEN** if it fails without
  the fix, **MISSED** if it still passes.
- **A refactor of code that already has passing tests.** The test passing is
  not enough: Dope TDD wants to see a red before an edit. The refusal says
  the two honest ways: add or tighten one assertion for what is about to
  change and see it fail, or run `/dope-tdd:pin` to pin what the code does now
  in that test, prove the pins by breaking the code on purpose, then refactor
  under them.
- **Code with no tests at all.** `/dope-tdd:pin` pins today's behaviour first,
  proves the pins, then the change goes ahead under them.
- **Not sure yet what the code should do.** `/dope-tdd:spike <question>`
  explores in a throwaway copy outside the project, then the work is
  rebuilt test-first. No approval needed; `/tdd` lists the spike.
- **Moving code into new files.** Each new file is a module of its own, so
  each needs its test touched (or pinned) before it is written.

If nothing fits, Claude can ask to pass the guard with a reason
(`mcp__dope-tdd__override_request`). It then stops and waits: you answer with
`/tdd approve` or `/tdd deny <why>`, or the band's APPROVE and DENY. It is
on the record either way. To pause the guard yourself:
`/tdd pause <minutes> <reason>`; there is no off switch, and a pause ends by
itself.

## Reading what it says

- **The band** (terminal and the Desktop app's Code tab): line 1 is the
  module, `red ✓ green ✓`, the verdict (PROVEN, MISSED, `UNPROVEN · why`,
  CHANGED) and the last run, which you can click to open that test; a run of
  one test file says how long it took, and from 30 seconds says it is slow. Line 2
  is the one next step.
- **`/tdd`**: the whole record, with the build first. `/tdd why` explains
  every word on the band and every row of `/tdd`.
- **`dope-tdd:` lines** in Claude's tool results: every refusal and verdict
  is written there in the same call, so Claude cannot miss it, and you can ask
  it "what did dope-tdd say about that edit?"

| Where you run Claude Code | Band above the prompt | `/tdd`, `/tdd why` | `dope-tdd:` lines |
| --- | --- | --- | --- |
| Terminal | yes | yes | yes, dim, under the tool call |
| Desktop app, Code tab | yes | yes | yes |
| VS Code extension, chat panel | no | yes | only if you expand the tool call |

## Known rough edges

- Live runs so far are on Windows. CI runs the whole suite on Windows
  and Linux for every pull request, and on macOS for every push to main, but you may be the first person to use it on a Mac or on
  Linux. If paths or shell commands misbehave, that is exactly what we want
  to hear.
- Python, Godot, Java and .NET are experimental. Their catch check would
  undo your change on disk for one test run, so it is off unless
  `"catchCheck": true` is in `dope-tdd.json`; until then a green there is
  **UNPROVEN · not checked**, and says why. With it on, an editor or a file
  watcher may flicker, so don't save that file during a check. If the file
  changed under it, your file is left alone and your change is kept in
  `~/.dope-tdd/kept/<repo>-<hash>/`, never inside the repository.
- Vitest, Jest, ava and `node --test` check in a throwaway copy (in a clone
  or a linked worktree) and never touch your files. With more than 300
  changed files, a slow checkout, or a test that is not green in the copy,
  the green is UNPROVEN · not checked and says why, naming the step that
  failed; nothing is written to your files. If it says the test did not pass
  in the throwaway copy, prove that one by hand: break, red, restore, green.
- The gdUnit4 (Godot), Maven and Gradle summary readers are provisional (the .NET one is read from real runs): they were written
  from the runners' own source and docs, not from a run. If you are on one
  of those, the whole output of one real test run, pass and fail, is the most
  valuable thing you can send. A run the reader cannot read shows as unread,
  never as a verdict.
- Mocha is recognised but not read yet: Claude is told once, its runs are
  not counted, and `/tdd` lists it under `not read:`. Untested edits are
  still refused.
- Run one test file at a time, and keep the runner's summary line in the
  output: Dope TDD reads that line, never the exit code, so a `tail` or a
  `grep` that drops it leaves the run unread. For node --test, a failure
  count left on its own (`grep -E "^# (pass|fail)"`) still reads as a red;
  a green needs the total line too. A whole suite cut down to its
  totals is read, but a red in it is not charged to the module you are on:
  the totals don't say which file failed.
- Several sessions in one checkout share one catch-check lock, so a second
  agent cannot edit or test a file while another session's check has it
  undone. Giving each agent its own git worktree is the calmest setup. For
  subagents in a worktree, Edit, Write and shell writes are refused as in the
  main checkout, but the git check after a command and the catch check still
  look at the main folder, and all agents in one session share its state (#198).
- During a git rebase, merge, cherry-pick, revert, `am` or bisect the guard
  stands down and says so (**STANDING DOWN**). A bisect you forgot to reset
  keeps it standing down until you run `git bisect reset`.
- Claude Code cloud sessions do not load plugins, so the guard does not run
  there. Use the pull-request check ([docs/pr-check.md](pr-check.md)) to prove the result of
  a cloud session instead.
- If one of its own checks fails internally, the call goes through
  unobserved and it says so in the log and a toast: it fails open, on the
  record.
- Some words will be wrong sometimes. The plugin's rule for itself is that
  every verdict says why, so when a word is wrong you should be able to see
  what it was looking at.

## What to tell us

Open an issue with the **Tester report** template. The most useful thing
you can send is the one moment the plugin was wrong, silent, or annoying,
with the `/tdd` output from that moment. A run where everything worked is
useful too; say so in a line.

Pasting a `dope-tdd:` line from a tool result is better than describing it.

## Appendix: the playground

If you want to see every verdict on purpose before using it for real, the
repository has a tiny project with three planted bugs and no tests. Clone
the repository, `cd playground`, `npm install`, open Claude Code there and
follow [playground/README.md](../playground/README.md).

It is also built for a before-and-after. Do the **without** run first (the
plugin remembers touched tests for a week): start `claude --safe-mode`, which
turns every plugin off, and give it Walk 1. Reset with `git checkout -- src`
and delete the `tests` folder it made. Then the **with** run, same task: the
refusal comes first, then the test, then red, then the fix, then the catch
check. The difference is not the result; both fixes probably work. It is
whether a test that can fail existed before the fix, and whether anyone
proved it.

## Appendix: what it steps into

Claude Code lets a plugin stand in the path of specific actions and decide
what happens before the action runs; Anthropic describes the mechanism under
[Guard or change a tool call](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call).
Dope TDD stands in the path of four of Claude's tools, **Edit**, **Write**,
**Bash** and **PowerShell**, and nothing else.

| Claude is about to... | Dope TDD... | You see |
| --- | --- | --- |
| Edit or write a source file whose module is not unlocked | Refuses the call before it runs, and lists the ways past it: (1) the test to make fail, with the command that runs it (or, when the test exists, one assertion to add or tighten), (2) `/dope-tdd:pin`, (3) an override request, offered on the module's first refusal only | Claude's reply quotes the refusal; `/tdd` counts it under `blocked` |
| Touch a test file | Lets it through, unlocks that module, and tells Claude to see the test fail before touching the code. A test with no assertion is called out; a test re-saved unchanged is recorded as a workaround. | the module on the band, with **red ·** (not failed yet) |
| Run the module's own test and see it fail | Unlocks the module too, with no touch needed: the red is the evidence. A green run alone unlocks nothing. | **RED**, with how long it has been open |
| Run the tests through the shell | Reads the runner's own summary line, not the exit code. A failure in another file, or a run of a file outside the layout, is not this module's. Output with no summary is unread, never guessed. | **red ✓** / **green ✓**, and the last run in words |
| Run the test and see it fail on an error, not an assertion (an import, a collection, a compile) | Counts it as red, but not as proof: no assertion ran. A catch check that fails this way is not proof either, and neither is putting the code back after a break that only gave such a red | **RED**, and Claude is told no assertion ran; a check gives **UNPROVEN · not checked** |
| Fail the same way three runs in a row | Counts identical reds on the module (the same assertion message, or the same failing tests); a green or a different failure starts over | **RED**, and Claude is told the failure is not moving: step back, or say BLOCKED |
| Go green without ever seeing red | Runs the catch check on the change too; if that can't prove the test, says a test that has never failed has proven nothing yet | **PROVEN**, or **UNPROVEN · never failed** |
| Go green after red | Holds the result, undoes Claude's change, runs only that module's test, and attaches the verdict to what Claude reads, quoting the assertion the test failed on when it can read one (Vitest, node --test, pytest); `/tdd receipt` quotes it too. Another module whose red cycle the same whole-suite green closes is not checked, and `/tdd` names it | **PROVEN**, **MISSED**, or **UNPROVEN · not checked:** with the reason |
| Break the code on purpose, see red, put it back exactly, go green | The red was the proof. In a git checkout it then makes a few small changes in a throwaway copy and names any the test did not notice | **PROVEN**, with the unnoticed changes listed |
| Edit a module unlocked in an earlier session (up to 7 days) | Refuses the first edit until its test runs once this session, red or green, and says why; drops the carry-over if the test changed since | the refusal names the command; `/tdd` lists it under `unlocked earlier` |
| End a session with a module still red | Keeps it, and the next session's briefing in that project leads with it: the module, the failing test, start there. Cleared once a session leaves it green | the briefing's second line; `leftRed` in the session log |
| Go green after editing the test since red, with the code unchanged | Says the green came from the test, not the code | **UNPROVEN · the test changed, the code didn't** |
| Change code while green on a test that has failed before, test untouched | Names it a refactor and does not re-check it | **refactor · not re-checked** |
| Edit source through the shell (`sed -i`, a heredoc, `git apply`) | Sees it too, and checks `git` afterwards for any change the capture missed | the same words, or **UNPROVEN · not checked: change not captured** |
| Put a file back with git (`git restore`, `git checkout -- <file>`, `git stash`) | Nothing: code put back to a saved state is not an edit | no change |
| Bring code in with git (`git checkout main -- <file>`, `git pull`, `git stash pop`) | Does not count it as Claude's edit, but records it, with the git verb only | `brought in by git, not guarded` in `/tdd` |
| Add `.skip` or `.only`, remove an assertion, comment code out, loosen `dope-tdd.json`, pause the guard, or edit a session record in `~/.dope-tdd/sessions/` from the shell | Lets it through, counts it, and asks Claude to say why in its reply | `workarounds: N` in `/tdd`, each one named |
| Work while a git rebase, merge, cherry-pick, revert, `am` or bisect is in progress | Stands down until the operation ends; Claude is told when it starts and ends | **STANDING DOWN** · git rebase in progress |

What it does **not** do: it never writes code or tests for Claude. It runs
your test runner on one test file, plus `git` and small `node -e` helpers
(the full list is in [docs/security-and-data.md](security-and-data.md)). In
your project it writes only `dope-tdd.json` (on `/tdd setup write`) and
`dope-tdd.overrides.json`, puts that file back if a shell command changes it,
and, for an in-place catch check, undoes and restores Claude's change. From a clone of the
repository, `claude plugin validate .` lists every action it steps into
(`hooks:`) and everything it touches (`calls:`).
