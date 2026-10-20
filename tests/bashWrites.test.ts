import { describe, expect, test } from 'claude-code/testing'

import { findSourceWrites, writesFileNamed } from '../hooks/bashWrites'
import { ELSEWHERE } from '../hooks/shell'

describe('findSourceWrites', () => {
  test('sees in-place sed edits of source files', () => {
    expect(findSourceWrites("sed -i 's/a/b/' src/utils/formatDuration.ts")).toEqual(['src/utils/formatDuration.ts'])
  })

  test('sees a sed with two expressions, where the semicolon is inside the quotes', () => {
    expect(findSourceWrites("sed -i 's/a/b/;s/c/d/' src/utils/a.ts")).toEqual(['src/utils/a.ts'])
    expect(findSourceWrites("sed -i 's/a|b/c/' src/utils/a.ts")).toEqual(['src/utils/a.ts'])
  })

  test('sees redirects and tee into source files', () => {
    expect(findSourceWrites('echo x > src/App.tsx')).toEqual(['src/App.tsx'])
    expect(findSourceWrites('cat <<END >> src/data/career.ts\nx\nEND')).toEqual(['src/data/career.ts'])
    expect(findSourceWrites('printf x | tee src/main.tsx')).toEqual(['src/main.tsx'])
  })

  test('sees scripts that write a named source file', () => {
    const python = "python - <<'PY'\np='src/components/CareerTimeline.tsx'\ns=open(p).read()\nopen(p,'w').write(s)\nPY"
    const node = "node -e \"require('fs').writeFileSync('src/theme/hueso.ts','x')\""
    expect(findSourceWrites(python)).toEqual(['src/components/CareerTimeline.tsx'])
    expect(findSourceWrites(node)).toEqual(['src/theme/hueso.ts'])
  })

  test('sees PowerShell writes', () => {
    expect(findSourceWrites("Set-Content -Path src/utils/a.ts -Value 'x'")).toEqual(['src/utils/a.ts'])
    expect(findSourceWrites("'x' | Out-File src\\utils\\a.ts")).toEqual(['src/utils/a.ts'])
    expect(findSourceWrites('Add-Content src/utils/a.ts "y"')).toEqual(['src/utils/a.ts'])
    expect(findSourceWrites('Get-Content src/utils/a.ts')).toEqual([])
  })

  test('sees copies and moves into src/', () => {
    expect(findSourceWrites('cp /tmp/x.ts src/utils/x.ts')).toEqual(['src/utils/x.ts'])
    expect(findSourceWrites('mv old.tsx src/components/New.tsx')).toEqual(['src/components/New.tsx'])
  })

  test('ignores reads, searches and test runs that merely mention source files', () => {
    expect(findSourceWrites('cat src/App.tsx')).toEqual([])
    expect(findSourceWrites('grep -n color src/components/CareerTimeline.tsx')).toEqual([])
    expect(findSourceWrites('npx vitest run tests/utils/formatDuration.test.ts')).toEqual([])
    expect(findSourceWrites('git diff src/App.tsx > /tmp/patch.diff')).toEqual([])
  })

  test('sees writes to code files of every stack, wherever they sit; the layout decides later which are source', () => {
    expect(findSourceWrites("sed -i 's/a/b/' app/models.py")).toEqual(['app/models.py'])
    expect(findSourceWrites('echo x > scripts/player.gd')).toEqual(['scripts/player.gd'])
    expect(findSourceWrites('cp /tmp/Foo.java src/main/java/com/x/Foo.java')).toEqual(['src/main/java/com/x/Foo.java'])
    expect(findSourceWrites("sed -i 's/a/b/' packages/api/lib/handler.js")).toEqual(['packages/api/lib/handler.js'])
    expect(findSourceWrites("sed -i 's/a/b/' Player.cs")).toEqual(['Player.cs'])
  })

  test('ignores writes to test files and non-ts files under src', () => {
    expect(findSourceWrites("sed -i 's/a/b/' tests/utils/a.test.ts")).toEqual([])
    expect(findSourceWrites('echo x >> src/index.css')).toEqual([])
  })

  test('a write in one part of a command does not make every other mentioned path a write', () => {
    expect(findSourceWrites("sed -i 's/a/b/' tests/utils/a.test.ts && cat src/utils/b.ts")).toEqual([])
    expect(findSourceWrites("cat src/utils/b.ts | sed -i 's/a/b/' src/utils/c.ts")).toEqual(['src/utils/c.ts'])
    expect(findSourceWrites("grep -n x src/App.tsx; echo done > src/main.tsx")).toEqual(['src/main.tsx'])
  })

  test('a data heredoc that only mentions a source path in its body is not a write, even with an in-place sed later in the command', () => {
    const note = "cat >> notes/log.md <<'EOF'\nlayout: src/api/rate-limit.ts beside rate-limit.test.ts\nEOF\nsed -i 's/a/b/' notes/index.md"
    expect(findSourceWrites(note)).toEqual([])
  })

  test('a script whose writes name their targets writes only those: a source path elsewhere in it is data', () => {
    const editsATest = [
      "python3 - <<'EOF'",
      "s = open('tests/wiring.test.tsx').read()",
      "s = s.replace(\"editAt($, 'src/utils/a.ts')\", \"editAt($, 'src/utils/b.ts')\")",
      "open('tests/wiring.test.tsx', 'w').write(s)",
      'EOF',
    ].join('\n')
    const withBlock = "python - <<'PY'\nold = open('src/legacy/a.py').read()\nwith open('src/pkg/calc.py', 'w') as f:\n    f.write(old)\nPY"
    const node = "node -e \"const fs=require('fs'); fs.writeFileSync('src/b.ts', fs.readFileSync('src/a.ts','utf8'))\""
    const pathlib = "python - <<'PY'\nfrom pathlib import Path\nPath('src/pkg/calc.py').write_text(open('src/pkg/old.py').read())\nPY"
    expect(findSourceWrites(editsATest)).toEqual([])
    expect(findSourceWrites(withBlock)).toEqual(['src/pkg/calc.py'])
    expect(findSourceWrites(node)).toEqual(['src/b.ts'])
    expect(findSourceWrites(pathlib)).toEqual(['src/pkg/calc.py'])
  })

  test('a script whose write target is not a literal still counts every source path it names', () => {
    // Since 2026-10-18 a name assigned once to a plain string is traced to it: src/b.py is only read.
    const viaVariable = "python - <<'PY'\ntarget = 'src/a.py'\nopen(target, 'w').write(open('src/b.py').read())\nPY"
    const unknownStream = "node -e \"stream.write(require('fs').readFileSync('src/a.ts'))\""
    expect(findSourceWrites(viaVariable)).toEqual(['src/a.py'])
    expect(findSourceWrites(unknownStream)).toEqual(['src/a.ts'])
  })

  test('printing a source file to stdout from a script is a read', () => {
    expect(findSourceWrites("node -e \"process.stdout.write(require('fs').readFileSync('src/App.tsx','utf8'))\"")).toEqual([])
    expect(findSourceWrites("python -c \"import sys; sys.stdout.write(open('src/App.tsx').read())\"")).toEqual([])
  })

  test('keeps absolute and drive-letter paths whole so the caller can tell which repo they are in', () => {
    expect(findSourceWrites("sed -i 's/a/b/' /c/Users/me/throughline/src/App.tsx")).toEqual(['/c/Users/me/throughline/src/App.tsx'])
    expect(findSourceWrites("python - <<'PY'\nopen('C:/Users/me/throughline/src/App.tsx','w')\nPY")).toEqual(['C:/Users/me/throughline/src/App.tsx'])
  })

  test('reports each written source file once, also with Windows separators', () => {
    expect(findSourceWrites("sed -i 's/a/b/' src\\App.tsx src/App.tsx")).toEqual(['src/App.tsx'])
  })

  test('refuses a path that climbs out with .., so nothing downstream writes outside the root', () => {
    expect(findSourceWrites("sed -i 's/a/b/' ../other/src/App.tsx")).toEqual([])
    expect(findSourceWrites('echo x > src/../../src/App.tsx')).toEqual([])
  })
})

