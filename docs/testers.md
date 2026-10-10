'# Testing Dope TDD

Thanks for trying it. This page is everything you need, in the order you
need it. Budget about thirty minutes for the first pass.

## What it is, in three sentences

Dope TDD is a Claude Code plugin that keeps Claude test-first. It **denies**
an edit to source until that module's test exists, **observes** every edit
and every test run, **proves** a passing test actually catches the change by
undoing the change and running the test again, and keeps the **evidence**
where you and Claude can both read it. It never calls a model of its own: it
runs inside your session, on your plan, and `claude plugin validate .` lists
every file, process and store call it makes before you install it.

How it does that: it is a Claude Code mod, which runs inside Claude Code in
the path of every Edit, Write and shell call. The edit is refused before it
happens, not flagged after; after a green run the result is held until the
catch check has finished, so the line Claude reads carries the verdict. A
rule in CLAUDE.md is advice Claude can forget or argue with. This is a gate
it has to pass, and every refusal says why.

## What it steps into, and what happens there

Claude Code lets a plugin stand in the path of specific actions and decide
what happens before the action runs. Anthropic describes the mechanism
under [Guard or change a tool call](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call).
Dope TDD stands in the path of four of Claude's tools: **Edit**, **Write**,
**Bash** and **PowerShell**. Nothing else. Here is what it enforces at each
moment, and what you see:

| Claude is about to... | Dope TDD... | You see |
| --- | --- | --- |
| Edit or write a source file whose module has no test | Refuses the call before it runs, and names the test to write, or to run and see fail, first | **BLOCKED**; Claude's reply says why |
| Touch a test file | Lets it through, unlocks that module, and tells Claude to see the test fail before touching the code. A test with no assertion is called out; a test re-saved unchanged is recorded as a workaround. | **WRITING** |
| Run the module's own test and see it fail | Unlocks the module too, with no touch needed: the red is the evidence. A green run alone unlocks nothing. | **RED** |
| Run the tests through the shell | Lets the run happen, then reads the runner's own summary line, not the exit code. A failure in another file is "red elsewhere", not red for this module. Output with no summary is "unread", never guessed. | **RED** or **GREEN**, with the count |
| Go green without ever seeing red | Says so: a test that has never failed has proven nothing yet | **NEVER SAW RED** |
| Go green after red | Holds the result. Undoes Claude's change on disk, runs only that module's test, restores the change, and attaches the verdict to what Claude reads. | **CAUGHT**, **MISSED**, or **unverified** with the reason |
| Go green after editing the test since red, with the code unchanged | Says the green came from the test, not the code | **TEST CHANGED** |
| Change code while green on a test that has failed before, test untouched | Names it a refactor and does not re-check it | **REFACTOR** |
| Edit source through the shell (`sed -i`, a heredoc, `git apply`) | Sees it too, and checks `git` afterwards for any change the capture missed | the same words, or **unverified: change not captured** |
| Add `.skip` or `.only` to a test, remove an assertion, comment code out, loosen `dope-tdd.json`, or press pause | Lets it through, counts it, and asks Claude to say why in its reply | **N WORKAROUNDS**, each one named |

Every verdict is written into the tool result Claude reads, in the same
call, so Claude cannot miss it and you can ask it what it saw.

What it does **not** do: it never calls a model, never writes code or tests
for Claude, never runs anything but your own test file, and never changes a
file except to undo and restore Claude's change during a catch check. If one
of its own checks fails internally, the call goes through unobserved and it
says so in the log and a toast; it fails open, on the record.

To see this list from the engine itself, run `claude plugin validate .` in
the clone. The `hooks:` line names the exact actions it steps into, and the
`calls:` line names everything it touches.

## What you need

- Claude Code v2.1.287 or later (`claude --version`). The terminal or the
  Desktop app's Code tab show the band above the prompt. The VS Code
  extension's chat panel runs the plugin but draws nothing, so there you
  read the `dope-tdd:` lines in tool results and `/tdd`.
- A project in Node (Vitest or Jest), Python (pytest), Godot 4 (gdUnit4),
  Java (Maven or Gradle) or .NET. The first two are read from real runner
  output; the others are provisional, see the rough edges.
- Node and git.
- Access to the repository (it is private for now) and git credentials that
  can clone it.

## Install

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

Later, `claude plugin update dope-tdd@dope-tdd` pulls the newest version.

To try it for one session without installing anything, start Claude Code
from a clone with `claude --plugin-dir <path-to-the-clone>`.

To watch without steering, put `{ "mode": "observe" }` in a
`dope-tdd.json` at the project root: nothing is refused, Claude is told
nothing, and no file is ever reverted, but every cycle is still recorded in
`/tdd`. To remove it:
`claude plugin uninstall dope-tdd@dope-tdd`.

## First ten minutes: the playground

Start here, not on your own code. The playground is a tiny project with
three planted bugs and no tests, built so you can watch the plugin work
without risking anything.

