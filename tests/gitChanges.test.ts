import { describe, expect, test } from 'claude-code/testing'

import { baseAfter, baseFor, bringsInCode, changedAround, changedPaths, gitVerb, isGitOnly, isRevertCommand, isRevertOnly, parseNumstat, savedStateOf } from '../hooks/gitChanges'

// `git status --porcelain=v2 --branch -- <source> <test>`: whether the module's work is committed, and pushed (2026-10-19).
describe('savedStateOf', () => {
  const head = '# branch.oid 0fcba10\n# branch.head karl-feedback\n'
  test('a changed or untracked file of the module is uncommitted', () => {
    expect(savedStateOf(`${head}1 .M N... 100644 100644 100644 a b hooks/build.ts\n`)).toBe('uncommitted')
    expect(savedStateOf(`${head}? tests/build.test.ts\n`)).toBe('uncommitted')
  })

  test('clean with no upstream, or ahead of it, is committed', () => {
    expect(savedStateOf(head)).toBe('committed')
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +2 -0\n`)).toBe('committed')
  })

  test('clean and level with its upstream is pushed', () => {
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +0 -0\n`)).toBe('pushed')
    expect(savedStateOf(`${head}# branch.upstream origin/karl-feedback\n# branch.ab +0 -3\n`)).toBe('pushed')
  })

  test('output without the branch header is not git status: unknown, never a guess of committed', () => {
    expect(savedStateOf('')).toBeNull()
    expect(savedStateOf('fatal: not a git repository\n')).toBeNull()
  })
})

describe('parseNumstat', () => {
  test('keys each changed path by its add/delete counts', () => {
    expect(parseNumstat('3\t1\tsrc/App.tsx\n10\t0\tsrc/utils/a.ts\n')).toEqual({
      'src/App.tsx': '3/1',
      'src/utils/a.ts': '10/0',
    })
  })

  test('is empty for empty output and tolerates CRLF', () => {
    expect(parseNumstat('')).toEqual({})
    expect(parseNumstat('1\t1\tsrc/App.tsx\r\n')).toEqual({ 'src/App.tsx': '1/1' })
  })
})

