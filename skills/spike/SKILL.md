---
description: Explore before you know what to test, under Dope TDD. Spike in a throwaway git worktree outside the project, write down what you learned and the first failing test, throw the copy away, then rebuild in the project test-first. Use when the path is not clear yet (how a library behaves, whether an approach works, where a bug lives) and no failing test can be written first. Needs no approval.
argument-hint: "<the question the spike answers>"
---

# Spike, throw it away, rebuild test-first

Question: $ARGUMENTS

Use this when you can't write the failing test yet because you don't know what the code should do. You explore in a copy outside the project, where Dope TDD guards nothing, then come back and do it properly. Dope TDD records the spike and its question. It's not a workaround and needs no approval, because nothing written in the copy is kept.

If the question above is empty, say in one line what the spike should answer before you start.

## 1. Make the copy

In a git repository, from the project root:

```bash
SPIKE="$HOME/.dope-tdd/spikes/$(basename "$(git rev-parse --show-toplevel)")-<short-slug>"
git worktree add --detach "$SPIKE" HEAD
STASH=$(git stash create) && [ -n "$STASH" ] && git -C "$SPIKE" stash apply "$STASH"
```

The last line brings your uncommitted changes into the copy, so the spike explores the code as it is now. `git stash create` leaves your own working tree and stash list untouched. Untracked files are not copied: copy any the spike needs by hand.

Outside git, copy the project folder to `~/.dope-tdd/spikes/<name>` instead.

## 2. Explore

Work in the copy, with absolute paths under `$SPIKE`. Edit freely, run things, add logging, try the approach. Aim for about 30 minutes. If you're still lost after that, stop and tell the user what you've tried.

Don't edit the project itself during the spike. Its edits are guarded as usual.

## 3. Write down what you learned

Before you throw anything away, write down in your reply:

- the answer to the question, in two to five lines
- the approach that worked, and any that didn't
- **the first failing test to write**, named and in one sentence

## 4. Throw the copy away

```bash
git worktree remove --force "$SPIKE"
```

Outside git, delete the folder. A copy left behind is removed at a session start after 7 days.

## 5. Rebuild in the project, test-first

Start from the failing test you named. Touch the test, run it, see it fail, then write the code. Dope TDD proves each step as usual (PROVEN or MISSED).

## What not to do

- Don't copy the spike's code back into the project with a shell command. A shell write to guarded source is refused or recorded like any other. Write the code again after a red: knowing the way, it's quicker the second time.
- Don't commit inside the copy, or push its branch.
- Don't use a spike to change code you already know how to test. If the test can be written, write it.
