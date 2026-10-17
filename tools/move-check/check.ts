// The move check: is the code a pull request moved between files the same code it was? For each top-level function,
// class or const that left one file and appeared in another between the base and HEAD, it compares the two as tokens:
//   IDENTICAL  the same code, spacing and comments aside
//   RENAMED    the same once names are changed consistently; every rename is listed for the reviewer to judge
//   DIFFERS    something else changed; the first difference is shown
// It reads committed code only (the base and the head, HEAD unless --head names another commit), never the working
// tree, and runs nothing from the repository.
//
//   node tools/move-check/check.ts --base origin/main [--head HEAD] [--repo .] [--rename 'old=new']... [--pair 'a.js:10-40=b.js:5-35']...
//                                  [--fail-on differs|uncovered|never]
//
// Node 22.18+ runs it as it is (type stripping); older Node: `npx -y tsx@4.19.2 tools/move-check/check.ts ...`.
//
// --rename replaces a token sequence on the old side before comparing (`players.get(=getPlayer(`), for a change
// that is not one name for another. A rule whose code holds `=` (`=>`, `===`) goes as --rename-from '<old>'
// --rename-to '<new>'. --pair compares line ranges, base side then HEAD side, for code that was never a
// declaration of its own (a loop body that became a function).

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compare, coverageOf, findMoves, removedLinesIn, report, tokensInLines } from './move.ts'
import type { Coverage, Move, Rename } from './move.ts'

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/

type Options = { repo: string; base: string; head: string; renames: Rename[]; pairs: string[]; failOn: 'differs' | 'uncovered' | 'never' }

/**
 * The rename rules in a command line, in order: `--rename 'old=new'`, and `--rename-from '<old>' --rename-to '<new>'`
 * for code that holds `=`. Shared by move-check and pr-check, so both read a rule the same way.
 */