describe('changedPaths', () => {
  test('lists paths whose signature differs, appeared, or disappeared', () => {
    const before = { 'src/a.ts': '1/0', 'src/b.ts': '2/2', 'src/gone.ts': '5/0' }
    const after = { 'src/a.ts': '1/0', 'src/b.ts': '3/2', 'src/new.ts': 'untracked:9' }
    expect(changedPaths(before, after).sort()).toEqual(['src/b.ts', 'src/gone.ts', 'src/new.ts'])
  })

  test('a path that left the diff with its modified time unchanged was committed or staged, not written (#23)', () => {
    const before = { 'tests/a.test.ts': 'untracked:1000', 'src/a.ts': '3/1:1000', 'src/b.ts': '1/0:1000', 'src/gone.ts': '5/0:1000' }
    // Committed, committed, rewritten and committed in one command, deleted.
    const now = { 'tests/a.test.ts': 1000, 'src/a.ts': 1000, 'src/b.ts': 2000, 'src/gone.ts': null }
    expect(changedPaths(before, {}, now).sort()).toEqual(['src/b.ts', 'src/gone.ts'])
    // Without the current times every vanished path still counts, as before.
    expect(changedPaths(before, {}).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/gone.ts', 'tests/a.test.ts'])
  })

  test('is empty when nothing changed', () => {
    expect(changedPaths({ 'src/a.ts': '1/0' }, { 'src/a.ts': '1/0' })).toEqual([])
  })

  // #292: against a commit, `git add new.ts` turns `untracked` into counts, and `git rm --cached` turns them back.
  test('a path that only moved between untracked and counts, at the same modified time, was staged, not written', () => {
    expect(changedPaths({ 'src/new.ts': 'untracked:1000' }, { 'src/new.ts': '4/0:1000' })).toEqual([])
    expect(changedPaths({ 'src/new.ts': '4/0:1000' }, { 'src/new.ts': 'untracked:1000' })).toEqual([])
  })

  test('a time that could not be read shows nothing was only staged (#299)', () => {
    expect(changedPaths({ 'src/a.ts': 'untracked:missing' }, { 'src/a.ts': '1/1:missing' })).toEqual(['src/a.ts'])
  })

  test('staged and rewritten is a change, and so is new counts at the same time, as with cp -p', () => {
    expect(changedPaths({ 'src/new.ts': 'untracked:1000' }, { 'src/new.ts': '4/0:2000' })).toEqual(['src/new.ts'])
    expect(changedPaths({}, { 'src/a.ts': '1/1:1000' })).toEqual(['src/a.ts'])
    expect(changedPaths({ 'src/a.ts': '1/1:1000' }, { 'src/a.ts': '2/1:1000' })).toEqual(['src/a.ts'])
  })
})

// #292: a reset moves HEAD and leaves the files, so a moved base alone would read everything it uncovered as written.
describe('changedAround', () => {
  test('with the base unmoved it is changedPaths', () => {
    expect(changedAround({}, { 'src/a.ts': '1/1:9' }, null)).toEqual(['src/a.ts'])
  })

  test('once the base moved, a path counts only if it also changed against the old one', () => {
    const uncovered = { 'src/a.ts': '1/1:9', 'src/c.ts': '4/0:5' }
    expect(changedAround({}, uncovered, { 'src/a.ts': '1/1:9' })).toEqual(['src/a.ts'])
    expect(changedAround({}, { 'src/a.ts': '1/1:9' }, uncovered)).toEqual(['src/a.ts'])
  })

  test('a path committed unchanged is still no change against either base', () => {
    const before = { 'src/a.ts': '3/1:1000' }
    expect(changedAround(before, {}, {}, { 'src/a.ts': 1000 })).toEqual([])
  })
})

// #292: both snapshots compare against one commit, so a write the command also stages or commits still shows. What a
// plain commit made is the command's own work; anything else git did to HEAD brought in code that isn't.
describe('baseAfter', () => {
  const [OLD, ONE, TWO, THREE] = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(40)) as [string, string, string, string]
  const reflog = (...lines: string[]) => `${lines.join('\n')}\n`

  test('a HEAD that did not move keeps its base, with no reflog to read', () => {
    expect(baseAfter(OLD, OLD, '')).toBe(OLD)
  })

  test('commits keep the base, amended ones too', () => {
    expect(baseAfter(OLD, TWO, reflog(`${TWO} commit: two`, `${ONE} commit (amend): one`, `${OLD} commit: start`))).toBe(OLD)
  })

  test('anything else git did to HEAD moves the base to it', () => {
    for (const subject of ['pull: Fast-forward', 'pull -q --rebase (finish): returning', 'merge b: Merge made by the \'ort\' strategy.', 'checkout: moving from a to b', 'reset: moving to HEAD~1', 'cherry-pick: three', 'revert: Revert x', 'rebase (finish): returning', 'am: x', 'commit (merge): m', 'commit (cherry-pick): c', 'commit (initial): i']) {
      expect(baseAfter(OLD, ONE, reflog(`${ONE} ${subject}`, `${OLD} commit: start`))).toBe(ONE)
    }
  })

  test('commits after a pull are the command\'s work, so the base is the pull', () => {
    expect(baseAfter(OLD, TWO, reflog(`${TWO} commit: mine`, `${ONE} pull: Fast-forward`, `${OLD} commit: start`))).toBe(ONE)
  })

  test('the newest move wins, so a commit before a pull is out of reach', () => {
    expect(baseAfter(OLD, TWO, reflog(`${TWO} pull: Fast-forward`, `${ONE} commit: mine`, `${OLD} commit: start`))).toBe(TWO)
  })

  test('entries older than the old HEAD belong to earlier commands', () => {
    expect(baseAfter(OLD, ONE, reflog(`${ONE} commit: mine`, `${OLD} commit: start`, `${THREE} pull: Fast-forward`))).toBe(OLD)
  })

  test('an entry with no subject, from plumbing, is not a commit', () => {
    expect(baseAfter(OLD, ONE, `${ONE} \n${OLD} commit: start\n`)).toBe(ONE)
  })

  test('a line that is no entry is skipped: log.showSignature prints them on stdout', () => {
    expect(baseAfter(OLD, ONE, reflog('Good "git" signature for x', `${ONE} commit: mine`, `${OLD} commit: start`))).toBe(OLD)
  })

  test('a SHA-256 repository\'s entries are read', () => {
    const [old, next] = ['a', 'b'].map(letter => letter.repeat(64)) as [string, string]
    expect(baseAfter(old, next, reflog(`${next} commit: mine`, `${old} commit: start`))).toBe(old)
  })

  test('a reflog that cannot say what happened is null, for the caller to say so', () => {
    expect(baseAfter(OLD, ONE, '')).toBeNull()
    expect(baseAfter(OLD, TWO, reflog(`${TWO} commit: mine`, `${ONE} commit: mine too`))).toBeNull()
  })

  test('only an entry that starts as a commit is one', () => {
    expect(baseAfter(OLD, ONE, reflog(`${ONE} rebase (pick): commit: x`, `${OLD} commit: start`))).toBe(ONE)
  })
})

