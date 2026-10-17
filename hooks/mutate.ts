import { tokenize } from './tokens'
import type { Token } from './tokens'

/**
 * Small changes to new code that a test of it should notice (#27): the catch check of a new file has no old code to
 * put back, so it tries these instead. Each changes one token, or wraps one `if` condition, and keeps the code
 * parseable; strings, templates, regexes and comments are never touched, being single tokens or skipped.
 */
export type Mutant = { line: number; change: string; text: string }

const SWAPS: Readonly<Record<string, string>> = {
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
  '<=': '<',
  '>=': '>',
  '&&': '||',
  '||': '&&',
  true: 'false',
  false: 'true',
}
// `Array<number>` and `<T>(x: T)` read as comparisons to a tokenizer: in TypeScript, < and > are left alone.
const PLAIN_ONLY: Readonly<Record<string, string>> = { '<': '<=', '>': '>=' }

type Candidate = { line: number; start: number; end: number; replacement: string; change: string }

function candidates(source: string, tokens: readonly Token[], typescript: boolean): Candidate[] {
  const found: Candidate[] = []
  tokens.forEach((token, index) => {
    const end = token.start + token.text.length
    // A string, template or regex is one token whose text is never an operator, so it is never swapped.
    const swap = SWAPS[token.text] ?? (typescript ? undefined : PLAIN_ONLY[token.text])
    if (swap !== undefined) {
      found.push({ line: token.line, start: token.start, end, replacement: swap, change: `\`${token.text}\` → \`${swap}\`` })
    } else if (token.kind === 'number' && /^\d+$/.test(token.text)) {
      const nudged = String(Number(token.text) + 1)
      found.push({ line: token.line, start: token.start, end, replacement: nudged, change: `\`${token.text}\` → \`${nudged}\`` })
    } else if (token.text === 'if' && tokens[index + 1]?.text === '(') {
      const close = closingParen(tokens, index + 1)
      const open = tokens[index + 1] as Token
      if (close !== null) {
        const condition = source.slice(open.start + 1, close.start)
        found.push({
          line: token.line,
          start: open.start,
          end: close.start + 1,
          replacement: `(!(${condition}))`,
          change: `\`if (${condition})\` → \`if (!(${condition}))\``,
        })
      }
    }
  })
  return found
}

function closingParen(tokens: readonly Token[], open: number): Token | null {
  let depth = 0
  for (let k = open; k < tokens.length; k++) {
    const text = tokens[k]?.text
    if (text === '(') depth++
    else if (text === ')' && --depth === 0) return tokens[k] as Token
  }
  return null
}

/** Up to `max` mutants, spread evenly over the file in source order, the same ones every time. */
export function mutantsOf(source: string, options: { typescript: boolean; max?: number }): Mutant[] {
  const all = candidates(source, tokenize(source), options.typescript)
  const max = Math.min(options.max ?? 4, all.length)
  const picked = Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)] as Candidate)
  return picked.map(candidate => ({
    line: candidate.line,
    change: `line ${candidate.line}: ${candidate.change}`,
    text: `${source.slice(0, candidate.start)}${candidate.replacement}${source.slice(candidate.end)}`,
  }))
}
