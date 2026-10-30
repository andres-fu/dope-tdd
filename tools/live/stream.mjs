// Reads what `claude -p --output-format stream-json --verbose` prints, for the live suite (tools/live/run.mjs).
// Pure: text in, facts out. Only what a scenario is judged on is kept: each session start (its folder and plugins),
// each tool call with its result and the subagent that made it, and each turn's final text.
//
// Hook context lines (`dope-tdd: … is outside this project`) are not in the stream: Claude Code hands them to the
// model, not to stream-json. A scenario reads them through /tdd's recent events instead, which is local command
// output and so arrives word for word.

/** The stream-json input that sends these prompts one after another, as the user would type them. */
export function userMessages(prompts) {
  return prompts.map(content => JSON.stringify({ type: 'user', message: { role: 'user', content } })).join('\n') + '\n'
}

/** A tool result's text: a string, or the text blocks of an array joined by newlines. */
function resultText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('\n')
}

export function readRun(text) {
  const inits = []
  const calls = []
  const turns = []
  const byId = new Map()
  // Each turn's result reports the session's cost so far, so the largest is the run's.
  let cost = 0
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'system' && event.subtype === 'init') {
      inits.push({
        cwd: event.cwd,
        sessionId: event.session_id,
        claudeVersion: event.claude_code_version,
        plugins: (event.plugins ?? []).map(({ name, path, source, version }) => ({ name, path, source, version })),
        commands: event.slash_commands ?? [],
      })
    }
    const content = event.message?.content
    if (event.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use') continue
        const call = { id: block.id, name: block.name, input: block.input, parent: event.parent_tool_use_id ?? null, result: null }
        calls.push(call)
        byId.set(block.id, call)
      }
    }
    if (event.type === 'user' && Array.isArray(content)) {
      for (const block of content) {
        const call = block.type === 'tool_result' ? byId.get(block.tool_use_id) : undefined
        if (call !== undefined) call.result = { text: resultText(block.content), error: block.is_error === true }
      }
    }
    if (event.type === 'result') {
      turns.push({ text: event.result ?? '', command: event.local_command !== undefined })
      if (typeof event.total_cost_usd === 'number') cost = Math.max(cost, event.total_cost_usd)
    }
  }
  return { inits, calls, turns, cost }
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** One line per event worth reading when a scenario fails: INIT, TOOL_USE, RESULT and END. */
export function describeRun(run) {
  const lines = []
  for (const init of run.inits) {
    const dope = init.plugins.find(p => p.name === 'dope-tdd')
    lines.push(`INIT cwd ${init.cwd} · ${dope === undefined ? 'dope-tdd not loaded' : `dope-tdd ${dope.version} (${dope.source})`}`)
  }
  for (const call of run.calls) {
    const indent = call.parent === null ? '' : '  [subagent] '
    lines.push(`${indent}TOOL_USE ${call.name} ${clip(JSON.stringify(call.input), 300)}`)
    if (call.result !== null) lines.push(`${indent}RESULT ${call.result.error ? 'error ' : ''}${clip(call.result.text, 600)}`)
  }
  for (const turn of run.turns) lines.push(`END ${clip(turn.text, 800)}`)
  return lines
}