describe('baseFor', () => {
  const [OLD, ONE] = ['a', 'b'].map(letter => letter.repeat(40)) as [string, string]

  test('with no commit before the command there is no base, and nothing to say, even after a first commit', () => {
    expect(baseFor(null, null, '')).toEqual({ base: null, unread: false })
    expect(baseFor(null, ONE, '')).toEqual({ base: null, unread: false })
  })

  test('a HEAD that did not move is the base', () => {
    expect(baseFor(OLD, OLD, '')).toEqual({ base: OLD, unread: false })
  })

  test('what the reflog gives is the base', () => {
    expect(baseFor(OLD, ONE, `${ONE} commit: x\n${OLD} commit: start\n`)).toEqual({ base: OLD, unread: false })
  })

  test('a reflog that cannot say leaves the new HEAD as the base, and says so', () => {
    expect(baseFor(OLD, ONE, '')).toEqual({ base: ONE, unread: true })
  })

  test('a HEAD that can no longer be read leaves the index, and says so', () => {
    expect(baseFor(OLD, null, '')).toEqual({ base: null, unread: true })
  })
})

describe('isRevertCommand', () => {
  test('git commands that rewrite the working tree are reverts, not edits', () => {
    for (const command of [
      'git checkout -- src/App.tsx',
      'git restore src/utils/a.ts',
      'git stash',
      'git stash pop',
      'git reset --hard HEAD~1',
      'cd packages/app && git switch main',
    ]) {
      expect(isRevertCommand(command)).toBe(true)
    }
  })

  test('other git commands and ordinary shell commands are not', () => {
    for (const command of ['git status', 'git diff src/App.tsx', 'git commit -m x', "sed -i 's/a/b/' src/App.tsx", 'npx vitest run']) {
      expect(isRevertCommand(command)).toBe(false)
    }
  })

  test('a patch the agent applies is its own edit, and listing the stash only reads', () => {
    expect(isRevertCommand("git apply <<'EOF'\n--- a/src/App.tsx\n+++ b/src/App.tsx\nEOF")).toBe(false)
    expect(isRevertCommand('git apply fix.patch')).toBe(false)
    expect(isRevertCommand('git stash list')).toBe(false)
    expect(isRevertCommand('git stash show -p')).toBe(false)
  })
})

// Karl's trial (2026-10-19): git restore logged nothing, which is right for code put back to HEAD. But git can also
// write code from another branch, a stash or a commit, and that went by just as silently: it is now said.
describe('bringsInCode', () => {

  test('putting a file back as it is at HEAD brings nothing in', () => {
    for (const command of ['git restore src/a.ts', 'git restore --staged --worktree api.py', 'git checkout -- api.py', 'git checkout HEAD -- api.py', 'git checkout api.py', 'git reset --hard', 'git reset --hard HEAD', 'git stash', 'git stash push -m wip', 'git clean -fd']) {
      expect(bringsInCode(command)).toBe(false)
    }
  })

  // Verified review D3 (2026-10-20): a branch or tag with a dot read as a file restore, so the switch went unsaid.
  test('a dotted branch or tag is a switch, not a file: only a letter extension makes a file', () => {
    expect(bringsInCode('git checkout v2.0')).toBe(true)
    expect(bringsInCode('git checkout release.1')).toBe(true)
    expect(bringsInCode('git checkout main.py')).toBe(false)
  })

  test('code from another branch, a commit, a stash or a remote is brought in', () => {
    for (const command of ['git checkout main -- api.py', 'git checkout feature/x', 'git restore --source=main api.py', 'git restore -s HEAD~2 api.py', 'git switch main', 'git stash pop', 'git stash apply stash@{1}', 'git reset --hard HEAD~1', 'git pull', 'git merge main', 'git cherry-pick abc123', 'git revert abc123', 'cd app && git checkout main -- src/a.ts']) {
      expect(bringsInCode(command)).toBe(true)
    }
  })

  test('commands that are not tree rewrites bring nothing in', () => {
    for (const command of ['git status', 'git diff main -- api.py', 'git log', "sed -i 's/a/b/' api.py"]) {
      expect(bringsInCode(command)).toBe(false)
    }
  })
})

