// The move check's reading and comparing, kept free of git and the file system so it can be tested on strings.
// Code is compared as JavaScript or TypeScript tokens: whitespace and comments never count, strings, templates and
// regexes are one token each, and a name may differ only by a rename that holds everywhere in the declaration.

import { tokenize } from '../../hooks/tokens.ts'
import type { Token } from '../../hooks/tokens.ts'

export { tokenize }
export type { Token }

export type Rename = { from: string; to: string; explicit?: true }
export type Comparison =
  | { verdict: 'IDENTICAL'; renames: [] }
  | { verdict: 'RENAMED'; renames: Rename[] }
  | { verdict: 'SIGNATURE'; parameters: { before: string; after: string }; renames: Rename[] }
  | { verdict: 'DIFFERS'; difference: string }

/** `params` and `body` index into `tokens`, for a function: its parameter list `( … )` and its body's `{`. */
export type Declaration = { name: string; tokens: Token[]; startLine: number; endLine: number; params?: [number, number]; body?: number }
export type Move = { name: string; from: string; to: string; fromLines: [number, number]; toLines: [number, number]; result: Comparison }

const KEYWORDS = new Set(
  (
    'abstract any as async await boolean break case catch class const continue debugger declare default delete do else ' +
    'enum export extends false finally for from function get if implements import in instanceof interface keyof let new ' +
    'null number of package private protected public readonly return set static string super switch this throw true try ' +
    'type typeof undefined var void while with yield'
  ).split(' '),
)
/** The tokens on these lines, ends included: code compared by where it sits rather than by a name. */
export function tokensInLines(source: string, startLine: number, endLine: number): Token[] {
  return tokenize(source).filter(token => token.line >= startLine && token.line <= endLine)
}

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])

/** The index of the token that closes the bracket at `open`. */
function closing(tokens: Token[], open: number): number {
  let depth = 0
  for (let k = open; k < tokens.length; k++) {
    const text = tokens[k]?.text ?? ''
    if (OPENERS.has(text)) depth++
    else if (CLOSERS.has(text) && --depth === 0) return k
  }
  return tokens.length - 1
}

/** Where a `const`, `let` or `var` statement ends: its `;`, or the last token before a new line starts the next one. */
function statementEnd(tokens: Token[], start: number): number {
  for (let k = start; k < tokens.length; k++) {
    if (OPENERS.has(tokens[k]?.text ?? '')) {
      k = closing(tokens, k)
    }
    const token = tokens[k] as Token
    if (token.text === ';') return k
    const next = tokens[k + 1]
    // A line that ends on an operator, or a next line that starts with one (`.then`, `+ 1`), carries on.
    const endsOnOperator = token.kind === 'punct' && !CLOSERS.has(token.text)
    const startsWithOperator = next !== undefined && next.kind === 'punct' && !OPENERS.has(next.text) && !CLOSERS.has(next.text)
    if (next === undefined || (next.line > token.line && !endsOnOperator && !startsWithOperator)) return k
  }
  return tokens.length - 1
}

/** A declaration that starts at token `k`, or null: `[export] [async] function name`, `class name`, `const|let|var name`. */
function declarationAt(tokens: Token[], k: number): Declaration | null {
  let at = k
  while (['export', 'default', 'declare'].includes(tokens[at]?.text ?? '')) at++
  if (tokens[at]?.text === 'async' && tokens[at + 1]?.text === 'function') at++
  const head = tokens[at]?.text
  let name: string | undefined
  let end = -1
  let params: [number, number] | undefined
  let body: number | undefined
  if (head === 'function' || head === 'class') {
    let named = at + 1
    if (tokens[named]?.text === '*') named++
    name = tokens[named]?.kind === 'name' ? tokens[named]?.text : undefined
    const brace = tokens.findIndex((token, index) => index > named && token.text === '{' && (head === 'class' || precededByParams(tokens, index)))
    end = brace === -1 ? named : closing(tokens, brace)
    if (head === 'function' && brace !== -1 && tokens[named + 1]?.text === '(') {
      params = [named + 1 - k, closing(tokens, named + 1) - k]
      body = brace - k
    }
  } else if (head === 'const' || head === 'let' || head === 'var') {
    name = tokens[at + 1]?.kind === 'name' ? tokens[at + 1]?.text : undefined
    end = statementEnd(tokens, at + 1)
  }
  if (name === undefined || end < k) {
    return null
  }
  const slice = tokens.slice(k, end + 1)
  return { name, tokens: slice, startLine: slice[0]?.line ?? 0, endLine: slice.at(-1)?.line ?? 0, ...(params === undefined ? {} : { params, body }) }
}

