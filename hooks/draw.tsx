import type { Elements, RenderSurface } from 'claude-code'

import type { CurrentTest, Override, TddStats } from '../types'
import { bandView } from './bandModel.ts'
import type { Saved, Token } from './bandModel.ts'
import type { GuardConfig } from './config.ts'
import { moduleLabel } from './mirror.ts'
import { ACCENT, ALARM_TEXT } from './theme.ts'

type AnyElements = Elements[RenderSurface]

const NAME = 'dope-tdd'

export type BandModel = {
  stats: TddStats
  config: GuardConfig
  nowMs: number
  logo: string | null
  /** The git operation the guard stands down for, or '' when it is on. */
  standingDown: string
  /** Whether the current module's work is committed or pushed, as git last said. */
  saved?: Saved
  /** The default layout pairs none of the project's code (#214): an invalid file then guards nothing. */
  matchesNothing?: boolean
  /** The repo's override record: a waiting request, and the open overrides, show on the band. */
  overrides: readonly Override[]
  onViewTest: () => unknown
  /** Opens the test file the last run was (bandModel.ts, lastRunTarget). */
  onOpenLastRun: () => unknown
  onApprove: () => unknown
  onDeny: () => unknown
  onResume: () => unknown
  /** Ends the open override on a module, or `pause`. */
  onEnd: (target: string) => unknown
  /** This session's id, so another session's override is marked as theirs. */
  session?: string
}

function drawLogo(el: AnyElements, logo: string | null) {
  if (logo !== null && 'Svg' in el) {
    const { Svg } = el
    return <Svg source={logo} alt="Dope TDD skull" width={16} height={17} />
  }
  const { Text } = el
  return <Text bold color={ACCENT.ember}>☠</Text>
}

/** A word in its tone: green for a pass, ember for RED and MISSED, amber for what needs a look, dim for what is open. */
function drawToken(el: AnyElements, token: Token) {
  const { Text } = el
  switch (token.tone) {
    case 'pass':
      return <Text bold={token.text === token.text.toUpperCase()} color={ACCENT.pass}>{token.text}</Text>
    case 'ember':
      return <Text bold color={ACCENT.ember}>{token.text}</Text>
    case 'alarm':
      return <Text bold color={ALARM_TEXT} backgroundColor={ACCENT.ember}>{` ${token.text} `}</Text>
    case 'warn':
      return <Text bold color={ACCENT.paused}>{token.text}</Text>
    case 'dim':
      return <Text dimColor>{token.text}</Text>
    default:
      return <Text>{token.text}</Text>
  }
}

/**
 * Band v3 (2026-10-18), from the principal UX and engineering reviews. Line 1 is the story: the name, the module as
 * it is named, its red and green, the one verdict, and the last run. Line 2 is the next step. A third line appears only
 * when a person must act. Enforcing is silent; a guard that is not gets one amber word. Counts live in /tdd.
 */
export function drawBand(el: AnyElements, model: BandModel) {
  const { Box, Text, Button } = el
  const { stats: s, config, nowMs, logo } = model
  const view = bandView(s, config, model.overrides, nowMs, model.session, model.standingDown, model.saved ?? null, model.matchesNothing === true)

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={ACCENT.ember} paddingX={1}>
      <Box flexDirection="row" gap={2}>
        {drawLogo(el, logo)}
        <Text bold>{NAME}</Text>
        {view.idle && <Text>ready · write a failing test, or edit code, and this band follows</Text>}
        {view.idle && <Text dimColor>/tdd for status</Text>}
        {view.module !== null && <Text bold>{view.module}</Text>}
        {view.tokens.map(token => drawToken(el, token))}
        {view.verdict !== null && drawToken(el, view.verdict)}
        {view.guard !== null && <Text bold color={ACCENT.paused}>{view.guard.word}</Text>}
        {view.guard !== null && <Text>{view.guard.detail}</Text>}
        {/* The last run opens the test it ran (2026-10-18); keyed, since its text holds the age. Unread stays plain. */}
        {view.lastRun !== null && view.lastRunOpens !== null && (
          <Button key="last-run" label={view.lastRun} plain dimColor onPress={model.onOpenLastRun} />
        )}
        {view.lastRun !== null && view.lastRunOpens === null && <Text dimColor>{view.lastRun}</Text>}
        {/* #216: a refusal, a subagent's above all, was seen by no one watching the band. */}
        {view.refused !== null && <Text color={ACCENT.paused}>{view.refused}</Text>}
      </Box>
      {/* Every open door gets a sign, whichever module is current, and a way to close it (live trial, 2026-10-18). */}
      {view.open.map(door => (
        <Box flexDirection="row" gap={2}>
          <Text bold color={ACCENT.paused}>OVERRIDE OPEN</Text>
          <Text>{door.text}</Text>
          <Button key={`end-${door.target}`} label="END" onPress={() => model.onEnd(door.target)} />
        </Box>
      ))}
      {!view.idle && (
        <Box flexDirection="row" gap={2}>
          <Text dimColor>next</Text>
          <Text>{view.next}</Text>
          {s.current !== null && <Button key="view-test" label="VIEW TEST" onPress={model.onViewTest} />}
          {/* No pause button: a pause takes a time and a reason (/tdd pause). Resume is one press. */}
          {s.paused && <Button key="resume" label="RESUME" onPress={model.onResume} />}
        </Box>
      )}
      {/* The one line that asks a person to act. */}
      {view.pending !== null && (
        <Box flexDirection="row" gap={2}>
          <Text bold color={ACCENT.paused}>OVERRIDE ASKED</Text>
          <Text>{`${view.pending.kind} · ${view.pending.module === null ? 'every module' : moduleLabel(config, view.pending.module)}: "${view.pending.reason.trim()}"`}</Text>
          <Button key="approve" label="APPROVE" onPress={model.onApprove} />
          <Button key="deny" label="DENY" onPress={model.onDeny} />
        </Box>
      )}
    </Box>
  )
}

export function drawTestPane(el: AnyElements, model: { current: CurrentTest | null; source: string | null; label?: string }) {
  const { Box, Text, Code } = el
  const { current, source } = model

  if (current === null) {
    return <Text dimColor>NO TEST TOUCHED YET</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={ACCENT.ember}>{(model.label ?? current.module).toUpperCase()}</Text>
      {source === null
        ? <Text color={ACCENT.ember}>{`NOT FOUND: ${current.testPath}`}</Text>
        : <Code source={source} path={current.testPath} startLine={1} />}
    </Box>
  )
}
