import type { ToolCallResult } from 'claude-code'

export function succeeded(result: ToolCallResult): boolean {
  return result.deny === undefined && result.isError !== true
}

export function withContext(result: ToolCallResult, lines: string[]): ToolCallResult {
  return lines.length === 0 || result.deny !== undefined
    ? result
    : { ...result, context: [...(result.context ?? []), ...lines] }
}

export function tell(quiet: boolean, result: ToolCallResult, lines: string[]): ToolCallResult {
  return quiet ? result : withContext(result, lines)
}
