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
