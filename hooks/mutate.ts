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

const COMPARISONS = new Set(['<', '<=', '>', '>='])

/**
 * `x <= 0` (or `<`, `>`, `>=`) right after `!x ||` or `x === 0 ||`: the guard already takes 0, so moving the bound
 * across 0 cannot change what the code does, and no test could catch it (#42). Such a mutant is not made.
 */
function guardedZero(tokens: readonly Token[], index: number): boolean {
  if (!COMPARISONS.has(tokens[index]?.text ?? '') || tokens[index + 1]?.text !== '0') return false
  let start = index
  while (start > 0 && (tokens[start - 1]?.kind === 'name' || tokens[start - 1]?.text === '.' || tokens[start - 1]?.text === '?.')) start--
  const operand = tokens.slice(start, index).map(token => token.text)
  if (operand.length === 0 || tokens[start - 1]?.text !== '||') return false
  const before = (count: number) => tokens.slice(start - 1 - count, start - 1).map(token => token.text)
  const same = (texts: readonly string[]) => texts.length === operand.length && texts.every((text, k) => text === operand[k])
  const negated = tokens[start - 2 - operand.length]?.text === '!' && same(before(operand.length))
  const equalsZero = before(2)[1] === '0' && ['===', '=='].includes(before(2)[0] ?? '') && same(before(operand.length + 2).slice(0, operand.length))
  return negated || equalsZero
}

type Candidate = { line: number; start: number; end: number; replacement: string; change: string }

function candidates(source: string, tokens: readonly Token[], angles: boolean): Candidate[] {
  const found: Candidate[] = []
  tokens.forEach((token, index) => {
    const end = token.start + token.text.length
    // A string, template or regex is one token whose text is never an operator, so it is never swapped.
    const swap = SWAPS[token.text] ?? (angles ? PLAIN_ONLY[token.text] : undefined)
    if (swap !== undefined && !guardedZero(tokens, index)) {
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
/**
 * True when a `<` or `>` in this file is safely a comparison: not TypeScript (generics), not a JSX file, and no tag in
 * the text (`</`, `/>`). A flipped bracket in a tag does not parse, and a test file that fails to load reads as red,
 * so it would count as caught (review #2).
 */
export function flipsAngles(path: string, text: string): boolean {
  return !/\.(?:[cm]?tsx?|jsx)$/.test(path) && !/<\/|\/>/.test(text)
}

/** `angles`: whether `<` and `>` may be flipped (see `flipsAngles`); `<=` and `>=` always may. */
export function mutantsOf(source: string, options: { angles: boolean; max?: number }): Mutant[] {
  const all = candidates(source, tokenize(source), options.angles)
  const max = Math.min(options.max ?? 4, all.length)
  const picked = Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)] as Candidate)
  return picked.map(candidate => ({
    line: candidate.line,
    change: `line ${candidate.line}: ${candidate.change}`,
    text: `${source.slice(0, candidate.start)}${candidate.replacement}${source.slice(candidate.end)}`,
  }))
}
