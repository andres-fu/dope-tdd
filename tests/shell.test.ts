import { describe, expect, test } from 'claude-code/testing'

import { ELSEWHERE, commandSegments, locatedSegments } from '../hooks/shell'

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
})
