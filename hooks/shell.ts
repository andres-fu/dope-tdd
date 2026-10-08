const HEREDOC = /<<-?\s*['"]?\w+/
const OPERATOR = /\s*(?:&&|\|\||;|\|)\s*/

export function commandSegments(command: string): string[] {
  if (HEREDOC.test(command)) {
    return [command]
  }
  return command.split(OPERATOR).filter(segment => segment !== '')
}
