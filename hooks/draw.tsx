import type { Elements, RenderSurface } from 'claude-code'

import type { CatchOutcome, CurrentTest, TddStats } from '../types'
import type { GuardConfig } from './config'
import { ACCENT, ALARM_TEXT, RED_TIMER_ALARM_MS } from './theme'
import { formatSpan } from './timeText'

type AnyElements = Elements[RenderSurface]

const TITLE = 'RED FIRST'

export type BandModel = {
  stats: TddStats
  config: GuardConfig
  nowMs: number
  logo: string | null
  onViewTest: () => unknown
  onTogglePause: () => unknown
  onReset: () => unknown
}

function drawLogo(el: AnyElements, logo: string | null) {
  if (logo !== null && 'Svg' in el) {
    const { Svg } = el
    return <Svg source={logo} alt="Red First skull" width={16} height={17} />
  }
  const { Text } = el
  return <Text bold color={ACCENT.ember}>☠</Text>
}

function drawPhase(el: AnyElements, s: TddStats, nowMs: number) {
  const { Text } = el
  if (s.paused) {
    return <Text bold color={ACCENT.paused}>⏸ PAUSED</Text>
  }
  const openForMs = s.cycleStartMs === null ? null : nowMs - s.cycleStartMs
  const timer = openForMs === null ? '' : ` ${formatSpan(openForMs)}`
  if (s.phase === 'green') {
    return <Text bold color={ACCENT.pass}>■ GREEN</Text>
  }
  if (s.phase === 'writing') {
    return <Text bold>{`✎ WRITING${timer}`}</Text>
  }
  if (s.phase === 'idle') {
    return <Text bold dimColor>IDLE</Text>
  }
  return openForMs !== null && openForMs >= RED_TIMER_ALARM_MS
    ? <Text bold color={ALARM_TEXT} backgroundColor={ACCENT.ember}>{` ■ RED${timer} `}</Text>
    : <Text bold color={ACCENT.ember}>{`■ RED${timer}`}</Text>
}

function drawCatchWord(el: AnyElements, outcome: CatchOutcome | { kind: 'refactor' }) {
  const { Text } = el
  if (outcome.kind === 'caught') {
    return <Text bold color={ACCENT.pass}>CAUGHT</Text>
  }
  if (outcome.kind === 'missed') {
    return <Text bold color={ACCENT.ember}>MISSED</Text>
  }
  if (outcome.kind === 'refactor') {
    return <Text bold color={ACCENT.pass}>REFACTOR</Text>
  }
  return <Text dimColor>UNVERIFIED</Text>
}

function drawVerdict(el: AnyElements, s: TddStats, current: CurrentTest) {
  const { Box, Text } = el
  const openCycleSawRed = s.phase !== 'green' && s.sawRed
  const closedCycle = s.phase === 'green' && s.lastCycle?.module === current.module
  const neverSawRed = s.unproven.includes(current.module)
  const catchWord = s.phase === 'green' && s.lastCatch?.module === current.module ? s.lastCatch.outcome : null

  return (
    <Box flexDirection="row" gap={2}>
      <Text bold>{current.module.toUpperCase()}</Text>
      {neverSawRed && <Text bold color={ACCENT.paused}>NEVER SAW RED</Text>}
      {!neverSawRed && (openCycleSawRed || closedCycle) && <Text dimColor>SAW RED</Text>}
      {catchWord !== null && drawCatchWord(el, catchWord)}
    </Box>
  )
}

function drawTrail(el: AnyElements, s: TddStats) {
  const { Box, Text } = el
  if (s.history.length === 0) {
    return <Text dimColor>NO RUNS YET</Text>
  }
  return (
    <Box flexDirection="row">
      {s.history.map(outcome =>
        outcome === 'pass'
          ? <Text color={ACCENT.pass}>●</Text>
          : <Text color={ACCENT.ember}>✗</Text>,
      )}
    </Box>
  )
}

function drawCount(el: AnyElements, count: number, label: string, color: string) {
  const { Text } = el
  return count > 0
    ? <Text bold color={color}>{`${count} ${label}`}</Text>
    : <Text dimColor>{`${count} ${label}`}</Text>
}

function drawTally(el: AnyElements, s: TddStats, config: GuardConfig) {
  const { Box, Text } = el
  const scoped = config.scope.length > 0
  const showMode = config.mode !== 'enforce' || scoped

  return (
    <Box flexDirection="row" gap={2}>
      <Text dimColor>{`CYCLES ${s.cycles}`}</Text>
      {drawCount(el, s.caught, 'CAUGHT', ACCENT.pass)}
      {drawCount(el, s.missed, 'MISSED', ACCENT.ember)}
      {s.refactors > 0 && drawCount(el, s.refactors, 'REFACTOR', ACCENT.pass)}
      {s.neverSawRed > 0 && drawCount(el, s.neverSawRed, 'NEVER SAW RED', ACCENT.paused)}
      {drawCount(el, s.unguarded, 'UNGUARDED', ACCENT.paused)}
      {drawCount(el, s.blocked, 'BLOCKED', ACCENT.paused)}
      {showMode && <Text bold color={ACCENT.paused}>{`MODE ${config.mode.toUpperCase()}${scoped ? ' (SCOPED)' : ''}`}</Text>}
    </Box>
  )
}

export function drawBand(el: AnyElements, model: BandModel) {
  const { Box, Text, Button } = el
  const { stats: s, config, nowMs, logo } = model

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={ACCENT.ember}
      paddingX={1}
    >
      <Box flexDirection="row" gap={2}>
        {drawLogo(el, logo)}
        <Text bold>{TITLE}</Text>
        {drawPhase(el, s, nowMs)}
        {drawTrail(el, s)}
      </Box>
      {s.current !== null && drawVerdict(el, s, s.current)}
      {drawTally(el, s, config)}
      <Box flexDirection="row" gap={1}>
        {s.current !== null && <Button key="view-test" label="VIEW TEST" onPress={model.onViewTest} />}
        <Button key="pause" label={s.paused ? 'RESUME GUARD' : 'PAUSE GUARD'} onPress={model.onTogglePause} />
        <Button key="reset" label="RESET" onPress={model.onReset} />
      </Box>
    </Box>
  )
}

export function drawTestPane(el: AnyElements, model: { current: CurrentTest | null; source: string | null }) {
  const { Box, Text, Code } = el
  const { current, source } = model

  if (current === null) {
    return <Text dimColor>NO TEST TOUCHED YET</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={ACCENT.ember}>{current.module.toUpperCase()}</Text>
      {source === null
        ? <Text color={ACCENT.ember}>{`NOT FOUND: ${current.testPath}`}</Text>
        : <Code source={source} path={current.testPath} startLine={1} />}
    </Box>
  )
}