/**
 * The top-level functions, classes and `const`/`let`/`var` bindings of a file, each with its tokens and lines; with
 * `nested`, also those inside them, such as the functions a factory (`createX({ deps }) { function f() {} }`) returns.
 */
export function declarations(source: string, nested = false): Declaration[] {
  const tokens = tokenize(source)
  const found: Declaration[] = []
  let k = 0
  while (k < tokens.length) {
    const declaration = declarationAt(tokens, k)
    if (declaration !== null) {
      found.push(declaration)
      if (!nested) {
        k += declaration.tokens.length
        continue
      }
    } else if (!nested && OPENERS.has(tokens[k]?.text ?? '')) {
      k = closing(tokens, k) + 1
      continue
    }
    k++
  }
  return found
}

/** A function body's `{` comes after its parameters' `)`, or after a return type (`): Promise<void> {`). */
function precededByParams(tokens: Token[], brace: number): boolean {
  let depth = 0
  for (let k = brace - 1; k >= 0; k--) {
    const text = tokens[k]?.text ?? ''
    if (text === ')' && depth === 0) return true
    if (text === '>') depth++
    if (text === '<') depth--
    if (text === '{' || text === ';') return false
  }
  return false
}

/**
 * Template literals opened up for comparing (#66): the shared tokenizer keeps a template whole (the small-change check
 * relies on that), so a name in `${…}` was invisible to renames. Here each `${…}` expression becomes ordinary tokens,
 * and the literal text between them stays as fixed tokens that must match exactly.
 */
function openTemplates(tokens: readonly Token[]): Token[] {
  return tokens.flatMap(token => (token.kind === 'template' && token.text.includes('${') ? templateParts(token) : [token]))
}

function templateParts(token: Token): Token[] {
  const text = token.text
  const parts: Token[] = []
  let chunk = ''
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '\\') {
      chunk += text.slice(k, k + 2)
      k++
      continue
    }
    if (text[k] === '$' && text[k + 1] === '{') {
      const end = expressionEnd(text, k + 2)
      parts.push({ ...token, kind: 'string', text: `${chunk}\${` })
      parts.push(...openTemplates(tokenize(text.slice(k + 2, end)).map(inner => ({ ...inner, line: token.line }))))
      chunk = '}'
      k = end
      continue
    }
    chunk += text[k]
  }
  parts.push({ ...token, kind: 'string', text: chunk })
  return parts
}

/** Where the `${` expression starting at `from` closes: its matching `}`, past nested braces, strings and templates. */
function expressionEnd(text: string, from: number): number {
  let depth = 0
  for (let k = from; k < text.length; k++) {
    const ch = text[k]
    if (ch === '\\') {
      k++
    } else if (ch === "'" || ch === '"' || ch === '`') {
      k = quoteEnd(text, k)
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      if (depth === 0) return k
      depth--
    }
  }
  return text.length - 1
}

/** Where the quote opened at `from` closes; a template's own `${…}` are stepped over whole. */
function quoteEnd(text: string, from: number): number {
  const quote = text[from]
  for (let k = from + 1; k < text.length; k++) {
    if (text[k] === '\\') {
      k++
    } else if (quote === '`' && text[k] === '$' && text[k + 1] === '{') {
      k = expressionEnd(text, k + 2)
    } else if (text[k] === quote) {
      return k
    }
  }
  return text.length - 1
}

