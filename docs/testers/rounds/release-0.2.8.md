# dope-tdd 0.2.8: ready for the plugin directory

0.2.8 is exactly the build this note describes. It changes nothing in how dope-tdd guards your work.
It's the version submitted to Anthropic's plugin directory, with what the directory's first check
asked for.

## What 0.2.8 changes

- **The README says what the plugin does on your machine.** A new section, "What it runs, writes,
  sends and hooks", lists the programs it starts, the files it writes, that it sends nothing except
  through the opt-in model approver, what it reads, and every hook it registers and why.
- **The spike skill names its copy from the repository's top folder** (`git rev-parse
  --show-toplevel`) instead of the current folder.
- **Internal tidy-ups** the directory's scanner needed: one variable renamed in the plugin's code, and
  a few words in the docs.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.8`.

**Step 1: a spike.** Ask Claude to run `/dope-tdd:spike <a question>` from a subfolder of your
project. Expect the copy under `~/.dope-tdd/spikes/` to be named after the repository, not the
subfolder.

**Step 2: a fix as usual.** Fix one bug test-first and expect PROVEN, as in 0.2.7.

Paste the exact lines for each step. Anything that doesn't match is a finding.
