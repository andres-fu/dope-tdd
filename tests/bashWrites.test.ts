import { describe, expect, test } from 'claude-code/testing'

import { findSourceWrites } from '../hooks/bashWrites'

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
    const viaVariable = "python - <<'PY'\ntarget = 'src/a.py'\nopen(target, 'w').write(open('src/b.py').read())\nPY"
    const unknownStream = "node -e \"stream.write(require('fs').readFileSync('src/a.ts'))\""
    expect(findSourceWrites(viaVariable)).toEqual(['src/a.py', 'src/b.py'])
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
})
