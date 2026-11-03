import { describe, expect, test } from 'claude-code/testing'

import { ELSEWHERE, commandSegments, cwdAfter, executedText, isPureRead, locatedSegments, splitCommands, writableText } from '../hooks/shell'

// The catch check's mutant on #348: a data heredoc's body never runs, so only its opener line is executed; a one-line
// segment is all executed.
describe('executedText: the part of a segment that runs', () => {
  test("a data heredoc runs only its opener line, and a one-line segment runs whole", () => {
    expect(executedText("cat > notes.md <<'EOF'\nnpm test\nEOF")).toBe("cat > notes.md <<'EOF'")
    expect(executedText('bash <<EOF\nnpm test\nEOF')).toBe('bash <<EOF\nnpm test\nEOF')
    expect(executedText('npm test')).toBe('npm test')
  })
})

// #348: commandSegments keeps any command with a here-string opener whole, so a script after a here-string commit
// message read as git alone. splitCommands splits by the shell that runs the command: Bash has no here-strings, and
// PowerShell's closed ones (the narrow opener, outside quotes) are blanked first, so they read as inline whitespace.
describe('splitCommands: the commands a shell runs', () => {
  test("under Bash an @' in quoted text is text, and the command splits", () => {
    expect(splitCommands(`git commit -qm "see @'\n" && node tidy.mjs`, 'bash')).toEqual([`git commit -qm "see @'\n"`, 'node tidy.mjs'])
  })

  test('under PowerShell a closed literal here-string is whitespace inside its command, and the next line is a command', () => {
    const [commit, script, ...rest] = splitCommands("git commit -m @'\nmsg; with | marks\n'@\nnode tidy.mjs", 'powershell')
    expect(commit?.startsWith('git commit -m')).toBe(true)
    expect(commit).not.toMatch(/msg|\|/)
    expect(script).toBe('node tidy.mjs')
    expect(rest).toEqual([])
    expect(splitCommands("git merge other -m @'\nit's\n'@", 'powershell')).toHaveLength(1)
    expect(splitCommands("git merge other -m @'\r\nit's\r\n'@ --no-ff", 'powershell')).toHaveLength(1)
  })

  test('under PowerShell an empty here-string closes on the next line, not at a later close', () => {
    expect(splitCommands("git commit -m @'\n'@\nnode forge.mjs\ngit tag -a v1 -m @'\nx\n'@", 'powershell')).toContain('node forge.mjs')
  })

  test('under PowerShell an opener inside quotes is text, and an opener with a space after it is no here-string', () => {
    expect(splitCommands(`git status "@'\n" ; node forge.mjs ; echo "\n'@"`, 'powershell')).toContain('node forge.mjs')
    expect(splitCommands("git status .@'  \n'\nnode forge.mjs\necho x'\n'@", 'powershell')).toContain('node forge.mjs')
  })

  // The design attack on #348: PowerShell has no backslash escape, so `src\` at a line end ends the command there.
  test('under PowerShell a backslash escapes nothing; under Bash it still does', () => {
    expect(splitCommands('git add src\\\nnode tidy.mjs', 'powershell')).toEqual(['git add src\\', 'node tidy.mjs'])
    expect(splitCommands('git add src\\;node tidy.mjs', 'powershell')).toEqual(['git add src\\', 'node tidy.mjs'])
    expect(splitCommands('git add src\\;node tidy.mjs', 'bash')).toHaveLength(1)
  })

  // Review round 1: text handed to `bash -c` went back through commandSegments' one-segment rule, so a line ending in
  // `@"` kept the inner text whole, and it started with git. A handed shell's text is Bash, split as Bash.
  test("text handed to a shell is split as Bash, whatever @ it holds", () => {
    for (const shell of ['bash', 'powershell'] as const) {
      expect(splitCommands(`bash -c 'git status\necho "@"\nnode scripts/tidy.mjs'`, shell)).toContain('node scripts/tidy.mjs')
    }
  })

  // Review round 1: a here-string that is a stage of its own stays one, as its plain-string form does, since an `@"` one
  // can run `$(...)`. It reads as one `@` word.
  test('under PowerShell a here-string that is its own stage stays a stage', () => {
    expect(splitCommands('@"\nFix: $(node scripts/tidy.mjs)\n"@ | git commit -F -', 'powershell')).toEqual(['@', 'git commit -F -'])
  })

  // Review round 2: a here-string that runs nothing (a literal one, or an `@"` one with no `$(…)`) is no command, so a
  // message piped into `git commit -F -` leaves the commit git alone.
  test('under PowerShell a here-string that runs nothing is no stage', () => {
    expect(splitCommands("git checkout other -- src/App.tsx\n@'\nbring App\n'@ | git commit -F -", 'powershell')).toEqual(['git checkout other -- src/App.tsx', 'git commit -F -'])
    expect(splitCommands('@"\nFix the $name release\n"@ | git commit -F -', 'powershell')).toEqual(['git commit -F -'])
    // A literal one runs nothing whatever it holds, `$(…)` included.
    expect(splitCommands("git pull\n@'\nuse $(x) in the docs\n'@ | git commit -F -", 'powershell')).toEqual(['git pull', 'git commit -F -'])
  })

  test('a command with no here-string splits as commandSegments does', () => {
    for (const command of ['git pull && git push', "echo 'a; b' | grep a", 'cd app; npm test']) {
      expect(splitCommands(command, 'bash')).toEqual(commandSegments(command))
      expect(splitCommands(command, 'powershell')).toEqual(commandSegments(command))
    }
  })
})

