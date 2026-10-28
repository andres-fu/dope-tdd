# dope-tdd 0.2.7: three trust fixes

0.2.7 is exactly the build this note describes. It fixes three places where dope-tdd was quieter or
looser than it should be. Nothing else changes in how it works.

## What 0.2.7 changes

- **A broken `dope-tdd.json` says so.** When the file doesn't parse or a value is invalid, dope-tdd
  still falls back to the defaults (enforce, the default layout), but now the band shows
  **CONFIG INVALID** with the file and the error, and Claude is told at the start of the session that
  the file wasn't read and why. Before, only `/tdd` mentioned it (#193).
- **The model approver can't pause the guard.** With the experimental `"approver": "model"`, an
  agent's request to pause the whole guard now always goes to you, or is denied when nobody is
  there. Hotfixes already worked this way (#194).
- **NotebookEdit is guarded.** Edits made through the NotebookEdit tool are refused and unlocked like
  Edit's (#195). Other plugins' and MCP servers' file tools are still not watched.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.7`. If it doesn't, stop there and tell us what it says.

**Step 1: a broken config.** In a test project, change `dope-tdd.json` so `"mode"` is `"Warn"` (capital
W). Start a new session. Expect the band to show `CONFIG INVALID` with the file name and the error,
and ask Claude what dope-tdd told it at the start: it should mention the file wasn't read. Put the
file back.

**Step 2: a fix as usual.** Fix one bug test-first and expect PROVEN, as in 0.2.6.

Paste the exact lines for each step. Anything that doesn't match is a finding, and we'll file each
one as a GitHub issue.
