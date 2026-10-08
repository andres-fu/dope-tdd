# Testing Dope TDD

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

## What you need

- Claude Code v2.1.287 or later (`claude --version`). The terminal or the
  Desktop app's Code tab show the band above the prompt. The VS Code
  extension's chat panel runs the plugin but draws nothing, so there you
  read the `dope-tdd:` lines in tool results and `/tdd`.
- A project that runs its tests with Vitest or Jest. Other runners work for
  the deny and observe parts, but the catch check needs one of those two.
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

To turn it off for one project, put `{ "mode": "observe" }` in a
`dope-tdd.json` at the project root. To remove it:
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
- Vitest and Jest only for the catch check, and TypeScript or JavaScript
  only for the layout engine.
- It is a prototype. Some words will be wrong sometimes. The plugin's rule
  for itself is that every verdict says why, so when a word is wrong you
  should be able to see what it was looking at.

## What to tell us

Open an issue with the **Tester report** template. The most useful thing
you can send is the one moment the plugin was wrong, silent, or annoying,
with the `/tdd` output from that moment. A run where everything worked is
useful too; say so in a line.

Pasting a `dope-tdd:` line from a tool result is better than describing it.
