const PATH_TO_SOURCE = String.raw`((?:[A-Za-z]:)?(?:[\w.~-]*\/)*src\/[\w./-]+?\.tsx?)`
const SOURCE_PATH = new RegExp(String.raw`(?:^|[\s'"=(])` + PATH_TO_SOURCE + String.raw`(?=$|[\s'"),;])`, 'g')
const IN_PLACE_SED = /\bsed\s+(?:-\w+\s+)*-i/
const SCRIPT_WRITE = /open\([^)]*['"][wa]\+?['"]|writeFileSync|writeFile\(|\.write\(|write_text\(/
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

export function findSourceWrites(command: string): string[] {
  const normalized = command.replace(/\\/g, '/')
  const mentioned = captures(SOURCE_PATH, normalized)
  const writesEveryMention = IN_PLACE_SED.test(normalized) || SCRIPT_WRITE.test(normalized)

  const written = [
    ...(writesEveryMention ? mentioned : []),
    ...captures(REDIRECT_TARGET, normalized),
    ...captures(COPY_OR_MOVE_TARGET, normalized),
  ].filter(isSourceFile)

  return [...new Set(written)]
}
