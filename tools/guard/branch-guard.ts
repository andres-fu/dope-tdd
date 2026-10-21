// The branch guard: a PreToolUse hook (.claude/settings.json) that stops Claude committing, merging or pushing on
// main in this repository. Process review, 2026-10-21: #157's work was started on main, and "work on a branch" was a
// rule nothing enforced. This hook is the local half; GitHub branch protection on main is the half that cannot be
// talked past (a command spelled in a way this reading misses still meets it on push).
//
// Claude Code passes the tool call as JSON on stdin; exit 2 blocks it and shows stderr to Claude. Anything this cannot
// read (bad input, a folder that is not a git checkout) lets the command through: the guard must never wedge a session.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Subcommands that make or publish commits. Pull, fetch, checkout and every read stay allowed on main.
const WRITES = new Set(['commit', 'merge', 'cherry-pick', 'revert', 'rebase', 'am', 'push'])
// Global options that take the next word as their value (`git -C dir`, `git -c key=value`).
const OPTION_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** The git subcommand and its arguments in one segment of a shell command, or null when it is not a git command. */
function gitCall(segment: string): { sub: string; args: string[] } | null {
  const words = segment.trim().split(/\s+/)
  // Leading `NAME=value` assignments, as in `GIT_EDITOR=true git merge x`.
  while (words.length > 0 && /^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift()
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

/** Why `command` is refused on `branch`, or null when it may run. */
export function blockedBy(command: string, branch: string): string | null {
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
  const branch = currentBranch(cwd)
  if (branch === null) return 0
  const reason = blockedBy(command, branch)
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
