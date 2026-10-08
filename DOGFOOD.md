# Dogfood log — Red First on throughline

Gate: ~2 weeks of real use (started 2026-10-07). One line per friction or surprise:
date · what happened · what it suggests. Keep entries short and honest.

| Date | What happened | What it suggests |
| --- | --- | --- |
| 2026-10-06 | Desktop band rendered as a bright bone slab on the dark app; buttons invisible | Use theme colors; brand only in accents (fixed in v2.1) |
| 2026-10-06 | Calavera logo SVG rendered as a broken image; a tiny probe SVG worked | Purpose-drawn small mark beats a detailed logo (fixed: skull.svg) |
| 2026-10-07 | Guard sat paused during real work; owner believed they had resumed it | No confirmation on toggle, no way to check state (fixed: toasts, /tdd, status tool) → MVP needs spike mode so pausing isn't the escape hatch |
| 2026-10-07 | Claude edited CareerTimeline.tsx via a Python script in Bash; guard never saw it | Bash bypass (fixed in v3: pre-call write detection + git diff backstop) |
| 2026-10-07 | "AVG 6S" cycles didn't match ~30s real cycles | RED started at test edit, not failing run (fixed in v3: WRITING phase) |
| 2026-10-08 | Headless playground run: Claude piped `vitest run` through `tail -30`; the failing run was logged as a pass and the cycle as "never saw red" | Exit codes can't be trusted; read the runner's summary line (fixed: runOutcome) |
| 2026-10-08 | Claude itself noticed the status was wrong: "it doesn't seem to have counted my failing run" | The agent reads the evidence too; status text has to be exact or it stops trusting the tool |
| 2026-10-08 | `claude plugin test .` swept up the test Claude wrote under `playground/tests/` | The playground ships with no tests and must be reset after every run |
| 2026-10-08 | Walk 2 live run: Claude pinned behaviour, broke the code on purpose, saw red, restored, refactored, and then had to explain the lingering "never saw red 1" to the user | The agent's evidence must not need explaining (fixed: retracted once a later red proves the pin) |
| 2026-10-08 | Walk 3 live run: told to skip the test, Claude got blocked once, read the deny message and CLAUDE.md, and did it properly | The deny text works as a nudge; keep it short, exact, and name the file to create |
| 2026-10-08 | Advice live run: all three lines (unlocked, RED, GREEN saw red) reached Claude as "hook additional context" and it acted on the first two; it skipped the refactor step as "the fix is already small" | Lines land where the agent reads them; the GREEN wording may want "if there is anything to clean up" |
| 2026-10-08 | Committed while a live run was still writing to the playground; its test and fix landed in the commit | Never run `git add -A` in parallel with a playground run; reset first, commit second |
| 2026-10-08 | Two-session live run: session two edited the source without touching the test, was allowed, got "unlocked because ... was touched JUST NOW in an earlier session", and ran the test right after | Memory across sessions works; the line can only arrive after the edit it rides on, and that was enough |
| 2026-10-08 | Catch check live run (Bug 2, honest): the reverted test failed, status said "caught 1", and Claude read "its test catches the change" in the tool result | The check works end to end on a real Vitest project in a few seconds |
| 2026-10-08 | Catch check live run (Bug 3, weak test): the test went green before the fix, the cycle closed, and the later fix plus pass never triggered the check; Claude also skipped "break it on purpose" as beyond the ask | Trigger the check on any pass with pending changes, not only on a completed cycle (fixed); the check replaces the break-on-purpose advice for that case |
| 2026-10-08 | Design catch while writing tests: undoing a refactor keeps the test green by definition, so the check would report every refactor as "missed" | Changes made while green on a proven module are refactors: credited, never reverted (fixed) |
| 2026-10-08 | Warn-mode live run with an exempt file: a code-only fix was allowed, counted as unguarded, and Claude read "write tests/money/formatCents.test.ts(x) next"; the exempt rename raised nothing; `/tdd` showed `mode: warn` and the exemption | Modes and exemptions replace pause for legitimate non-test work, and the exception is on the record |
| 2026-10-08 | Architect review plus a second code review of PR #3: the catch check minted CAUGHT from an exit code when the runner crashed, a new file was caught by construction, a failed restore could leave every edit denied, and the PowerShell tool was not hooked on the owner's own machine | Honesty pass (decision doc of the same name): no summary means unknown, per-module checks, an expiring lock, red attributed by FAIL lines, test-changed-after-red named, config edits recorded; every verdict word now has a falsifier test |