1. Clone this repository, then `cd playground` and `npm install`.
2. Open Claude Code in the `playground` folder and follow
   [playground/README.md](../playground/README.md): it gives you the task
   to hand to Claude and says what to watch for.
3. Type `/tdd` at any point to see the state and the recent events, and
   `/tdd why` to have each word on the band explained.

What a good run looks like: Claude is refused when it tries to edit source
first, writes a test, runs it and sees it fail (RED), fixes the code, sees
it pass (GREEN), and the plugin reports `caught` after undoing the fix and
watching the test fail again. The `/tdd` output at the end is the receipt.

## How you know it is on, and working

1. **It loaded.** In a terminal, `/plugin` shows a dim line `1 mod active ·
   dope-tdd`. On every surface, `/tdd` answers with `guard: ON` and the mode.
   If `/tdd` is not a command, the plugin did not load: `/reload-plugins`,
   then `claude plugin validate .` in the clone, are the first things to try.
2. **It is watching.** In the playground, ask Claude to change a source file
   before any test exists. In a terminal the band shows **BLOCKED**; on every
   surface Claude's reply says it was refused and what to write first, and
   `/tdd` shows `blocked 1`. That first refusal is the handshake.
3. **It is proving.** After a red-then-green cycle, `/tdd` shows `caught 1`,
   or `missed`, or `unverified` with the reason. In a terminal the band says
   **CAUGHT**.

Where you see it, by surface:

| Where you run Claude Code | Band above the prompt | `/tdd`, `/tdd why` | `dope-tdd:` lines in tool results |
| --- | --- | --- | --- |
| Terminal | yes | yes | yes, dim, under the tool call |
| Desktop app, Code tab | yes | yes | yes |
| VS Code extension, chat panel | no | yes | only if you expand the tool call |

In VS Code, `/tdd` is the view to trust. Claude reads every line the plugin
writes, so you can also ask it directly: "what did dope-tdd say about that
edit?"

## With it and without it

The playground is built for a before-and-after. Do the **without** run
first, because the plugin remembers which tests were touched for a week and
would not refuse the same module twice.

- **Without:** in the `playground` folder, start `claude --safe-mode`, which
  turns every plugin off for that session, and give it Walk 1 from the
  playground README. Watch what Claude does first. Usually it edits the
  code, then maybe writes a test, and never sees that test fail.
- **Reset:** from the `playground` folder, `git checkout -- src` and delete
  the `tests` folder it created.
- **With:** a normal session, same task. The refusal comes first, then the
  test, then red, then the fix, then the catch check. `/tdd` at the end is
  the receipt; the first run has no equivalent.

The difference is not the result, both fixes probably work. It is whether a
test that can fail existed before the fix, and whether anyone proved it.

## Then: a small project of your own

Pick something with Vitest or Jest and a few modules. Before the first
edit, run `/tdd setup`: it reads where your tests live and proposes a
`dope-tdd.json`. Out of the box the plugin pairs `src/<module>.ts` with
`tests/<module>.test.ts`; co-located tests, `__tests__/` folders and
per-package roots are supported once the layout is set.

Then give Claude a real bug or a small feature and watch the words.

## Known rough edges

- Tested on Windows only so far. You may be the first run on a Mac or on
  Linux. If paths or shell commands misbehave, that is exactly what we want
  to hear.
- The catch check briefly reverts your source file on disk, runs the test,
  and restores it. Your editor may flicker. Don't save that file during a
  check. If anything ever goes wrong there, the plugin keeps your text
  beside the file as `<file>.dope-tdd.kept` and says so.
- Godot, Java and .NET are provisional: their summary readers were written
  from the runners' own source and docs, not from a run. If you are on one
  of those, the whole output of one real test run, pass and fail, is the most
  valuable thing you can send. A run the reader cannot read shows as unread,
  never as a verdict.
- A Godot project needs `godot` on PATH, `GODOT_BIN` set, or `"godot"` in
  `dope-tdd.json` pointing at the binary, for the catch check to run.
- It is a prototype. Some words will be wrong sometimes. The plugin's rule
  for itself is that every verdict says why, so when a word is wrong you
  should be able to see what it was looking at.
- One Claude Code session per checkout, for now. The catch check reverts a
  file for a moment, and the lock that says so is per session: a second
  session in the same folder, another agent say, could edit or test that file
  while it is reverted. If you run several agents, give each its own git
  worktree; the plugin keeps worktrees apart. A shared lock is on the list.
- Observe mode watches without refusing, but the catch check still runs in
  it. If you want nothing touched on disk, there is no switch for that yet.

## What to tell us

Open an issue with the **Tester report** template. The most useful thing
you can send is the one moment the plugin was wrong, silent, or annoying,
with the `/tdd` output from that moment. A run where everything worked is
useful too; say so in a line.

Pasting a `dope-tdd:` line from a tool result is better than describing it.