// The heredoc false positive (2026-10-18): a data heredoc's body is text and writes nothing; a body fed to an
// interpreter or a shell is code, and its writes are real.
describe('writableText: the part of a segment that can write', () => {
  const body = "open(p,'w').write(x)\nsee hooks/a.ts\nEOF"

  test('a heredoc fed to cat, tee or gh: only the opener line', () => {
    expect(writableText(`cat > /tmp/r.mjs <<'EOF'\n${body}`)).toBe("cat > /tmp/r.mjs <<'EOF'")
    expect(writableText(`tee -a notes.md <<EOF\n${body}`)).toBe('tee -a notes.md <<EOF')
  })

  test('a heredoc fed to an interpreter or a shell: the whole segment, body and all', () => {
    for (const opener of ["python - <<'PY'", "python3 <<'PY'", "node --input-type=module <<'EOF'", 'bash <<EOF', 'C:/Python/python.exe - <<PY']) {
      expect(writableText(`${opener}\n${body}`)).toBe(`${opener}\n${body}`)
    }
  })

  test('no heredoc: the segment as it is', () => {
    expect(writableText('echo x > src/a.ts')).toBe('echo x > src/a.ts')
  })
})

describe('commandSegments', () => {
  test('splits on the shell operators', () => {
    expect(commandSegments('git stash && npm test; echo done || true | tail -3')).toEqual([
      'git stash',
      'npm test',
      'echo done',
      'true',
      'tail -3',
    ])
  })

  test('leaves operators inside quotes alone, so a two-expression sed is one command', () => {
    expect(commandSegments("sed -i 's/a/b/;s/c/d/' src/utils/a.ts")).toEqual(["sed -i 's/a/b/;s/c/d/' src/utils/a.ts"])
    expect(commandSegments('echo "a && b | c"; cat x')).toEqual(['echo "a && b | c"', 'cat x'])
    expect(commandSegments("sed -i 's/a|b/' src/x.ts")).toEqual(["sed -i 's/a|b/' src/x.ts"])
  })

  test('honours an escaped quote inside double quotes and an escaped operator outside them', () => {
    expect(commandSegments('echo "say \\"hi\\"; bye" | wc')).toEqual(['echo "say \\"hi\\"; bye"', 'wc'])
    expect(commandSegments('echo a\\;b; echo c')).toEqual(['echo a\\;b', 'echo c'])
  })

  test('keeps a heredoc or a PowerShell here-string whole, because its body is data', () => {
    const heredoc = "cat > src/a.ts <<'EOT'\nx; y | z\nEOT"
    const hereString = "Set-Content src/a.ts @'\nx; y | z\n'@"
    expect(commandSegments(heredoc)).toEqual([heredoc])
    expect(commandSegments(hereString)).toEqual([hereString])
  })

  // Review round 3 of #346: keeping a command whole for a wider opener (`@'` and a space before the line end) made a
  // git commit and the script after it one segment, which reads as git alone, so the record backstop skipped the
  // script's write. Only the plain opener keeps a command whole, as on main; that one is #348.
  test("splits a command whose @' has anything but a line end after it", () => {
    expect(commandSegments("git commit -qm \"see @' \n\" && node scripts/tidy.mjs")).toHaveLength(2)
    expect(commandSegments("git commit -qm \"see @'\u{a0}\n\" && node scripts/tidy.mjs")).toHaveLength(2)
  })

  test('a heredoc body stays with the command that opened it, and what follows the terminator is split as usual', () => {
    const command = "cat > notes.md <<'EOT'\nx; y | z\nEOT\nsed -i 's/a/b/' index.md && echo done"
    expect(commandSegments(command)).toEqual(["cat > notes.md <<'EOT'\nx; y | z\nEOT", "sed -i 's/a/b/' index.md", 'echo done'])
  })

  test('a wrapper that only runs the command after it is dropped, so the segment is what runs (2026-10-19)', () => {
    expect(commandSegments('timeout 60 cp a.ts src/b.ts && time -p nice -n 5 env -i CI=1 npm test')).toEqual(['cp a.ts src/b.ts', 'CI=1 npm test'])
    expect(commandSegments('timeout --preserve-status -k 5 10s make')).toEqual(['make'])
  })

  test('command, exec, xvfb-run, stdbuf and ionice are wrappers too', () => {
    expect(commandSegments('command npm test; exec pytest -q')).toEqual(['npm test', 'pytest -q'])
    expect(commandSegments('xvfb-run -a npx vitest run && xvfb-run --auto-servernum -s "-screen 0 1280x1024x24" npm test')).toEqual(['npx vitest run', 'npm test'])
    expect(commandSegments('stdbuf -oL -eL npm test; ionice -c 2 -n 7 npm test')).toEqual(['npm test', 'npm test'])
  })

  test('a brace group is the commands inside it', () => {
    expect(commandSegments('{ npm test; echo done; } | tail -5')).toEqual(['npm test', 'echo done', 'tail -5'])
  })

  test('sh -c and bash -c are the command they are handed, split as usual', () => {
    expect(commandSegments('bash -c "cd app && npm test" | tail -5')).toEqual(['cd app', 'npm test', 'tail -5'])
    expect(commandSegments("sh -c 'pytest -q'")).toEqual(['pytest -q'])
    expect(commandSegments('bash -lc "echo \\"hi\\"; npm test"')).toEqual(['echo "hi"', 'npm test'])
  })

  test('a wrapper with nothing after it stays as written', () => {
    expect(commandSegments('env; time')).toEqual(['env', 'time'])
    expect(commandSegments('timeout 60')).toEqual(['timeout 60'])
  })

  test('drops empty segments', () => {
    expect(commandSegments('a;; b')).toEqual(['a', 'b'])
  })
})

