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
