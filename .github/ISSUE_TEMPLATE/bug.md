---
name: Bug
about: Something dope-tdd did wrong, found in a review, while dogfooding, or by the night shift
title: ""
labels: bug
---

<!-- Add labels: one area: (catch-check, shell, git, setup, wording, runners, docs, process), the stack: it was
seen on, and the source: it came from (tester, review, dogfood, night-shift). Add `ready` only when the fix is small and
clear enough to pick up unattended. These labels are how we spot patterns: three issues in one area means a
guardrail or a test table, not just another fix. -->

**What happened**

The exact command and the exact `dope-tdd:` lines or `/tdd` output, pasted, not paraphrased.

**What should have happened**

**Where**

- dope-tdd build (the first line of `/tdd`):
- Stack and runner:
- The code path, if known (`hooks/<file>.ts:<line>`):

**Does it happen on other stacks?**

Which runners share this path, and whether each was checked.

**Which check should have caught it?**

A test, the catch check, review, a live run, CI, or a check we don't have yet. If it's a missing check, say what it would be.
