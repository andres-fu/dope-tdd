# 2026-10-26 — Stumble twice: a spike happens in a throwaway copy, then the work is rebuilt test-first

Status: proposed. Idea 19 in the running tab (`docs/planning/process-and-agent-os.md`). Nothing is
built until the open questions at the end are answered.

## The problem
The *Theory of Developer Momentum* paper (arXiv 2610.24935) describes a task as a hill. On the uphill
side you don't yet know what the code should do, so you can't write the failing test first: you
explore until the path is clear. Developers it interviewed "stumble twice": they hack a way through,
throw it away, and do it properly.

Under dope-tdd today, exploring that way has one route: an override of kind `spike`. That needs a
person to approve it, and the untested code it leaves behind is debt until a test is written. So the
uphill part of every task is pushed toward an override, the thing the gate is meant to make rare. With
nobody there to approve, an agent that needs to explore is simply denied.

## What is proposed
A spike happens outside the project, in a throwaway git worktree, and is then thrown away. Nothing
in it reaches the project except through the gate.

1. **A skill, `/dope-tdd:spike <question>`.** It walks the agent through these steps:
   - Make a worktree of the project outside it, in `~/.dope-tdd/spikes/<repo>-<slug>`, with the
     uncommitted changes applied, so the spike starts from the same code.
   - Explore there freely, for as long as the question needs.
   - Write down what was learned, in two to five lines: the approach, and the first failing test to write.
   - Remove the worktree.
   - Rebuild in the project test-first, starting from that failing test.
2. **dope-tdd records it, as a spike, not a workaround.** The `skill.prompt` hook already watches for the
   pin skill. It would also log a `spike` event with the question, and the session record would get
   `spikes` rows (time and question). `/tdd` would list it. No approval is needed, because nothing
   written in the spike folder is guarded or kept.
3. **The briefing names it before the override:** "To explore before you know what to test, use
   /dope-tdd:spike: work in a throwaway copy outside the project, then rebuild here test-first."
4. **Leftover spike worktrees are removed** at session start once they are older than 7 days, as old
   session logs are after 30.

The override of kind `spike` keeps its meaning: untested code that stays, on the record, approved by a person.

## Why a copy and not a spike mode in place
A spike mode in the project (edits allowed for a while, then every source file put back) was the
first design. It loses on three counts:

- **Work loss.** Putting files back at the end also reverts anything the user edited in that window.
  "No work-loss paths" is one of the conditions for onboarding the next tester.
- **Machinery.** It needs a snapshot at the start and a restore of many files at the end. A session
  that crashes mid-spike would also need a repair, as the catch check's journal does.
- **History.** A commit made during the spike keeps the spike's code in history even after the files
  are put back.

A worktree outside the project has none of these. The user's checkout is never touched, and throwing
it away is just deleting a folder.

## Why not leave it as it is
An agent can already do this without asking, since paths outside the root are never guarded. But
nothing tells it to, nobody sees it happen, and the receipt can't say a spike came first. The skill
turns an unseen loophole into a named, recorded step that the briefing recommends.

## What stops the spike's code from coming back untested
The gate, as it is now:

- An Edit or Write to guarded source is refused until its test is touched or seen failing.
- A shell copy from the spike folder into the project is a shell write to that source, so it is
  refused or recorded like any other.
- The catch check still proves whatever is rebuilt.

Copying by hand, line by line, after a red is ordinary test-first work: the test failed first.

## What it costs
One skill file, a hook branch next to the pin skill's, one event kind, one session-record field, a
briefing line (the briefing stays under its 2,000-character test), and a cleanup at session start. One
PR. The live tests cover the hook and the cleanup, and the skill text is checked by `claude plugin validate`.

A spike outside git (no repository) gets no worktree. The skill says to copy the folder instead, or
to ask for an override.

## Open questions (the user's call)
1. **Who may start a spike?** Recommended: the agent, without asking, because nothing it writes there
   is kept. The alternative is a person only, with `/tdd spike`.
2. **Uncommitted changes in the copy?** Recommended: yes, applied from `git stash create`, so the spike
   explores the code as it is. The alternative is HEAD only, which is simpler but explores older code.
3. **A time box?** Recommended: none enforced. The skill suggests about 30 minutes, and the record keeps
   the start time. An enforced timer needs a way to see the spike end, which a removed folder only
   shows after the fact.
4. **Name the copy-back?** A shell command that reads from `~/.dope-tdd/spikes/` and writes guarded
   source could be named "copied from a spike" on the record. Recommended: later, if the record shows
   it happens.
