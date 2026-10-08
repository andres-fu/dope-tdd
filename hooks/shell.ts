const HEREDOC = /<<-?\s*['"]?\w+|@['"]\r?\n/

/**
 * Splits a command on `&&`, `||`, `;` and `|` outside quotes. A command with a
 * heredoc or a PowerShell here-string stays whole, because its body is data.
 */
export function commandSegments(command: string): string[] {
  if (HEREDOC.test(command)) {
    return [command]
  }
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
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
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      segments.push(current)
      current = ''
      i++
      continue
    }
    if (char === ';' || char === '|') {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.map(segment => segment.trim()).filter(segment => segment !== '')
}
