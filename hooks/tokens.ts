// JavaScript and TypeScript as tokens, enough to compare code and to change it safely: whitespace and comments are
// skipped, and strings, templates (with their `${…}` expressions) and regexes are one token each. Used by the
// mutants a new file's catch check tries (mutate.ts) and by tools/move-check.

export type TokenKind = 'name' | 'number' | 'string' | 'template' | 'regex' | 'punct'
export type Token = { text: string; kind: TokenKind; line: number; start: number }

// After one of these, a slash starts a regex; after a name, a number, `)` or `]` it divides.
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])
const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
]

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  let i = 0
  const lineAt = (start: number, end: number) => {
    for (let k = start; k < end; k++) if (source[k] === '\n') line++
  }
  const push = (kind: TokenKind, start: number, end: number) => {
    tokens.push({ text: source.slice(start, end), kind, line, start })
    lineAt(start, end)
    i = end
  }
  while (i < source.length) {
    const char = source[i] ?? ''
    const next = source[i + 1] ?? ''
    if (char === '\n') {
      line++
      i++
    } else if (/\s/.test(char)) {
      i++
    } else if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      lineAt(i, stop)
      i = stop
    } else if (char === "'" || char === '"') {
      push('string', i, endOfString(source, i))
    } else if (char === '`') {
      push('template', i, endOfTemplate(source, i))
    } else if (char === '/' && regexMayStart(tokens.at(-1))) {
      push('regex', i, endOfRegex(source, i))
    } else if (/[A-Za-z_$#]/.test(char)) {
      push('name', i, i + (/^[#\w$]+/.exec(source.slice(i))?.[0].length ?? 1))
    } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next))) {
      push('number', i, i + (/^[\w.]+/.exec(source.slice(i))?.[0].length ?? 1))
    } else {
      const punct = PUNCTUATORS.find(candidate => source.startsWith(candidate, i)) ?? char
      push('punct', i, i + punct.length)
    }
  }
  return tokens
}

function regexMayStart(previous: Token | undefined): boolean {
  if (previous === undefined) return true
  if (previous.kind === 'name') return BEFORE_REGEX.has(previous.text)
  if (previous.kind === 'punct') return ![')', ']', '}'].includes(previous.text)
  return false
}

function endOfString(source: string, start: number): number {
  const quote = source[start]
  for (let k = start + 1; k < source.length; k++) {
    if (source[k] === '\\') k++
    else if (source[k] === quote || source[k] === '\n') return k + 1
  }
  return source.length
}

function endOfRegex(source: string, start: number): number {
  let inClass = false
  for (let k = start + 1; k < source.length; k++) {
    const char = source[k]
    if (char === '\\') k++
    else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '\n') return k
    else if (char === '/' && !inClass) return k + 1 + (/^[a-z]*/.exec(source.slice(k + 1))?.[0].length ?? 0)
  }
  return source.length
}

/** A template literal from its backtick, through `${ … }` expressions that may hold strings and templates of their own. */
function endOfTemplate(source: string, start: number): number {
  for (let k = start + 1; k < source.length; k++) {
    const char = source[k]
    if (char === '\\') k++
    else if (char === '`') return k + 1
    else if (char === '$' && source[k + 1] === '{') k = endOfExpression(source, k + 2) - 1
  }
  return source.length
}

function endOfExpression(source: string, start: number): number {
  let depth = 1
  for (let k = start; k < source.length; k++) {
    const char = source[k]
    if (char === "'" || char === '"') k = endOfString(source, k) - 1
    else if (char === '`') k = endOfTemplate(source, k) - 1
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return k + 1
  }
  return source.length
}
