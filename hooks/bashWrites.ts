import { ELSEWHERE, commandSegments, expandKnown, locatedSegments } from './shell'
import { STACKS } from './stacks'

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
  const targets: string[] = []
  for (const call of calls) {
    const literal = STRING_LITERAL.exec((call[1] ?? '').trim())?.[2]
    if (literal === undefined) {
      return null
    }
    if (CODE_FILE.test(literal)) {
      targets.push(literal)
    }
  }
  return targets
}

function writesIn(segment: string): string[] {
  const scriptTargets = SCRIPT_WRITE.test(segment) ? literalWriteTargets(segment) : null
  const writesEveryMention = IN_PLACE_SED.test(segment) || POWERSHELL_WRITE.test(segment) || (SCRIPT_WRITE.test(segment) && scriptTargets === null)
  return [
    ...(writesEveryMention ? captures(SOURCE_PATH, segment) : (scriptTargets ?? [])),
    ...captures(REDIRECT_TARGET, segment),
    ...captures(COPY_OR_MOVE_TARGET, segment),
  ]
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