/** Whether `tokens` hold the run of texts `run` anywhere. */
function holds(tokens: readonly Token[], run: readonly string[]): boolean {
  return run.length > 0 && tokens.some((_, k) => run.every((text, offset) => tokens[k + offset]?.text === text))
}

function applyExplicit(tokens: Token[], renames: readonly Rename[], after: readonly Token[]): { tokens: Token[]; used: Rename[] } {
  let out = tokens
  const used: Rename[] = []
  for (const rename of renames) {
    const from = tokenize(rename.from).map(token => token.text)
    // #65: a rule is given for the pieces where the old code was replaced. A piece whose new side still has that code
    // did not change it, so the rule is not applied there: applied, it would make unchanged code read DIFFERS.
    if (holds(after, from)) {
      continue
    }
    const to = tokenize(rename.to)
    const next: Token[] = []
    let hit = false
    for (let k = 0; k < out.length; ) {
      if (from.length > 0 && from.every((text, offset) => out[k + offset]?.text === text)) {
        next.push(...to.map(token => ({ ...token, line: out[k]?.line ?? token.line })))
        k += from.length
        hit = true
      } else {
        next.push(out[k] as Token)
        k++
      }
    }
    out = next
    if (hit) used.push({ from: rename.from, to: rename.to, explicit: true })
  }
  return { tokens: out, used }
}

function context(tokens: Token[], at: number): string {
  return tokens
    .slice(Math.max(0, at - 1), at + 3)
    .map(token => token.text)
    .join(' ')
}

/** IDENTICAL, RENAMED with every rename it took, or DIFFERS from the first token that does. */
export function compare(rawBefore: Token[], rawAfter: Token[], explicit: readonly Rename[] = []): Comparison {
  const after = openTemplates(rawAfter)
  const { tokens: old, used } = applyExplicit(openTemplates(rawBefore), explicit, after)
  const forward = new Map<string, string>()
  const backward = new Map<string, string>()
  const inferred: Rename[] = []
  const length = Math.max(old.length, after.length)
  for (let k = 0; k < length; k++) {
    const a = old[k]
    const b = after[k]
    const sameText = a !== undefined && b !== undefined && a.text === b.text
    const renameable = a?.kind === 'name' && b?.kind === 'name' && !KEYWORDS.has(a.text) && !KEYWORDS.has(b.text)
    if (renameable) {
      const was = forward.get(a.text)
      const back = backward.get(b.text)
      if ((was === undefined || was === b.text) && (back === undefined || back === a.text)) {
        if (was === undefined) {
          forward.set(a.text, b.text)
          backward.set(b.text, a.text)
          if (a.text !== b.text) inferred.push({ from: a.text, to: b.text })
        }
        continue
      }
    } else if (sameText) {
      continue
    }
    return { verdict: 'DIFFERS', difference: `before: \`${context(old, k)}\` · after: \`${context(after, k)}\`` }
  }
  const renames = [...used, ...inferred]
  return renames.length === 0 ? { verdict: 'IDENTICAL', renames: [] } : { verdict: 'RENAMED', renames }
}

const PREFIX_ONLY = new Set(['export', 'default', 'declare'])

/**
 * The whole declaration; for a function that differs, its parameters and its body apart: a body that is the same with
 * new parameters is how a dependency arrives once code is injected rather than reached for (SIGNATURE).
 */
