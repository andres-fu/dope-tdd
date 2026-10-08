import { commandSegments } from './shell'

const PATH_TO_SOURCE = String.raw`((?:[A-Za-z]:)?(?:[\w.~-]*\/)*src\/[\w./-]+?\.tsx?)`
const SOURCE_PATH = new RegExp(String.raw`(?:^|[\s'"=(])` + PATH_TO_SOURCE + String.raw`(?=$|[\s'"),;])`, 'g')
const IN_PLACE_SED = /\bsed\s+(?:-\w+\s+)*-i/
const SCRIPT_WRITE = /open\([^)]*['"][wa]\+?['"]|writeFileSync|writeFile\(|(?<!stdout|stderr)\.write\(|write_text\(/
const REDIRECT_TARGET = new RegExp(String.raw`(?:>>?|\btee\s+(?:-a\s+)?)\s*['"]?` + PATH_TO_SOURCE, 'g')
const COPY_OR_MOVE_TARGET = new RegExp(
  String.raw`\b(?:cp|mv)\b[^|;&\n]*\s['"]?` + PATH_TO_SOURCE + String.raw`['"]?\s*(?:$|[;&|\n])`,
  'g',
)

function isSourceFile(path: string): boolean {
  return !path.endsWith('.d.ts')
}

function captures(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

function writesIn(segment: string): string[] {
  const writesEveryMention = IN_PLACE_SED.test(segment) || SCRIPT_WRITE.test(segment)
  return [
    ...(writesEveryMention ? captures(SOURCE_PATH, segment) : []),
    ...captures(REDIRECT_TARGET, segment),
    ...captures(COPY_OR_MOVE_TARGET, segment),
  ]
}

export function findSourceWrites(command: string): string[] {
  const normalized = command.replace(/\\/g, '/')
  const written = commandSegments(normalized).flatMap(writesIn).filter(isSourceFile)
  return [...new Set(written)]
}
