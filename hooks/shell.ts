const HERESTRING = /@['"]\r?\n/
// A heredoc opener: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"`. Sticky, so it is tried at the `<<` just read.
const HEREDOC_OPEN = /<<-?\s*(['"]?)(\w+)\1/y

/**
 * Splits a command on `&&`, `||`, `;` and `|` outside quotes. A heredoc's body
 * stays with the command that opened it, verbatim, and what follows its
 * terminator is split as usual; a PowerShell here-string keeps the whole
 * command, because its body is data.
 */
export function commandSegments(command: string): string[] {
  if (HERESTRING.test(command)) {
    return [command]
  }
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const pendingHeredocs: string[] = []
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? ''
    if (quote !== null) {
      current += char
      if (char === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i]
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\\' && i + 1 < command.length) {
      current += char + command[++i]
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '<' && command[i + 1] === '<') {
      HEREDOC_OPEN.lastIndex = i
      const opened = HEREDOC_OPEN.exec(command)
      if (opened !== null) {
        pendingHeredocs.push(opened[2] ?? '')
        current += opened[0]
        i += opened[0].length - 1
        continue
      }
    }
    if (char === '\n' && pendingHeredocs.length > 0) {
      // Each body runs to its terminator line; it belongs to the command that opened it and is never split.
      let rest = command.slice(i + 1)
      let body = ''
      for (const word of pendingHeredocs) {
        const lines = rest.split('\n')
        let taken = 0
        for (const line of lines) {
          taken++
          if (line.replace(/^\t+/, '').trimEnd() === word) {
            break
          }
        }
        const piece = lines.slice(0, taken).join('\n')
        body += (body === '' ? '' : '\n') + piece
        rest = lines.slice(taken).join('\n')
      }
      pendingHeredocs.length = 0
      current += '\n' + body
      i += body.length
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      segments.push(current)
      current = ''
      i++
      continue
    }
    if (char === ';' || char === '|' || char === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.map(segment => segment.trim()).filter(segment => segment !== '')
}

export type LocatedSegment = { segment: string; cwd: string }

/** The directory a command's segments run in: a `cd` moves every segment after it. Outside the root is still a place, named as it is. */
export const ELSEWHERE = '~'

function joinPath(base: string, target: string): string {
  const slashed = target.replace(/\\/g, '/')
  if (/^(?:[A-Za-z]:)?\//.test(slashed)) {
    return normalizePath(slashed)
  }
  return normalizePath(`${base.replace(/\\/g, '/')}/${slashed}`)
}

function normalizePath(path: string): string {
  const drive = /^([A-Za-z]:)(\/.*)?$/.exec(path)
  const prefix = drive === null ? (path.startsWith('/') ? '/' : '') : `${drive[1]}/`
  const rest = drive === null ? path.replace(/^\//, '') : (drive[2] ?? '').replace(/^\//, '')
  const out: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return `${prefix}${out.join('/')}`
}

/**
 * Each segment with the directory it runs in. `root` is where the command
 * starts; a `cd` segment moves the segments after it (`cd` alone, `cd ~` and
 * `cd -` go somewhere this cannot see, so they go ELSEWHERE). A pipe does not
 * change directory; a subshell is not tracked.
 */
export function locatedSegments(command: string, root: string): LocatedSegment[] {
  let cwd = root.replace(/\\/g, '/').replace(/\/$/, '')
  const located: LocatedSegment[] = []
  for (const segment of commandSegments(command)) {
    located.push({ segment, cwd })
    const cd = /^cd(?:\s+(.*))?$/.exec(segment.trim())
    if (cd === null) {
      continue
    }
    const target = (cd[1] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
    if (target === '' || target === '-' || target === '~' || target.startsWith('~/')) {
      cwd = ELSEWHERE
    } else if (cwd === ELSEWHERE) {
      cwd = /^(?:[A-Za-z]:)?[\\/]/.test(target) ? joinPath('', target) : ELSEWHERE
    } else {
      cwd = joinPath(cwd, target)
    }
  }
  return located
}
