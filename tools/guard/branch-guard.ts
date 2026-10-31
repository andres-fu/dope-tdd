// The branch guard: a PreToolUse hook (.claude/settings.json) that stops Claude committing, merging or pushing on
// main in this repository. Process review, 2026-10-21: #157's work was started on main, and "work on a branch" was a
// rule nothing enforced. This hook is the local half; GitHub branch protection on main is the half that cannot be
// talked past (a command spelled in a way this reading misses still meets it on push). It also keeps `gh pr merge` for
// a person (2026-10-30): an agent's approval never counts, so an agent stops at a green, reviewed pull request.
//
// Claude Code passes the tool call as JSON on stdin; exit 2 blocks it and shows stderr to Claude. Anything this cannot
// read (bad input) lets the command through, as do the git rules outside a checkout: the guard must never wedge a session.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { commandSegments, executedText } from '../../hooks/shell.ts'

// Subcommands that make or publish commits. Pull, fetch, checkout and every read stay allowed on main.
const WRITES = new Set(['commit', 'merge', 'cherry-pick', 'revert', 'rebase', 'am', 'push'])
// Global options that take the next word as their value (`git -C dir`, `git -c key=value`).
const OPTION_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** The words of one segment of a shell command, without leading `NAME=value` assignments (`GIT_EDITOR=true git merge x`). */
function commandWords(segment: string): string[] {
  const words = segment.trim().split(/\s+/)
  while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift()
  return words
}

/** The git subcommand and its arguments in one segment of a shell command, or null when it is not a git command. */
function gitCall(segment: string): { sub: string; args: string[] } | null {
  const words = commandWords(segment)
  if (words.shift() !== 'git') return null
  while (words.length > 0 && (words[0] ?? '').startsWith('-')) {
    const option = words.shift() ?? ''
    if (OPTION_WITH_VALUE.has(option)) words.shift()
  }
  const sub = words.shift()
  return sub === undefined ? null : { sub, args: words }
}

/** A push whose refspec lands on main: `main`, `+main`, `HEAD:main`, `fix:main`. */
function pushesToMain(args: readonly string[]): boolean {
  return args.filter(arg => !arg.startsWith('-')).slice(1).some(ref => /^\+?main$/.test(ref) || /:main$/.test(ref))
}

// Words that can stand before a command in a segment: `then gh pr merge 1`, `command gh pr merge 1`.
const COMMAND_PREFIXES = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '(', '{', 'command', 'env', 'exec', 'sudo', 'time'])
// `gh` options that take the next word as their value.
const GH_OPTIONS_WITH_VALUE = new Set(['-R', '--repo', '-X', '--method'])

/** `gh pr merge`, or the API calls behind it: a PUT to `pulls/1/merge`, or the GraphQL mutations. */
function mergesPullRequest(segment: string): boolean {
  const words = commandWords(segment)
  while (COMMAND_PREFIXES.has(words[0] ?? '')) words.shift()
  if (!/(?:^|[\\/])gh(?:\.exe)?$/.test(words.shift() ?? '')) return false
  // Options read with quoted text blanked: `--body "see --help"` is not asking for help.
  const options = segment.replace(/"[^"]*"|'[^']*'/g, '""').split(/\s+/)
  if (['--help', '-h', '--disable-auto'].some(option => options.includes(option))) return false
  const positional = words.filter((word, index) => !word.startsWith('-') && !GH_OPTIONS_WITH_VALUE.has(words[index - 1] ?? ''))
  if (positional[0] === 'pr') return positional[1] === 'merge'
  if (positional[0] !== 'api') return false
  if (positional[1] === 'graphql') return /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/.test(segment)
  const isPut = /(?:^|\s)(?:-X\s*|--method[=\s]+)["']?PUT\b/i.test(segment)
  return isPut && /\/pulls\/[^/\s]+\/merge["']?$/.test(positional[1] ?? '')
}

/** Why `command` is refused on `branch`, or null when it may run. `branch` is null outside a checkout, where only the merge rule applies. */
export function blockedBy(command: string, branch: string | null): string | null {
  // The merge rule reads quotes and heredocs, because it runs on every branch and work often mentions a merge in passing.
  // A whole-line comment goes first: an apostrophe in one would open a quote that swallows the next line.
  if (commandSegments(command.replace(/^\s*#.*$/gm, '')).map(executedText).some(mergesPullRequest)) {
    return 'dope-tdd branch guard: merging a pull request is for a person. Stop here, and say it is ready for them to read and merge.'
  }
  if (branch === null) return null
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const call = gitCall(segment)
    if (call === null || !WRITES.has(call.sub)) continue
    if (branch === 'main') {
      return `dope-tdd branch guard: \`git ${call.sub}\` on main is not allowed here. Make a branch first (git checkout -b <name>), then open a pull request.`
    }
    if (call.sub === 'push' && pushesToMain(call.args)) {
      return 'dope-tdd branch guard: pushing to main is not allowed here. Push your branch and open a pull request.'
    }
  }
  return null
}

function currentBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function main(stdin: string): number {
  let input: { tool_input?: { command?: unknown }; cwd?: unknown }
  try {
    input = JSON.parse(stdin)
  } catch {
    return 0
  }
  const command = input.tool_input?.command
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd()
  if (typeof command !== 'string') return 0
  // The branch where the command runs: the hook's cwd follows Claude into a worktree, the project dir does not.
  const reason = blockedBy(command, currentBranch(cwd))
  if (reason === null) return 0
  process.stderr.write(`${reason}\n`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let stdin = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => (stdin += chunk))
  process.stdin.on('end', () => process.exit(main(stdin)))
}
