import { ELSEWHERE, commandSegments, locatedSegments } from './shell'
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

function isSourceFile(path: string): boolean {
  return !path.endsWith('.d.ts') && !PARENT_SEGMENT.test(path) && !Object.values(STACKS).some(stack => stack.testFile.test(path))
}

function captures(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

function writesIn(segment: string): string[] {
  const writesEveryMention = IN_PLACE_SED.test(segment) || SCRIPT_WRITE.test(segment) || POWERSHELL_WRITE.test(segment)
  return [
    ...(writesEveryMention ? captures(SOURCE_PATH, segment) : []),
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
  const written = locatedSegments(normalized, root).flatMap(({ segment, cwd }) =>
    writesIn(segment)
      .filter(isSourceFile)
      .map(path => (/^(?:[A-Za-z]:)?\//.test(path) ? path : cwd === ELSEWHERE ? `${ELSEWHERE}/${path}` : `${cwd}/${path}`)),
  )
  return [...new Set(written)]
}
