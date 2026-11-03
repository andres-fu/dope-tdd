import { withoutDots } from './mirror.ts'
import { ELSEWHERE, commandSegments, expandKnown, locatedSegments, writableText } from './shell.ts'
import { STACKS } from './stacks.ts'

// A code file of any stack, anywhere: the caller's layout decides which are source. Test files are dropped below.
const PATH_TO_SOURCE = String.raw`((?:[A-Za-z]:)?(?:[\w.~@-]*\/)*[\w.@-]+?\.(?:[cm]?[jt]sx?|py|gd|cs|java|kts?))(?![\w.-])`
const SOURCE_PATH = new RegExp(String.raw`(?:^|[\s'"=(])` + PATH_TO_SOURCE + String.raw`(?=$|[\s'"),;])`, 'g')
const IN_PLACE_SED = /\bsed\s+(?:-\w+\s+)*-i/
const SCRIPT_WRITE = /open\([^)]*['"][wa]\+?['"]|writeFileSync|writeFile\(|(?<!stdout|stderr)\.write\(|write_text\(/
const POWERSHELL_WRITE = /\b(?:Set-Content|Add-Content|Out-File)\b/i
const REDIRECT_TARGET = new RegExp(String.raw`(?:>>?|\btee\s+(?:-a\s+)?)\s*['"]?` + PATH_TO_SOURCE, 'g')
const COPY_OR_MOVE_TARGET = new RegExp(
  String.raw`\b(?:cp|mv)\b[^|;&\n]*\s['"]?` + PATH_TO_SOURCE + String.raw`['"]?\s*(?:$|[;&|\n])`,
  'g',
)
const PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/
const CODE_FILE = new RegExp(`^${PATH_TO_SOURCE}$`)

// The write calls a script can make, each capturing the expression that names its target: the first argument of
// open() with a writing mode, of fs.writeFile and friends, and of Path() before .write_text / .write_bytes.
const OPEN_FOR_WRITE = /\bopen\(\s*([^,()]+?)\s*,\s*(?:mode\s*=\s*)?['"](?:[wax]|r\+)/g
const FS_WRITE = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile)\(\s*([^,()]+?)\s*,/g
const PATHLIB_WRITE = /\bPath\(\s*([^()]+?)\s*\)\s*\.write_(?:text|bytes)\(/g
const ANY_PATHLIB_WRITE = /\.write_(?:text|bytes)\(/g
const STREAM_WRITE = /(?<!stdout|stderr)\.write\(/
const STRING_LITERAL = /^(['"`])([^'"`]*)\1$/

/** #272: one spelling for a path. Through a folder this can't see, a `..` says nothing, so that path stays as it is. */
function resolved(path: string): string {
  return path.split('/').includes(ELSEWHERE) ? path : withoutDots(path)
}

function isSourceFile(path: string): boolean {
  // A home folder (`~user/..`) is one this can't see too, so a `..` from it says nothing.
  const fromHome = path.startsWith(ELSEWHERE) && PARENT_SEGMENT.test(path)
  return !path.endsWith('.d.ts') && !fromHome && !Object.values(STACKS).some(stack => stack.testFile.test(path))
}

function captures(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

const IDENTIFIER = /^[A-Za-z_]\w*$/
// `p = 'src/x.ts'`, `const target = "src/x.ts"`: a name and the value it is given.
const ASSIGNMENT = /(?:^|[\s;(])(?:(?:const|let|var)\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*([^\n;]+)/g

/** Each assigned name and its plain string value; null when it is assigned anything else, or more than once. */
function plainAssignments(segment: string): Map<string, string | null> {
  const names = new Map<string, string | null>()
  for (const match of segment.matchAll(ASSIGNMENT)) {
    const name = match[1] ?? ''
    const value = STRING_LITERAL.exec((match[2] ?? '').trim())?.[2] ?? null
    names.set(name, names.has(name) ? null : value)
  }
  return names
}

/**
 * The code files a script writes, when every write call in it names its target as a string literal: a source path
 * elsewhere in the script (a string it replaces, a file it only reads) is data. Null when any target is an expression
 * or a write cannot be traced to a call that names one, so the caller counts every path the script mentions.
 */
export function literalWriteTargets(segment: string): string[] | null {
  const opened = [...segment.matchAll(OPEN_FOR_WRITE)]
  const pathlib = [...segment.matchAll(PATHLIB_WRITE)]
  const calls = [...opened, ...segment.matchAll(FS_WRITE), ...pathlib]
  const untracedPathlib = [...segment.matchAll(ANY_PATHLIB_WRITE)].length > pathlib.length
  // A stream's .write() is traced only when the script opened something for writing.
  const untracedStream = STREAM_WRITE.test(segment) && opened.length === 0
  if (calls.length === 0 || untracedPathlib || untracedStream) {
    return null
  }
  const assigned = plainAssignments(segment)
  const targets: string[] = []
  for (const call of calls) {
    const argument = (call[1] ?? '').trim()
    // A name assigned once, to a plain string, is that string: `p='src/x.ts'` ... `open(p,'w')` (2026-10-18).
    const literal = STRING_LITERAL.exec(argument)?.[2] ?? (IDENTIFIER.test(argument) ? (assigned.get(argument) ?? undefined) : undefined)
    if (literal === undefined) {
      return null
    }
    if (CODE_FILE.test(literal)) {
      targets.push(literal)
    }
  }
  return targets
}

// A command that runs a quoted argument as shell: what is quoted there is commands, so its redirects are real.
const RUNS_QUOTED_SHELL = /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|ksh|fish|eval|ssh|su|pwsh|powershell|cmd|wsl|iex|Invoke-Expression)(?:\.exe)?(?=\s|$)/i
// Where a quoted span is a redirect's or tee's target, not text: `> "src/a.ts"`.
const BEFORE_TARGET = /(?:>>?|\btee\s+(?:-a\s+)?)\s*$/
// A PowerShell here-string opens with `@'` or `@"` and only whitespace after it to the line end, and closes with `'@`
// or `"@` at the start of a line. The whitespace and line ends are PowerShell's own, checked with its parser (design v2
// for #346): any space separator, tab, VT, FF, NEL, or a line or paragraph separator; then LF, CRLF or a bare CR.
const HERESTRING_OPEN = /@(['"])[\t\v\f\u{85}\u{2028}\u{2029}\p{Zs}]*(\r\n?|\n)/uy

/**
 * Where a PowerShell here-string opened at `at` ends, past its close, or -1 when none opens there or it never closes.
 * PowerShell runs nothing from a command with an unclosed one, and in Bash `@'` is an ordinary quote, so an opener
 * alone is never a span (security review of 0.2.17).
 */
function herestringEnd(segment: string, at: number): number {
  HERESTRING_OPEN.lastIndex = at
  const opened = HERESTRING_OPEN.exec(segment)
  if (opened === null) {
    return -1
  }
  const close = opened[1] === '"' ? /(?:\r\n?|\n)"@/g : /(?:\r\n?|\n)'@/g
  // From the opener's own line end, so an empty body (`@'`, then `'@` on the next line) closes there.
  close.lastIndex = at + opened[0].length - (opened[2] ?? '').length
  const closed = close.exec(segment)
  return closed === null ? -1 : closed.index + closed[0].length
}

/**
 * #239: the shell words of a segment, with the text inside quotes blanked. A redirect, `sed -i`, `cp`, `mv` or `tee`
 * quoted in a commit message, an echoed sentence or a script's string is data and writes nothing; one outside quotes
 * is the shell's. A quoted redirect target stays, and a segment that hands its quotes to a shell (`ssh host "…"`,
 * `eval "…"`, `sh -c "…"`) is left whole, so its writes are still seen: the shell's name must itself be a shell word,
 * since a note that says "PowerShell" is prose (#332). With `herestrings`, for a command PowerShell runs, a here-string
 * is one quoted span wherever it stands, whatever apostrophes its body holds (#332); Bash has none. Same length as the
 * segment.
 */
function shellWords(segment: string, herestrings: boolean): string {
  let out = ''
  let quote: '"' | "'" | null = null
  let keep = false
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i] ?? ''
    if (quote === null) {
      const end = herestrings && char === '@' ? herestringEnd(segment, i) : -1
      if (end !== -1) {
        out += segment.slice(i, end).replace(/[^\r\n]/g, ' ')
        i = end - 1
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        keep = BEFORE_TARGET.test(out)
      }
      out += char
    } else if (char === '\\' && quote === '"' && i + 1 < segment.length) {
      out += keep ? char + (segment[i + 1] ?? '') : '  '
      i++
    } else if (char === quote) {
      quote = null
      out += char
    } else {
      out += keep || char === '\n' ? char : ' '
    }
  }
  return RUNS_QUOTED_SHELL.test(out) ? segment : out
}

// A PowerShell write's shape: the verb, the option that names its path (`-Path x` or `-Path:x`), the switches that take
// no value, and where one command ends. Any other option takes the token after it as its value.
const POWERSHELL_VERB = /^(?:Set-Content|Add-Content|Out-File)$/i
const POWERSHELL_PATH_OPTION = /^-(?:Path|FilePath|LiteralPath)(?::(.*))?$/i
const POWERSHELL_SWITCH = /^-(?:Append|Force|NoNewline|NoClobber|PassThru|AsByteStream|Confirm|WhatIf|Verbose|Debug)$/i
const COMMAND_END = /^(?:;|\||&&|\|\|)$|;$/
const QUOTES_AROUND = /^(['"])(.*)\1$/s

/**
 * What a PowerShell write names (#332): the value of `-Path`, `-FilePath` or `-LiteralPath`, or its first positional
 * argument, quoted or not. Text in `-Value`, a here-string or any other quoted span is data. A target the shape doesn't
 * name (`-Path $p`) names nothing: the git check after the command says what landed. Tokens are read from the blanked
 * words, so a verb or an option inside quotes is text; each value is read from the segment, quotes stripped.
 */
function powershellNamed(segment: string, words: string): string[] {
  const tokens = [...words.matchAll(SHELL_WORD)]
  const raw = (index: number): string => {
    const token = tokens[index]
    return token === undefined ? '' : segment.slice(token.index, token.index + token[0].length).replace(QUOTES_AROUND, '$2')
  }
  const named: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (!POWERSHELL_VERB.test(tokens[i]?.[0] ?? '')) {
      continue
    }
    let positional = false
    for (let j = i + 1; j < tokens.length; j++) {
      const word = tokens[j]?.[0] ?? ''
      if (COMMAND_END.test(word)) {
        break
      }
      const option = POWERSHELL_PATH_OPTION.exec(raw(j))
      if (option !== null) {
        named.push(option[1] === undefined ? raw(++j) : option[1].replace(QUOTES_AROUND, '$2'))
      } else if (word.startsWith('-')) {
        j += POWERSHELL_SWITCH.test(word) ? 0 : 1
      } else if (!positional) {
        positional = true
        named.push(raw(j))
      }
    }
  }
  return named
}

function powershellTargets(segment: string, words: string): string[] {
  return [...captures(SOURCE_PATH, words), ...powershellNamed(segment, words).filter(path => CODE_FILE.test(path))]
}

// One word of a shell command, its quotes kept: `'a b'c` is one word.
const SHELL_WORD = /(?:'[^']*'|"(?:\\.|[^"])*"|[^\s'"])+/g
// What `release` never took for a path of this project: a leading `./`, or any `..`. Import paths are spelled this way.
const RELATIVE_SPELLING = /^\.\.?\/|(?:^|\/)\.\.(?:\/|$)/

/**
 * The files an in-place sed names: what follows its first argument, its script, so text in the script is never one. With
 * more than one `-e`, a later script reads as a file, which is harmless: this only says which mentions to keep.
 */
function sedFiles(segment: string): string[] {
  const words = segment.match(SHELL_WORD) ?? []
  const args = words.slice(words.indexOf('sed') + 1).filter(word => !word.startsWith('-'))
  return args.slice(1).map(word => word.replace(/['"]/g, ''))
}

/**
 * Every path a script mentions, for a write that can't be traced to one. Round 3 of #272: a path spelled relatively is
 * an import path in a text replace, and resolving it refuses the edit for a file the script never touches.
 */
function mentioned(segment: string): string[] {
  return captures(SOURCE_PATH, segment).filter(path => !RELATIVE_SPELLING.test(path))
}

/**
 * What an in-place sed writes: its file arguments. A sed inside text handed to a shell (`eval "sed -i …"`, `su -c "…"`,
 * a here-string piped to bash) is one quoted word to sedFiles, so there it also names the paths its segment mentions,
 * dotted ones left as text as in a script (#272), as main did (#350). Only there: a sed that is its own word has its
 * files read already, and a shell's name elsewhere in the segment (a comment, `wsl sed`) makes its script no target.
 */
function sedTargets(segment: string, words: string): string[] {
  const handed = RUNS_QUOTED_SHELL.test(words) && !(segment.match(SHELL_WORD) ?? []).includes('sed')
  return handed ? mentioned(segment) : sedFiles(segment).filter(path => CODE_FILE.test(path))
}

function writesIn(whole: string, herestrings: boolean): string[] {
  // A data heredoc's body is text: only its opener line can write (shell.ts, writableText).
  const segment = writableText(whole)
  const words = shellWords(segment, herestrings)
  const scriptTargets = SCRIPT_WRITE.test(segment) ? literalWriteTargets(segment) : null
  // A script's writes live in its quoted code, so SCRIPT_WRITE reads the whole segment. sed -i and a PowerShell verb
  // must be the shell's own word, and name only what their shape names (#332): text in their quotes is data.
  return [
    ...(SCRIPT_WRITE.test(segment) && scriptTargets === null ? mentioned(segment) : (scriptTargets ?? [])),
    ...(IN_PLACE_SED.test(words) ? sedTargets(segment, words) : []),
    ...(POWERSHELL_WRITE.test(words) ? powershellTargets(segment, words) : []),
    ...captures(REDIRECT_TARGET, words),
    // cp and mv take quoted paths, so their targets come from the segment, once the verb is seen outside quotes.
    ...(/\b(?:cp|mv)\b/.test(words) ? captures(COPY_OR_MOVE_TARGET, segment) : []),
  ]
}

/**
 * Whether the command writes one named file, whatever its extension: the patterns above match code files only, and the
 * override record is JSON (override v1, 2026-10-18). A redirect, tee, cp or mv onto it, rm or truncate of it, or the
 * name anywhere beside a script write, an in-place sed or a PowerShell write, quoted or not, as on main: no reading of
 * PowerShell's quoting can then hide a write to the file most worth forging, at the cost of refusing a note that only
 * names it beside a verb (design v2 for #346; #322 stays open). The name must stand alone: `my-x.json.bak` is not
 * `x.json`.
 */
export function writesFileNamed(command: string, name: string): boolean {
  const text = command.replace(/\\/g, '/')
  const exact = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`(?=$|[\s'"),;&|])`
  const file = String.raw`(?:^|[\s'"=(/])` + exact
  // Case-insensitive: Windows and macOS file names ignore case, so another spelling is the same file (verified review A8).
  const onto = [
    new RegExp(String.raw`(?:>>?|\btee\s+(?:-a\s+)?)\s*['"]?(?:[\w.~@-]*\/)*` + exact, 'i'),
    new RegExp(String.raw`\b(?:cp|mv)\b[^|;&\n]*` + file + String.raw`['"]?\s*(?:$|[;&|\n])`, 'i'),
    new RegExp(String.raw`\b(?:rm|truncate)\b[^|;&\n]*` + file, 'i'),
  ]
  const mentioned = new RegExp(file, 'i').test(text)
  // The name with any folder before it, a drive letter or a variable included: `C:/r/x.json`, `$root/x.json`.
  const isNamed = new RegExp(String.raw`^(?:[^\s'"]*\/)?` + exact, 'i')
  // What a sed or PowerShell write's shape names, read both ways: it catches `-Path:x.json`, which the boundary in
  // `file` misses (#332).
  const shaped = commandSegments(text).map(writableText).some(runnable =>
    [false, true].some(herestrings => {
      const words = shellWords(runnable, herestrings)
      const sedNames = IN_PLACE_SED.test(words) && sedFiles(runnable).some(path => isNamed.test(path))
      return sedNames || (POWERSHELL_WRITE.test(words) && powershellNamed(runnable, words).some(path => isNamed.test(path)))
    }),
  )
  const besideVerb = mentioned && (IN_PLACE_SED.test(text) || POWERSHELL_WRITE.test(text) || SCRIPT_WRITE.test(text))
  return onto.some(pattern => pattern.test(text)) || besideVerb || shaped
}

export type Shell = 'bash' | 'powershell'

// Whether each reading of a command knows here-strings: its own shell's reading, or with no shell given both, so a
// caller that forgets the shell refuses more instead of missing a write (design v2 for #346).
function readings(shell: Shell | undefined): boolean[] {
  return shell === undefined ? [false, true] : [shell === 'powershell']
}

/**
 * Source files the command writes. With a `root`, each path is resolved
 * against the directory its segment runs in (a `cd` earlier in the command
 * moves it), so the result is absolute and a write in another repository
 * resolves outside this one. Without a root, paths stay relative. Either way their dots are resolved (#272). `shell` is
 * the program that runs the command, which says whether a here-string exists.
 */
export function findSourceWrites(command: string, root?: string, shell?: Shell): string[] {
  const normalized = command.replace(/\\/g, '/')
  const writes = (segment: string): string[] => readings(shell).flatMap(herestrings => writesIn(segment, herestrings))
  if (root === undefined) {
    return [...new Set(commandSegments(normalized).flatMap(writes).filter(isSourceFile).map(resolved).filter(path => !PARENT_SEGMENT.test(path)))]
  }
  const written = locatedSegments(normalized, root).flatMap(({ segment, cwd, vars }) =>
    // Paths through a variable the command set are expanded (#69); one through any other variable lands somewhere this
    // cannot see, so it is written as under ELSEWHERE and never taken for a file of this project.
    writes(expandKnown(segment, vars).replace(/\$\{\w+\}\/|\$[A-Za-z_]\w*\//g, `${ELSEWHERE}/`))
      .filter(isSourceFile)
      .map(path =>
        /^(?:[A-Za-z]:)?\//.test(path) || path.startsWith(`${ELSEWHERE}/`) ? path : cwd === ELSEWHERE ? `${ELSEWHERE}/${path}` : `${cwd}/${path}`,
      )
      // Resolved once the folder is known, so `../a.ts` lands where it does.
      .map(resolved)
      .filter(path => !PARENT_SEGMENT.test(path)),
  )
  return [...new Set(written)]
}
