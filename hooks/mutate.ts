import { tokenize } from './tokens.ts'
import type { Token } from './tokens.ts'

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

const OPEN = new Set(['(', '[', '{', '<'])
const CLOSE = new Set([')', ']', '}', '>'])
// A line that ends on one of these, or a next line that starts with | or &, carries a type on.
const TYPE_GOES_ON = new Set(['|', '&', '=', '=>', ',', '?', ':', 'extends', 'keyof', 'typeof', '<'])

/**
 * The end (exclusive) of a type that starts at `start`: the first token at its depth that ends it. `{` ends a return
 * type (`): T {`) unless the type itself starts with it; a new line ends one that does not go on.
 */
function typeEnd(tokens: readonly Token[], start: number, ends: ReadonlySet<string>, braceEnds: boolean): number {
  let depth = 0
  for (let k = start; k < tokens.length; k++) {
    const text = tokens[k]?.text ?? ''
    if (depth === 0 && ends.has(text) && !(text === '{' && (!braceEnds || k === start))) return k
    if (OPEN.has(text)) depth++
    else if (CLOSE.has(text)) {
      if (depth === 0) return k
      depth--
    }
    const next = tokens[k + 1]
    if (depth === 0 && next !== undefined && next.line > (tokens[k]?.line ?? 0) && !TYPE_GOES_ON.has(text) && next.text !== '|' && next.text !== '&') return k + 1
  }
  return tokens.length
}

/**
 * The tokens of a TypeScript file that sit in a type: a `type` alias, an `interface`, and the type after a variable's,
 * a parameter's or a function's `:`. A literal there (`port: 8080`, `flag: true`, `0 | 1`) has no effect at run time,
 * so changing it proves nothing and would survive as a false gap (review #9). Values are never in it: object literals
 * (`{ a: 1 }`) and ternaries (`? 1 : 2`) are not annotations.
 */
function typeTokens(tokens: readonly Token[]): Set<number> {
  const inType = new Set<number>()
  const mark = (from: number, to: number) => {
    for (let k = from; k < to; k++) inType.add(k)
  }
  const brackets: string[] = []
  tokens.forEach((token, index) => {
    const text = token.text
    const previous = tokens[index - 1]?.text
    if (text === 'type' && tokens[index + 1]?.kind === 'name' && (tokens[index + 2]?.text === '=' || tokens[index + 2]?.text === '<')) {
      mark(index, typeEnd(tokens, index + 1, new Set([';']), false))
    } else if (text === 'interface' && tokens[index + 1]?.kind === 'name') {
      const open = tokens.findIndex((candidate, k) => k > index && candidate.text === '{')
      if (open !== -1) mark(index, typeEnd(tokens, open, new Set(), false))
    } else if (text === ':') {
      const named = previous === '?' ? index - 2 : index - 1
      const before = tokens[named - 1]?.text
      const innermost = brackets[brackets.length - 1]
      if (tokens[named]?.kind === 'name' && ['const', 'let', 'var'].includes(before ?? '')) {
        mark(index + 1, typeEnd(tokens, index + 1, new Set(['=', ';', ',']), false))
      } else if (tokens[named]?.kind === 'name' && (before === '(' || before === ',') && innermost === '(') {
        mark(index + 1, typeEnd(tokens, index + 1, new Set([',', '=']), false))
      } else if (previous === ')') {
        // A return type ends at the body's { or an arrow; a ternary's `(x) : y` ends neither way.
        const end = typeEnd(tokens, index + 1, new Set(['{', '=>', ';', ',']), true)
        if (tokens[end]?.text === '{' || tokens[end]?.text === '=>') mark(index + 1, end)
      }
    }
    if (OPEN.has(text) && text !== '<') brackets.push(text)
    else if (CLOSE.has(text) && text !== '>') brackets.pop()
  })
  return inType
}

function candidates(source: string, tokens: readonly Token[], angles: boolean, types: boolean): Candidate[] {
  const found: Candidate[] = []
  const skipped = types ? typeTokens(tokens) : new Set<number>()
  tokens.forEach((token, index) => {
    if (skipped.has(index)) return
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

/**
 * `angles`: whether `<` and `>` may be flipped (see `flipsAngles`); `<=` and `>=` always may. `types`: a TypeScript
 * file, whose type positions are left alone.
 */
export function mutantsOf(source: string, options: { angles: boolean; types?: boolean; max?: number }): Mutant[] {
  const all = candidates(source, tokenize(source), options.angles, options.types ?? false)
  const max = Math.min(options.max ?? 4, all.length)
  const picked = Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)] as Candidate)
  return picked.map(candidate => ({
    line: candidate.line,
    change: `line ${candidate.line}: ${candidate.change}`,
    text: `${source.slice(0, candidate.start)}${candidate.replacement}${source.slice(candidate.end)}`,
  }))
}
