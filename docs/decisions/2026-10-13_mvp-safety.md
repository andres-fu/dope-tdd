# 2026-10-13 — Safe for a stranger: stand down for git, survive /clear, a way out

## What was decided
Three changes, so the first outside tester is never blocked or surprised by
the plugin doing something it should not:

1. **The guard stands down during a git operation.** While a rebase, merge,
   cherry-pick, revert, `am` or bisect is in progress (the markers git leaves
   in its directory: `rebase-merge`, `rebase-apply`, `MERGE_HEAD`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`), Edit, Write and shell
   calls go through unguarded and uncounted, and no catch check starts. A
   linked worktree is read through its `.git` file. The start and the end are
   each said once, to Claude in the tool result and to the person in a toast;
   the band shows `GIT REBASE` (or the operation) and `/tdd` leads with a
   `standing down:` line. A check another session already has in flight still
   holds a call that touches code.
2. **`/clear`, `/resume` and `/branch` re-seed from the store.** They reset
   `$.state` and do not fire `session.start`; `classic.SessionStart` fires
   after each with `source` set, so a hook on it repairs an interrupted check,
   restores the remembered unlocks and reads the config, exactly as a session
   start does. A compaction keeps `$.state` and is left alone.
3. **`/tdd off` and `/tdd on`.** The band's pause button as a command. Off is
   a pause, so it is counted as a workaround and shows on the record; saying
   it twice changes nothing.

## Why
The MVP is an outside developer on a Mac, Node with Vitest or Jest, doing real
work. Each change removes a way that person loses trust in the first hour:

- Resolving a merge conflict with Claude is ordinary work. Before this, every
  edit to a conflicted source file was refused (or charged as unguarded) for
  code nobody wrote in this session, and a green run during the rebase could
  start a catch check that writes old code into a file mid-rebase. Checkmate,
  a lint-on-edit plugin, skips rebase, `am` and bisect for the same reason.
  We stand down for merge, cherry-pick and revert too: their conflicted code
  was also written before, and the catch check must never revert a file
  while git is between states.
- After `/clear`, the next edit to a module whose test was already written was
  refused, which reads as the plugin being broken. The mods docs name this
  case and prescribe the `classic.SessionStart` hook.
- A tester who wants out needs a word, not a hunt for a button, and the
  band does not draw at all in the VS Code panel.

## What was considered and not done
- Carrying a pause across `/clear`. It needs state that outlives `$.state`:
  `$.store` is shared by every session on the machine, so a carried pause
  could land in another session's conversation. `/clear` starts the next
  conversation guarded, and the `/tdd off` reply says so.
- A setting to keep guarding during some operations (checkmate has one).
  No case asks for it yet.

## What is left
- A bisect someone forgot to reset keeps the guard standing down. It is
  visible (band, `/tdd`, the start message), not silent.
- The session's counts start over after `/clear`; only what the store
  remembers comes back.
- The git directory is found at the session root only, as the worktree check
  already assumes; a session opened in a subfolder of a repository does not
  see an operation in progress.
