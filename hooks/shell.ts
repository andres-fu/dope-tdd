const HERESTRING = /@['"]\r?\n/
// A heredoc opener: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"`. Sticky, so it is tried at the `<<` just read.
const HEREDOC_OPEN = /<<-?\s*(['"]?)(\w+)\1/y

// A shell that runs what it reads on stdin: a heredoc fed to it is commands, not data.
const SHELL_READER = /^\s*(?:\w+=\S*\s+)*(?:\S*[\\/])?(?:bash|sh|zsh|dash|ksh)(?:\.exe)?(?:\s+-\w+)*\s*(?:<<|$)/

/**
 * The part of a segment that runs. A heredoc body fed to anything but a shell
 * (`cat > body.md <<'EOF'`, `tee`, `gh ... --body-file -`) is data: the
 * commands it quotes never run, so only the opener line counts.
 */
export function executedText(segment: string): string {
  const newline = segment.indexOf('\n')
  if (newline === -1) {
    return segment
  }
  const opener = segment.slice(0, newline)
  if (!/<<-?\s*(['"]?)\w+\1/.test(opener) || SHELL_READER.test(opener)) {
    return segment
  }
  return opener
}

/**
 * Splits a command on `&&`, `||`, `;` and `|` outside quotes. A heredoc's body
 * stays with the command that opened it, verbatim, and what follows its
 * terminator is split as usual; a PowerShell here-string keeps the whole
 * command, because its body is data.
 */
export function commandSegments(command: string): string[] {
  if (HERESTRING.test(command)) {
    return [command]
  }
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const pendingHeredocs: string[] = []
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
    if (char === '<' && command[i + 1] === '<') {
      HEREDOC_OPEN.lastIndex = i
      const opened = HEREDOC_OPEN.exec(command)
      if (opened !== null) {
        pendingHeredocs.push(opened[2] ?? '')
        current += opened[0]
        i += opened[0].length - 1
        continue
      }
    }
    if (char === '\n' && pendingHeredocs.length > 0) {
      // Each body runs to its terminator line; it belongs to the command that opened it and is never split.
      let rest = command.slice(i + 1)
      let body = ''
      for (const word of pendingHeredocs) {
        const lines = rest.split('\n')
        let taken = 0
        for (const line of lines) {
          taken++
          if (line.replace(/^\t+/, '').trimEnd() === word) {
            break
          }
        }
        const piece = lines.slice(0, taken).join('\n')
        body += (body === '' ? '' : '\n') + piece
        rest = lines.slice(taken).join('\n')
      }
      pendingHeredocs.length = 0
      current += '\n' + body
      i += body.length
      continue
    }
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      segments.push(current)
      current = ''
      i++
      continue
    }
    if (char === ';' || char === '|' || char === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.map(segment => segment.trim()).filter(segment => segment !== '')
}

export type LocatedSegment = { segment: string; cwd: string; vars: ShellVars }

/** The directory a command's segments run in: a `cd` moves every segment after it. Outside the root is still a place, named as it is. */
export const ELSEWHERE = '~'

function joinPath(base: string, target: string): string {
  const slashed = target.replace(/\\/g, '/')
  if (/^(?:[A-Za-z]:)?\//.test(slashed)) {
    return normalizePath(slashed)
  }
  return normalizePath(`${base.replace(/\\/g, '/')}/${slashed}`)
}

function normalizePath(path: string): string {
  const drive = /^([A-Za-z]:)(\/.*)?$/.exec(path)
  const prefix = drive === null ? (path.startsWith('/') ? '/' : '') : `${drive[1]}/`
  const rest = drive === null ? path.replace(/^\//, '') : (drive[2] ?? '').replace(/^\//, '')
  const out: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return `${prefix}${out.join('/')}`
}

/**
 * Each segment with the directory it runs in. `root` is where the command
 * starts; a `cd` segment moves the segments after it (`cd` alone, `cd ~` and
 * `cd -` go somewhere this cannot see, so they go ELSEWHERE). A pipe does not
 * change directory; a subshell is not tracked.
 */
export function locatedSegments(command: string, root: string): LocatedSegment[] {
  let cwd = root.replace(/\\/g, '/').replace(/\/$/, '')
  let vars: ShellVars = new Map()
  const located: LocatedSegment[] = []
  for (const segment of commandSegments(command)) {
    located.push({ segment, cwd, vars })
    cwd = movedBy(cwd, segment, vars)
    vars = withAssignment(vars, segment)
  }
  return located
}

/**
 * Shell variables a command set before a segment (`R=/tmp/x;`, `export R=...`), by name (#69). Only what the command
 * itself assigns is known; the environment is not, so `$HOME` or `$(mktemp -d)` stays unexpanded.
 */
export type ShellVars = ReadonlyMap<string, string>

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S*)$/

function withAssignment(vars: ShellVars, segment: string): ShellVars {
  const assignment = ASSIGNMENT.exec(segment.trim())
  if (assignment === null) {
    return vars
  }
  const [, name = '', raw = ''] = assignment
  const value = raw.replace(/^(['"])(.*)\1$/, '$2')
  const expanded = raw.startsWith("'") ? value : expandVariables(value, vars)
  const next = new Map(vars)
  // A value this cannot know (another variable, a command) makes the name unknown, not wrong.
  if (expanded === null) {
    next.delete(name)
  } else {
    next.set(name, expanded)
  }
  return next
}

/** `text` with the variables the command set put in; null when anything is left that the shell would expand. */
export function expandVariables(text: string, vars: ShellVars): string | null {
  const out = expandKnown(text, vars)
  return /\$|%\w+%|`/.test(out) ? null : out
}

/** `text` with the variables the command set put in, and every other `$NAME` or `${NAME}` left as it is. */
export function expandKnown(text: string, vars: ShellVars): string {
  return text.replace(/\$\{(\w+)\}|\$([A-Za-z_]\w*)/g, (whole: string, braced?: string, bare?: string) => vars.get(braced ?? bare ?? '') ?? whole)
}

// Commands that only read. `find` with -exec or -delete and `git` verbs that write are not among them.
const READS = /^\s*(?:cd|ls|dir|cat|type|head|tail|grep|rg|wc|pwd|echo|which|where|tree|stat|file|du|df|sort|uniq|true|find(?![^\n]*\s-(?:exec|execdir|delete|ok|fprint)\b)|git\s+(?:status|log|diff|show|branch|rev-parse|ls-files|blame|remote|config\s+--get))(?:\s|$)/
// An output redirect writes, whatever the command: `echo x > src/a.ts`. Stderr to a file descriptor or /dev/null does not.
const WRITES_OUTPUT = /(?:^|[^\d&>])>{1,2}(?!&)\s*(?!\/dev\/null)\S/

/** Only commands that read: nothing in it can change a file, so there is nothing to snapshot around it. */
export function isPureRead(command: string): boolean {
  const segments = commandSegments(command).map(executedText).filter(segment => segment.trim() !== '')
  return segments.length > 0 && segments.every(segment => READS.test(segment) && !WRITES_OUTPUT.test(segment))
}

/** Where the shell is after the whole command, starting from `start`: the next call starts there. */
export function cwdAfter(command: string, start: string): string {
  const located = locatedSegments(command, start)
  const last = located.at(-1)
  return last === undefined ? start.replace(/\\/g, '/').replace(/\/$/, '') : movedBy(last.cwd, last.segment, last.vars)
}

function movedBy(cwd: string, segment: string, vars: ShellVars): string {
  const cd = /^cd(?:\s+(.*))?$/.exec(segment.trim())
  if (cd === null) {
    return cwd
  }
  const quoted = (cd[1] ?? '').trim()
  const unquoted = quoted.replace(/^(['"])(.*)\1$/, '$2')
  // A target this cannot expand (`$SOMEWHERE`, `$(mktemp -d)`, `%TEMP%`) goes somewhere it cannot see (#69).
  const target = quoted.startsWith("'") ? unquoted : expandVariables(unquoted, vars)
  if (target === null || target === '' || target === '-' || target === '~' || target.startsWith('~/')) {
    return ELSEWHERE
  }
  if (cwd === ELSEWHERE) {
    return /^(?:[A-Za-z]:)?[\\/]/.test(target) ? joinPath('', target) : ELSEWHERE
  }
  return joinPath(cwd, target)
}
