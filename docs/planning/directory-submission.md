# Directory submission checklist

What it takes to list Dope TDD in Anthropic's plugin directory, checked against the repo on
2026-10-28. This list defines the MVP: when every **To do** row is done, the plugin is ready to submit.

Sources (read in full 2026-10-28):
[Submit your plugin](https://claude.com/docs/plugins/submit),
[Plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist),
[Platform support](https://claude.com/docs/plugins/platform-support),
[Publish and distribute a plugin](https://code.claude.com/docs/en/plugins/publish),
[Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).

## How a listing works

- **Route:** submit from the developer portal at claude.ai/directory/manage, choosing **Plugin
  bundle**. The official `claude-plugins-official` marketplace takes no portal submissions; that
  listing goes through an Anthropic partner contact only.
- **Who:** a paid claude.ai plan. Pro and Max submit from their own account. Submitting costs nothing extra.
- **Source:** this GitHub repo, plugin path empty (the plugin is the repo root), tracking `main`.
  The repo is public, so no private-repo upload step is needed.
- **Reach:** a mod (code named under `modules` in `hooks/hooks.json`) is listed for Claude Code
  only. People who add it on claude.ai get it in Claude Code as `dope-tdd@synced`.
- **Review:** the portal's **Validate** step runs more checks than the CLI, including rules for
  mods that `claude plugin validate` does not apply. After submitting, each commit on `main` is
  scanned again, with a security scan. A first submission that fails the security scan is
  rejected.
- **Updates:** each merge to `main` becomes a new version, so raise `version` with every release
  (already the rule). Pushes to `main` that aren't releases will also be scanned: consider
  tracking a release tag or branch instead (see open questions).

## Automated checks

`claude plugin validate --strict .` passes with one warning.

| Check | Result if missed | State |
| --- | --- | --- |
| `.claude-plugin/plugin.json` at the plugin root | Blocks | Done |
| `name` lowercase, hyphens, unique, not a reserved word | Blocks | Done (`dope-tdd`); uniqueness only the portal can confirm |
| `description`, `author`, `version` set | Warning | Done |
| `homepage` parses as a URL | Blocks (CLI) | Done |
| README of 40 or more words in the plugin folder | Blocks | Done (about 6,000 words outside code) |
| `LICENSE` file or `license` field | Blocks | Done (both, MIT) |
| No symlinks, submodules or LFS pointers | Blocks | Done |
| No `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX` | Blocks | Done |
| File names valid on Windows and macOS, no case clashes | Validation stops | Done |
| No `export-ignore`, `export-subst` or `filter` in `.gitattributes` | Validation stops | Done (no `.gitattributes`) |
| Repo under 50 MiB archived, under 10,000 files | Validation stops | Done (about 2 MiB, 197 tracked files) |
| Every non-image file under 256 KiB | Held for a reviewer | Done |
| 512 files or fewer | Held for a reviewer | Done |
| Only text, images and fonts; no `.ico`, `.pdf`, `.zip` or executables | Held for a reviewer | Done (one SVG) |
| No `package.json` beside a lockfile at the root | Held for a reviewer | Done (root `package.json` has no dependencies and no lockfile; `playground/` has one, below the root) |
| No package launchers (`npx`, `uvx` and so on) in hooks | Blocks if unpinned | Done |
| No credentials in any file, no reading `$GITHUB_TOKEN` and the like | Blocks or held | Done |
| `hooks/hooks.json` valid, using `modules` | Blocks | Done |
| Skill front matter valid, `description` is text | Blocks | Done (CLI passes) |
| Readable source, nothing minified | Held for a reviewer | Done (TypeScript source) |
| Listing icon | Warning | Done: `.claude-plugin/icon.png`, 1024 px, rendered from `assets/skull.svg` |

**Icon:** the portal takes the icon only the first time the plugin is saved or submitted, so it
had to be in place before the first **Validate**. Changing it later doesn't change the listing.

## Policy and review

These are judged by a reviewer or the security scan, not by validation.

| Policy point | State |
| --- | --- |
| README says everything the plugin runs, sends or fetches (security scan) | Done: "What Dope TDD sends" and "What Dope TDD stores" |
| Privacy policy link (3A) | Done: `privacyPolicyUrl` points at "What Dope TDD sends" |
| Support channel (3B) | Done: `supportUrl` is the issue tracker |
| Security contact (3B) | Done: `SECURITY.md`, and private vulnerability reporting is on (2026-10-28) |
| Purpose, operation and troubleshooting documented (3C) | Done in README; check the troubleshooting part is easy to find |
| At least three working example prompts or use cases (3E) | Done: "Try it in ten minutes" lists three prompts to ask Claude (fix a bug, pin and refactor, show the state) |
| Interfering with Claude's calls to other tools only when the user intends it (2E) | Done: the README's top says refusing edits is the point, that it's installed per project, and how to ease off or turn it off |
| No storing conversation content to change Claude's behaviour across sessions (1G) | The briefing carries unlocks and left-red modules across sessions. It stores test state, never conversation text. Done: "What Dope TDD stores" says so |
| Descriptions match what it does (2B) | Done; re-read `description` and the skills' descriptions before submitting |
| Maintained, issues handled (3G) | Done: issue templates, labels, a working triage habit |

## Data handling answers (portal step 4)

Drafted from the README; confirm before submitting.

- **Reads or stores personal data:** no. It stores file text being checked, test and module names,
  counts and timings under the user's account (see "What Dope TDD stores").
- **Sends data to services other than declared connectors:** no, except the opt-in experimental
  `"approver": "model"` override, which sends the override request and part of the diff through
  the session's own model client.
- **How long it keeps data:** session log 30 days, unlocks and left-red 7 days, check copies
  removed when the check ends; kept changes until the user deletes them.
- **Intended for people under 18:** no.

## Before the first Validate

Not directory rules; Andres's own rules for public repos.

- Done: local paths and the username removed from `DOGFOOD.md` and
  `docs/decisions/2026-10-08_name-dope-tdd.md`. Test fixtures use made-up paths and stay.
- Done 2026-10-28 on Windows (Claude Code v2.1.306, main at 645c092): a clean install in a fresh
  Claude Code profile (`CLAUDE_CONFIG_DIR` pointed at an empty folder) and a copy of `playground/`.
  Following the README word for word, `marketplace add andres-fu/dope-tdd` and
  `install --scope project` worked. The session loaded the plugin, and on "Fix Bug 1 from BUGS.md"
  Claude wrote the test first, saw it fail, fixed it, and the catch check said PROVEN. An edit to
  untested source was refused with the three ways forward. `/tdd` printed the state, and
  `claude plugin disable ... --scope project` stopped the plugin loading. The band wasn't
  checked (headless runs). Not covered: macOS and Linux. Note: `~/.dope-tdd/` follows the
  home folder, not `CLAUDE_CONFIG_DIR`, so a test profile still writes to the real session log.
- **Optional:** `claude plugin eval` with a small eval suite (the docs suggest it; the directory
  doesn't require it).
- **To do:** release a version with the above, then submit.

## Open questions

1. **Track `main` or a release tag?** Tracking `main` scans every merge. A tag (or a `release`
   branch) means only releases reach users, which matches the "version bump per tester release" rule.
2. **Auto-publish:** after the first version, publish passing versions automatically or by hand?
3. **Mod rules:** the portal applies rules to mods that the CLI doesn't show. Only a real
   **Validate** run will tell; do one early, before the release, to see the findings.
