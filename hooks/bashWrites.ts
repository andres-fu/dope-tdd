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

function isSourceFile(path: string): boolean {
  return !path.endsWith('.d.ts') && !PARENT_SEGMENT.test(path) && !Object.values(STACKS).some(stack => stack.testFile.test(path))
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

function writesIn(whole: string): string[] {
  // A data heredoc's body is text: only its opener line can write (shell.ts, writableText).
  const segment = writableText(whole)
  const scriptTargets = SCRIPT_WRITE.test(segment) ? literalWriteTargets(segment) : null
  const writesEveryMention = IN_PLACE_SED.test(segment) || POWERSHELL_WRITE.test(segment) || (SCRIPT_WRITE.test(segment) && scriptTargets === null)
  return [
    ...(writesEveryMention ? captures(SOURCE_PATH, segment) : (scriptTargets ?? [])),
    ...captures(REDIRECT_TARGET, segment),
    ...captures(COPY_OR_MOVE_TARGET, segment),
  ]
}

/**
 * Whether the command writes one named file, whatever its extension: the patterns above match code files only, and the
 * override record is JSON (override v1, 2026-10-18). A redirect, tee, cp or mv onto it, rm or truncate of it, or an
 * in-place sed, PowerShell or script write that mentions it. The name must stand alone: `my-x.json.bak` is not `x.json`.
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
  return onto.some(pattern => pattern.test(text)) || (mentioned && (IN_PLACE_SED.test(text) || POWERSHELL_WRITE.test(text) || SCRIPT_WRITE.test(text)))
}

/**
 * Source files the command writes. With a `root`, each path is resolved
 * against the directory its segment runs in (a `cd` earlier in the command
 * moves it), so the result is absolute and a write in another repository
 * resolves outside this one. Without a root, paths come back as written.
 */
export function findSourceWrites(command: string, root?: string): string[] {
  const normalized = command.replace(/\\/g, '/')
  if (root === undefined) {
    return [...new Set(commandSegments(normalized).flatMap(writesIn).filter(isSourceFile))]
  }
  const written = locatedSegments(normalized, root).flatMap(({ segment, cwd, vars }) =>
    // Paths through a variable the command set are expanded (#69); one through any other variable lands somewhere this
    // cannot see, so it is written as under ELSEWHERE and never taken for a file of this project.
    writesIn(expandKnown(segment, vars).replace(/\$\{\w+\}\/|\$[A-Za-z_]\w*\//g, `${ELSEWHERE}/`))
      .filter(isSourceFile)
      .map(path =>
        /^(?:[A-Za-z]:)?\//.test(path) || path.startsWith(`${ELSEWHERE}/`) ? path : cwd === ELSEWHERE ? `${ELSEWHERE}/${path}` : `${cwd}/${path}`,
      ),
  )
  return [...new Set(written)]
}