describe('findSourceWrites with a root', () => {
  test('resolves a write against the directory its segment runs in, so a cd into a package or out of the repo is followed', () => {
    expect(findSourceWrites("cd server && sed -i 's/a/b/' src/x.ts", 'C:/work')).toEqual(['C:/work/server/src/x.ts'])
    expect(findSourceWrites("cd ../other && echo x > src/x.ts", 'C:/work')).toEqual(['C:/other/src/x.ts'])
    expect(findSourceWrites('echo x > src/x.ts', 'C:/work')).toEqual(['C:/work/src/x.ts'])
    expect(findSourceWrites('echo x > C:/work/src/y.ts', 'C:/work')).toEqual(['C:/work/src/y.ts'])
  })

  // #69: scratch files built in a temp dir through a variable are not the project's sources.
  test('writes after a cd into a variable set in the command resolve there, outside the project', () => {
    const command = "R=/tmp/scratch/repro; mkdir -p $R && cd $R && git init -q\ncat > bot.js <<'EOF'\nmodule.exports = 1\nEOF\ncat > commands.js <<'EOF'\nmodule.exports = 2\nEOF"
    expect(findSourceWrites(command, 'C:/work')).toEqual(['/tmp/scratch/repro/bot.js', '/tmp/scratch/repro/commands.js'])
  })

  test('a written path through a variable is expanded; one that cannot be is somewhere this cannot see', () => {
    expect(findSourceWrites('D=src; echo x > $D/a.ts', 'C:/work')).toEqual(['C:/work/src/a.ts'])
    expect(findSourceWrites('R=/tmp/x; echo x > ${R}/a.ts', 'C:/work')).toEqual(['/tmp/x/a.ts'])
    expect(findSourceWrites('echo x > $OUT/a.ts', 'C:/work')).toEqual([`${ELSEWHERE}/a.ts`])
  })
})