export function renameRules(argv: readonly string[]): Rename[] {
  const rules: Rename[] = []
  let pendingFrom: string | undefined
  for (let k = 0; k < argv.length; k++) {
    const value = argv[k + 1] ?? ''
    if (argv[k] === '--rename') {
      const split = value.indexOf('=')
      if (split <= 0) throw new Error(`--rename needs old=new, got ${value}`)
      // #67: code holds `=` too (`=>`, `===`, a default value), and a rule split at the wrong one rewrites the old code
      // into something that never existed, with no error. More than one `=` is refused, never guessed at.
      if (value.indexOf('=', split + 1) !== -1) {
        throw new Error(
          `--rename '${value}' has more than one \`=\` (an arrow, a comparison or a default value), so where old ends and new begins cannot be told. ` +
            "Give it as --rename-from '<old>' --rename-to '<new>' instead.",
        )
      }
      rules.push({ from: value.slice(0, split), to: value.slice(split + 1) })
      k++
    } else if (argv[k] === '--rename-from') {
      if (pendingFrom !== undefined) throw new Error(`--rename-from '${pendingFrom}' has no --rename-to after it`)
      pendingFrom = value
      k++
    } else if (argv[k] === '--rename-to') {
      if (pendingFrom === undefined) throw new Error('--rename-to needs a --rename-from before it')
      rules.push({ from: pendingFrom, to: value })
      pendingFrom = undefined
      k++
    }
  }
  if (pendingFrom !== undefined) throw new Error(`--rename-from '${pendingFrom}' has no --rename-to after it`)
  return rules
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { repo: '.', base: '', head: 'HEAD', renames: renameRules(argv), pairs: [], failOn: 'never' }
  for (let k = 0; k < argv.length; k++) {
    const value = argv[k + 1] ?? ''
    switch (argv[k]) {
      case '--repo':
        options.repo = value
        break
      case '--base':
        options.base = value
        break
      case '--head':
        options.head = value
        break
      case '--rename':
      case '--rename-from':
      case '--rename-to':
        break
      case '--pair':
        options.pairs.push(value)
        break
      case '--fail-on':
        if (value !== 'differs' && value !== 'uncovered' && value !== 'never') throw new Error('--fail-on must be differs, uncovered or never')
        options.failOn = value
        break
      default:
        throw new Error(`unknown argument ${argv[k]}`)
    }
    k++
  }
  if (options.base === '') throw new Error('--base is required')
  return options
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** A file's text at a commit, or null when it did not exist there (git's "does not exist" kept off stderr). */
function textAt(repo: string, ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** True when the path is in that commit. */
export function existsAt(repo: string, ref: string, path: string): boolean {
  return textAt(repo, ref, path) !== null
}

/**
 * Every code file the commits between `base` and `head` touch, as each was at the base and as it is at the head.
 * Renames are listed as a deletion and an addition (`--no-renames`): a file moved with `git mv` and edited, the usual
 * shape of a move into a new file, would otherwise show only its new path, and its old text would never be read (#6).
 */
export function changedCode(repo: string, base: string, head: string): { base: Record<string, string>; head: Record<string, string> } {
  const paths = git(repo, ['diff', '--name-only', '--no-renames', base, head])
    .split(/\r?\n/)
    .filter(path => CODE.test(path))
  const side = (ref: string) => Object.fromEntries(paths.flatMap(path => ((text => (text === null ? [] : [[path, text] as const]))(textAt(repo, ref, path)))))
  return { base: side(base), head: side(head) }
}

/** `index.js:358-530=nodePool.js:40-120`: base side, then HEAD side. */
function pairMove(repo: string, base: string, head: string, pair: string, renames: readonly Rename[]): Move {
  const sides = /^(.+):(\d+)-(\d+)=(.+):(\d+)-(\d+)$/.exec(pair)
  if (sides === null) throw new Error(`--pair needs from.js:start-end=to.js:start-end, got ${pair}`)
  const [, from = '', fromStart = '0', fromEnd = '0', to = '', toStart = '0', toEnd = '0'] = sides
  const before = textAt(repo, base, from)
  const after = textAt(repo, head, to)
  if (before === null || after === null) throw new Error(`--pair ${pair}: ${before === null ? `${from} is not in ${base}` : `${to} is not in ${head}`}`)
  return {
    name: `${from}:${fromStart}-${fromEnd}`,
    from,
    to,
    fromLines: [Number(fromStart), Number(fromEnd)],
    toLines: [Number(toStart), Number(toEnd)],
    result: compare(tokensInLines(before, Number(fromStart), Number(fromEnd)), tokensInLines(after, Number(toStart), Number(toEnd)), renames),
  }
}

/**
 * The moves between `base` and `head`, found and paired, with how much of the removed code they account for (#64), and
 * the report. What main prints; exported so the check can be run on a throwaway repository in a test.
 */
export function moveCheck(repo: string, options: Options): { moves: Move[]; coverage: Coverage; text: string } {
  const code = changedCode(repo, options.base, options.head)
  const moves = [...findMoves(code.base, code.head, options.renames), ...options.pairs.map(pair => pairMove(repo, options.base, options.head, pair, options.renames))]
  const paths = Object.keys(code.base)
  const diff = paths.length === 0 ? '' : git(repo, ['diff', '-U0', '--no-renames', '--no-color', options.base, options.head, '--', ...paths])
  const coverage = coverageOf(removedLinesIn(diff), code.base, moves)
  const sha = git(repo, ['rev-parse', '--short', options.base]).trim()
  return { moves, coverage, text: report(moves, `${options.base} (${sha})`, coverage) }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const { moves, coverage, text } = moveCheck(resolve(options.repo), options)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}
`)
  if (options.failOn === 'differs' && moves.some(move => move.result.verdict === 'DIFFERS')) process.exitCode = 1
  // Off unless asked: lines a refactor really deleted cannot be told from lines that moved where this check cannot see.
  if (options.failOn === 'uncovered' && coverage.uncovered.length > 0) process.exitCode = 1
}

// Run directly, not imported by pr-check or a spec. Matched by path, not `__filename` (CommonJS only) or `import.meta`
// (ES modules only), so it holds under plain `node` (type stripping, ES module) and under tsx alike (#68).
if (process.argv[1] !== undefined && /[\\/]tools[\\/]move-check[\\/]check\.ts$/.test(resolve(process.argv[1]))) {
  try {
    main()
  } catch (error) {
    console.error(`move-check: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