function compareDeclarations(before: Declaration, after: Declaration, explicit: readonly Rename[]): Comparison {
  // A move into a new module needs `export` there, and one back may drop it (#60): that keyword is how code moves, not a
  // change to the code, so the leading export, default and declare are left out of the comparison on both sides.
  const core = (decl: Declaration) => decl.tokens.slice(decl.tokens.findIndex(token => !PREFIX_ONLY.has(token.text)))
  const whole = compare(core(before), core(after), explicit)
  if (whole.verdict !== 'DIFFERS' || before.params === undefined || after.params === undefined || before.body === undefined || after.body === undefined) {
    return whole
  }
  const lead = (decl: Declaration) =>
    decl.tokens
      .slice(0, decl.params?.[0])
      .map(token => token.text)
      .filter(text => !PREFIX_ONLY.has(text))
      .join(' ')
  const body = compare(before.tokens.slice(before.body), after.tokens.slice(after.body), explicit)
  if (lead(before) !== lead(after) || body.verdict === 'DIFFERS' || body.verdict === 'SIGNATURE') {
    return whole
  }
  const text = (decl: Declaration) =>
    decl.tokens
      .slice(decl.params?.[0], (decl.params?.[1] ?? 0) + 1)
      .map(token => token.text)
      .join(' ')
  return { verdict: 'SIGNATURE', parameters: { before: text(before), after: text(after) }, renames: body.renames }
}

/**
 * Each top-level declaration that left a file between `base` and `head` and appeared in another file that did not have
 * it before, compared there. Files map a path to its text; a file missing from one side did not exist there.
 */
export function findMoves(base: Readonly<Record<string, string>>, head: Readonly<Record<string, string>>, explicit: readonly Rename[] = []): Move[] {
  const declared = (files: Readonly<Record<string, string>>, nested: boolean) =>
    new Map(Object.entries(files).map(([path, text]) => [path, declarations(text, nested)] as const))
  // What moved is a top-level declaration of the old file; where it lands may be nested, inside a factory.
  const before = declared(base, false)
  const beforeAnywhere = declared(base, true)
  const after = declared(head, true)
  const has = (map: Map<string, Declaration[]>, path: string, name: string) => map.get(path)?.some(decl => decl.name === name) ?? false
  const moves: Move[] = []
  for (const [from, decls] of before) {
    for (const decl of decls) {
      if (has(after, from, decl.name)) continue
      const target = [...after].find(([to]) => to !== from && has(after, to, decl.name) && !has(beforeAnywhere, to, decl.name))
      const landed = target?.[1].find(candidate => candidate.name === decl.name)
      if (target === undefined || landed === undefined) continue
      moves.push({
        name: decl.name,
        from,
        to: target[0],
        fromLines: [decl.startLine, decl.endLine],
        toLines: [landed.startLine, landed.endLine],
        result: compareDeclarations(decl, landed, explicit),
      })
    }
  }
  return moves
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** The table to paste into a pull request, with a count of each verdict. */
export function report(moves: readonly Move[], against: string): string {
  if (moves.length === 0) {
    return `## Move check\n\nNo declaration moved between files against ${against}.`
  }
  const count = (verdict: Comparison['verdict']) => moves.filter(move => move.result.verdict === verdict).length
  const renamed = (renames: readonly Rename[]) =>
    renames.map(rename => `\`${rename.from}\` → \`${rename.to}\`${rename.explicit === true ? ' (given)' : ''}`).join(', ')
  const notes = (result: Comparison) => {
    if (result.verdict === 'DIFFERS') return result.difference
    if (result.verdict !== 'SIGNATURE') return renamed(result.renames)
    const body = result.renames.length === 0 ? '' : `; body: ${renamed(result.renames)}`
    return `parameters \`${result.parameters.before}\` → \`${result.parameters.after}\`${body}`
  }
  const rows = moves.map(move => {
    const note = cell(notes(move.result))
    return `| \`${move.name}\` | ${move.from}:${move.fromLines[0]} → ${move.to}:${move.toLines[0]} | **${move.result.verdict}** |${note === '' ? '' : ` ${note}`} |`
  })
  return [
    '## Move check',
    '',
    `${count('IDENTICAL')} identical · ${count('RENAMED')} renamed · ${count('SIGNATURE')} signature changed · ${count('DIFFERS')} differs, against ${against}.`,
    '',
    '| Moved | Where | Verdict | Notes |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}
