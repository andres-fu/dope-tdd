import { describe, expect, test } from 'claude-code/testing'

import { ELSEWHERE, commandSegments, locatedSegments, writableText } from '../hooks/shell'

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

  test('a heredoc body stays with the command that opened it, and what follows the terminator is split as usual', () => {
    const command = "cat > notes.md <<'EOT'\nx; y | z\nEOT\nsed -i 's/a/b/' index.md && echo done"
    expect(commandSegments(command)).toEqual(["cat > notes.md <<'EOT'\nx; y | z\nEOT", "sed -i 's/a/b/' index.md", 'echo done'])
  })

  test('a wrapper that only runs the command after it is dropped, so the segment is what runs (2026-10-19)', () => {
    expect(commandSegments('timeout 60 cp a.ts src/b.ts && time -p nice -n 5 env -i CI=1 npm test')).toEqual(['cp a.ts src/b.ts', 'CI=1 npm test'])
    expect(commandSegments('timeout --preserve-status -k 5 10s make')).toEqual(['make'])
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