describe('locatedSegments', () => {
  test('a cd moves the segments after it, relative or absolute, and resolves ..', () => {
    const located = locatedSegments('cd server && npx vitest run src/a.test.ts; cd ../shared; npm test | tail -3', 'C:/work')
    expect(located.map(({ cwd }) => cwd)).toEqual(['C:/work', 'C:/work/server', 'C:/work/server', 'C:/work/shared', 'C:/work/shared'])
    expect(locatedSegments('cd /tmp/x && ls', 'C:/work')[1]?.cwd).toBe('/tmp/x')
    expect(locatedSegments('cd "C:/other repo" && ls', 'C:/work')[1]?.cwd).toBe('C:/other repo')
  })

  test('cd alone, cd - and cd ~ go somewhere this cannot see', () => {
    expect(locatedSegments('cd && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
    expect(locatedSegments('cd - && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
    expect(locatedSegments('cd ~/x && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
    expect(locatedSegments('cd ~ && cd C:/back && ls', 'C:/work')[2]?.cwd).toBe('C:/back')
  })

  // #69: `R=/tmp/x; cd $R` was read as a folder named `$R` inside the project, so scratch files were gated.
  test('a cd through a variable set earlier in the command goes where the variable points', () => {
    expect(locatedSegments('R=/tmp/scratch/repro; mkdir -p $R && cd $R && ls', 'C:/work')[3]?.cwd).toBe('/tmp/scratch/repro')
    expect(locatedSegments('export R="C:/other repo"; cd "${R}" && ls', 'C:/work')[2]?.cwd).toBe('C:/other repo')
    expect(locatedSegments('D=server; cd $D && ls', 'C:/work')[2]?.cwd).toBe('C:/work/server')
  })

  test('a cd through a variable or command this cannot expand goes somewhere it cannot see', () => {
    expect(locatedSegments('cd $SOMEWHERE && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
    expect(locatedSegments('cd "$(mktemp -d)" && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
    expect(locatedSegments('cd %TEMP% && ls', 'C:/work')[1]?.cwd).toBe(ELSEWHERE)
  })
})

// Verified review D7 (2026-10-20): only `cd` moved the shell, so a PowerShell session that changed folder another way
// resolved later relative paths against the root, and `cd -Path sub` went to a folder named "-Path sub".
describe('cwdAfter: every way a shell changes folder', () => {
  test('PowerShell and bash spellings move it, with or without -Path', () => {
    for (const command of ['Set-Location sub', 'sl sub', 'pushd sub', 'Push-Location sub', 'cd -Path sub', 'Set-Location -LiteralPath sub', 'chdir sub']) {
      expect(cwdAfter(command, 'C:/r')).toBe('C:/r/sub')
    }
  })

  test('cd keeps working as before', () => {
    expect(cwdAfter('cd sub', 'C:/r')).toBe('C:/r/sub')
    expect(cwdAfter('cd sub && cd ..', 'C:/r')).toBe('C:/r')
  })
})

describe('isPureRead', () => {
  // Karl's round 4 (2026-10-20): a hash beside a git checkout read as a possible write, so git's code was charged
  // to the agent. Hashing a file only reads it.
  test('hashing a file only reads it', () => {
    for (const command of ['sha256sum api.py', 'sha1sum a b', 'md5sum api.py', 'shasum -a 256 api.py', 'cksum api.py', 'Get-FileHash api.py']) {
      expect(isPureRead(command)).toBe(true)
    }
  })

  test('a hash written to a file, or a command that writes, is not a read', () => {
    for (const command of ['sha256sum api.py > sums.txt', 'sha256sum -c sums.txt; sed -i s/a/b/ api.py', 'cp a b']) {
      expect(isPureRead(command)).toBe(false)
    }
  })

  // #304: every wider pattern tried here charged reads that write nothing, so these stay read until the proper reader (#260).
  test('stderr and streams joined to one another stay reads, on any null device PowerShell or cmd uses too', () => {
    for (const command of ['ls 2>&1', 'ls >&2', 'ls >& 2', 'ls 2>/dev/null', 'git status 2>$null', 'cat a 2>nul', 'ls > /dev/null']) {
      expect(isPureRead(command)).toBe(true)
    }
  })
})