describe('writesFileNamed: any write to one named file, whatever its extension (2026-10-18)', () => {
  const RECORD = 'dope-tdd.overrides.json'

  test('a redirect, tee, cp, mv, rm or truncate onto it', () => {
    for (const command of [
      `echo '{}' > ${RECORD}`,
      `echo '{}' >> ./${RECORD}`,
      `cat x | tee ${RECORD}`,
      `cp /tmp/forged.json ${RECORD}`,
      `mv "/tmp/forged.json" "${RECORD}"`,
      `rm -f ${RECORD}`,
      `truncate -s 0 ${RECORD}`,
    ]) {
      expect(writesFileNamed(command, RECORD)).toBe(true)
    }
  })

  // Verified review A8 (2026-10-20): Windows and macOS file names ignore case, so another spelling is the same file.
  test('another spelling of its name is the same file', () => {
    expect(writesFileNamed(`echo '{}' > DOPE-TDD.Overrides.JSON`, RECORD)).toBe(true)
    expect(writesFileNamed(`Set-Content -Path Dope-Tdd.Overrides.Json -Value '{}'`, RECORD)).toBe(true)
  })

  test('an in-place sed, a PowerShell write or a script write that names it', () => {
    expect(writesFileNamed(`sed -i 's/denied/approved/' ${RECORD}`, RECORD)).toBe(true)
    expect(writesFileNamed(`Set-Content -Path ${RECORD} -Value '{}'`, RECORD)).toBe(true)
    expect(writesFileNamed(`node -e "require('fs').writeFileSync('${RECORD}', '{}')"`, RECORD)).toBe(true)
  })

  test('reading it, or writing another file, is not a write to it', () => {
    expect(writesFileNamed(`cat ${RECORD}`, RECORD)).toBe(false)
    expect(writesFileNamed(`cp ${RECORD} /tmp/backup.json`, RECORD)).toBe(false)
    expect(writesFileNamed(`echo '{}' > other.json`, RECORD)).toBe(false)
    expect(writesFileNamed(`echo '{}' > my-${RECORD}.bak`, RECORD)).toBe(false)
  })
})

describe('the heredoc false positive (2026-10-18)', () => {
  test("a data heredoc's body is text: code and paths quoted in it are not written", () => {
    const command = "cd /c/r && cat > /tmp/r.mjs <<'EOF'\nconst a = `python - <<'PY'\\nopen(p,'w').write(x)`\nsee hooks/a.ts\nEOF\nnode /tmp/r.mjs"
    expect(findSourceWrites(command, 'C:/r')).toEqual(['/tmp/r.mjs'])
  })

  test('a script that writes through a variable assigned a string writes that string, not every path it mentions', () => {
    const command = "python - <<'PY'\np='src/x.ts'\ns=open(p).read()\nopen(p,'w').write(s + 'see hooks/a.ts')\nPY"
    expect(findSourceWrites(command)).toEqual(['src/x.ts'])
  })

  test('a const or let assignment counts the same way', () => {
    const command = "node <<'EOF'\nconst target = 'src/x.ts'\nrequire('fs').writeFileSync(target, 'see hooks/a.ts')\nEOF"
    expect(findSourceWrites(command)).toEqual(['src/x.ts'])
  })

  test('a variable that is not a plain string still counts every path the script mentions', () => {
    const command = "python - <<'PY'\nimport sys\np=sys.argv[1]\nopen(p,'w').write('see hooks/a.ts')\nPY"
    expect(findSourceWrites(command)).toContain('hooks/a.ts')
  })

  test('a variable assigned twice, once to something else, still counts every path', () => {
    const command = "python - <<'PY'\np='src/x.ts'\np=p.replace('x','y')\nopen(p,'w').write('see hooks/a.ts')\nPY"
    expect(findSourceWrites(command)).toContain('hooks/a.ts')
  })
})