// Verified review B1 (2026-10-20): what the record keeps of a git command is its verb, never its arguments, where a
// token in a remote URL can sit.
describe('gitVerb', () => {
  test('the git subcommand, and the stash action, and nothing else', () => {
    expect(gitVerb('git pull https://me:not-a-token@github.com/acme/app main')).toBe('git pull')
    expect(gitVerb('cd app && git checkout main -- src/a.ts')).toBe('git checkout')
    expect(gitVerb('git stash pop')).toBe('git stash pop')
    expect(gitVerb('git -c http.extraheader=AUTH fetch origin')).toBe('git fetch')
    expect(gitVerb('npm test')).toBe('git')
  })

  test('a rewrite that brought code beats any git step before it', () => {
    expect(gitVerb('git fetch origin && git merge --squash origin/other')).toBe('git merge')
    expect(gitVerb('git add -A && git stash pop')).toBe('git stash pop')
    expect(gitVerb('git restore src/a.ts && git merge --squash feature')).toBe('git merge')
    expect(gitVerb('git stash && git pull && git stash pop')).toBe('git pull')
    expect(gitVerb('git restore src/a.ts')).toBe('git restore')
  })
})

// Verified review A6 (2026-10-20): the override record's backstop stood down for any command with a git segment.
describe('isGitOnly', () => {
  test('a command made of git alone, after cds, is git only', () => {
    for (const command of ['git pull', 'git checkout main && git pull --rebase', 'cd app && git merge main']) {
      expect(isGitOnly(command)).toBe(true)
    }
  })

  test('git beside anything else is not', () => {
    for (const command of ['node forge.js; git status', 'git status && node forge.js', "echo '{}' > x.json | git add x.json", 'npm test']) {
      expect(isGitOnly(command)).toBe(false)
    }
  })
})

// #348: a here-string opener anywhere kept the whole command one segment, so a script after a here-string commit
// message read as git alone (the record backstop stood down) or as a revert only (a script's write went unsaid). The
// commands are now the shell's own: Bash has no here-strings, and PowerShell's are blanked before the split.
describe('git alone, a revert only and code brought in are judged by the shell that runs the command (#348)', () => {
  const quiet = (segment: string) => /^\s*(?:pytest|npm test)\b/.test(segment)

  test('a script after a here-string message is not git alone, under either shell', () => {
    expect(isGitOnly("git commit -m @'\nmsg\n'@\nnode tidy.mjs", 'powershell')).toBe(false)
    expect(isGitOnly(`git commit -qm "see @'\n" && node tidy.mjs`, 'bash')).toBe(false)
    expect(isGitOnly('git add src\\\nnode tidy.mjs', 'powershell')).toBe(false)
  })

  test('git alone with a here-string message is still git alone', () => {
    expect(isGitOnly("git merge other -m @'\nit's\n'@", 'powershell')).toBe(true)
    expect(isGitOnly("git stash push -m @'\nwip\n'@\ngit pull\ngit stash pop", 'powershell')).toBe(true)
    expect(isGitOnly(`git commit -qm "see @'\n"`, 'bash')).toBe(true)
  })

  test('a script after a revert and a here-string is not a revert only', () => {
    expect(isRevertOnly("git checkout -- api.py\n$t = @'\nx\n'@\nnode fix.mjs", quiet, 'powershell')).toBe(false)
    expect(isRevertOnly(`git checkout -- api.py && echo "@'\n" && node fix.mjs`, quiet, 'bash')).toBe(false)
    expect(isRevertOnly("git stash push -m @'\nwip\n'@\ngit pull\ngit stash pop", quiet, 'powershell')).toBe(true)
  })

  // Review round 1: a script inside `bash -c`, or one an `@"` here-string runs as its own stage, is not git.
  test('a script handed to a shell, or run by a here-string stage, is not git alone or a revert only', () => {
    expect(isGitOnly(`bash -c 'git status\necho "@"\nnode scripts/tidy.mjs'`, 'bash')).toBe(false)
    expect(isRevertOnly(`sh -c 'git restore README.md\necho "@"\npython /tmp/fix.py'`, quiet, 'bash')).toBe(false)
    expect(isGitOnly('@"\nFix: $(node scripts/tidy.mjs)\n"@ | git commit -F -', 'powershell')).toBe(false)
    expect(isRevertOnly('@"\n$(python fix.py)\n"@\ngit restore README.md', quiet, 'powershell')).toBe(false)
  })

  // Review round 2: a message piped from a here-string into `git commit -F -` runs nothing of its own.
  test('a here-string message piped into git commit leaves the command git alone and a revert only', () => {
    expect(isGitOnly("git pull\n@'\nmerge notes\n'@ | git commit -F -", 'powershell')).toBe(true)
    expect(isRevertOnly("git checkout other -- src/App.tsx\n@'\nbring App\n'@ | git commit -F -", quiet, 'powershell')).toBe(true)
  })

  test('code another rewrite in the command brings in is seen past a here-string', () => {
    const command = "git checkout -- src/a.ts\ngit checkout other -- src/b.ts\ngit commit -m @'\nbring b\n'@"
    expect(bringsInCode(command, 'powershell')).toBe(true)
    expect(gitVerb(command, 'powershell')).toBe('git checkout')
    // Kept whole, the stash's message ran into the pull, and the verb read as the stash's.
    expect(gitVerb("git stash push -m @'\nx\n'@\ngit pull", 'powershell')).toBe('git pull')
  })
})

