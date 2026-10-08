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
