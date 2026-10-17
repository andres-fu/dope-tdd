// The move check: is the code a pull request moved between files the same code it was? For each top-level function,
// class or const that left one file and appeared in another between the base and HEAD, it compares the two as tokens:
//   IDENTICAL  the same code, spacing and comments aside
//   RENAMED    the same once names are changed consistently; every rename is listed for the reviewer to judge
//   DIFFERS    something else changed; the first difference is shown
// It reads committed code only (the base and the head, HEAD unless --head names another commit), never the working
// tree, and runs nothing from the repository.
//
//   npx tsx tools/move-check/check.ts --base origin/main [--head HEAD] [--repo .] [--rename 'old=new']... [--pair 'a.js:10-40=b.js:5-35']...
//                                     [--fail-on differs|never]
//
// --rename replaces a token sequence on the old side before comparing (`shoukaku.players.get(=getPlayer(`), for a change
// that is not one name for another. --pair compares line ranges, base side then HEAD side, for code that was never a
// declaration of its own (a loop body that became a function).

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compare, findMoves, report, tokensInLines } from './move'
import type { Move, Rename } from './move'

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/

type Options = { repo: string; base: string; head: string; renames: Rename[]; pairs: string[]; failOn: 'differs' | 'never' }

function parseArgs(argv: string[]): Options {
  const options: Options = { repo: '.', base: '', head: 'HEAD', renames: [], pairs: [], failOn: 'never' }
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
      case '--rename': {
        const split = value.indexOf('=')
        if (split <= 0) throw new Error(`--rename needs old=new, got ${value}`)
        options.renames.push({ from: value.slice(0, split), to: value.slice(split + 1) })
        break
      }
      case '--pair':
        options.pairs.push(value)
        break
      case '--fail-on':
        if (value !== 'differs' && value !== 'never') throw new Error('--fail-on must be differs or never')
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

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const repo = resolve(options.repo)
  const code = changedCode(repo, options.base, options.head)
  const moves = [...findMoves(code.base, code.head, options.renames), ...options.pairs.map(pair => pairMove(repo, options.base, options.head, pair, options.renames))]
  const sha = git(repo, ['rev-parse', '--short', options.base]).trim()
  const text = report(moves, `${options.base} (${sha})`)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  if (options.failOn === 'differs' && moves.some(move => move.result.verdict === 'DIFFERS')) process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(__filename)) {
  try {
    main()
  } catch (error) {
    console.error(`move-check: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