// Verified review A7 (2026-10-20): one git rewrite segment emptied the change list for the whole command, so
// `python fix.py; git restore x` counted nothing. Only a command of git rewrites, cds and quiet segments is skipped.
describe('isRevertOnly', () => {
  const quiet = (segment: string) => /^\s*(?:pytest|npm test)\b/.test(segment)
  test('git rewrites, with cds and quiet segments beside them, are a revert only', () => {
    for (const command of ['git restore src/a.py', 'git stash && pytest', 'cd app && git checkout -- src/a.ts && npm test']) {
      expect(isRevertOnly(command, quiet)).toBe(true)
    }
  })

  test('a revert beside anything that could write is not, and neither is no revert at all', () => {
    for (const command of ['python /tmp/fix.py; git restore README.md', 'git restore a && node gen.js', 'pytest', 'git status']) {
      expect(isRevertOnly(command, quiet)).toBe(false)
    }
  })

  // #292: what git staged is compared against a commit now, so committing it must not read as the command's own write.
  test('staging or committing what a rewrite brought is still a revert only', () => {
    for (const command of ['git merge --squash feature && git commit -qm m', 'git cherry-pick -n other && git commit -qm p', 'git revert -n HEAD && git commit -qm r', 'git checkout other -- src/d.ts && git commit -qm t', 'git stash pop && git add -A && git commit -qm wip', 'git reset --soft HEAD~3 && git commit -qm squashed']) {
      expect(isRevertOnly(command, quiet)).toBe(true)
    }
  })

  test('so is anything else git does that leaves the tree alone', () => {
    for (const command of ['git checkout other -- src/d.ts && git commit -qm t && git push', 'git fetch origin && git checkout origin/other -- src/d.ts', 'git fetch origin && git merge --squash origin/other', 'git stash pop && git add -A && git commit -qm wip && git push', 'git checkout other -- src/d.ts && git tag -f v1']) {
      expect(isRevertOnly(command, quiet)).toBe(true)
    }
  })

  test('staging or committing with no rewrite, or beside a script, is not', () => {
    for (const command of ['git commit -qam x', 'git add -A && git commit -qm x', 'python3 fix.py && git commit -qam x', 'git stash pop && python3 fix.py && git commit -qam x']) {
      expect(isRevertOnly(command, quiet)).toBe(false)
    }
  })

  // Reading past git's own options took three designs and let another repository's write through in silence (#302), so
  // these read as a script: wrongly charged at worst, never excused.
  test('git\'s own options before the verb read as a script, so nothing is excused', () => {
    for (const command of ['git -C . checkout other -- src/d.ts', 'git --no-pager checkout other -- src/d.ts', 'git --git-dir=../shadow/.git --work-tree=. checkout -- src/a.ts', 'git -c alias.clean-up=!./fix.sh clean-up', 'git checkout other -- src/d.ts && git -c core.hooksPath=h commit -qm t']) {
      expect(isRevertOnly(command, quiet)).toBe(false)
    }
  })

  test('a name that only starts like one of those verbs, or a wrapper in front, is not', () => {
    for (const command of ['git stash pop && git add-fix', 'git stash pop && git commit-tree x', 'git stash pop && ./wrap.sh git commit -qm x']) {
      expect(isRevertOnly(command, quiet)).toBe(false)
    }
  })
})
