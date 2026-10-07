import type { Elements, RenderSurface } from 'claude-code'

import type { CurrentTest, Layer, TddStats } from '../types'
import { languageOf, layerOf } from './describeTest'
import { ACCENT, ALARM_TEXT, LAYER_COLOR, RED_TIMER_ALARM_MS } from './theme'
import { formatAgo, formatSpan } from './timeText'

type AnyElements = Elements[RenderSurface]

export type BandModel = {
  stats: TddStats
  nowMs: number
  modifiedMs: number | null
  logo: string | null
  onViewTest: () => unknown
  onTogglePause: () => unknown
  onReset: () => unknown
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase()
}

function drawLogo(el: AnyElements, logo: string | null) {
  if (logo !== null && 'Svg' in el) {
    const { Svg } = el
    return <Svg source={logo} alt="throughline skull" width={16} height={17} />
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
  if (s.phase === 'writing' || s.phase === 'idle') {
    return <Text bold>{`✎ WRITING${timer}`}</Text>
  }
  return openForMs !== null && openForMs >= RED_TIMER_ALARM_MS
    ? <Text bold color={ALARM_TEXT} backgroundColor={ACCENT.ember}>{` ■ RED${timer} `}</Text>
    : <Text bold color={ACCENT.ember}>{`■ RED${timer}`}</Text>
}

function drawWarningCount(el: AnyElements, count: number, label: string) {
  const { Text } = el
  return count > 0
    ? <Text bold color={ACCENT.paused}>{`${count} ${label}`}</Text>
    : <Text dimColor>{`0 ${label}`}</Text>
}

function drawLayerBadge(el: AnyElements, layer: Layer, language: string) {
  const { Text } = el
  const label = `${layer.toUpperCase()} · ${language}`
  const color = LAYER_COLOR[layer]
  return color === null ? <Text bold dimColor>{label}</Text> : <Text bold color={color}>{label}</Text>
}

function drawTestIdentity(el: AnyElements, current: CurrentTest, modifiedMs: number | null, nowMs: number) {
  const { Box, Text } = el
  const extension = extensionOf(current.testPath)
  const layer = layerOf(current.module, extension)
  const updated = modifiedMs === null ? 'FILE MISSING' : `UPDATED ${formatAgo(nowMs - modifiedMs)}`

  return (
    <Box flexDirection="row" gap={2}>
      <Text bold>{current.module.toUpperCase()}</Text>
      {drawLayerBadge(el, layer, languageOf(current.testPath))}
      <Text dimColor>{updated}</Text>
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

function drawNumbers(el: AnyElements, s: TddStats) {
  const { Box, Text } = el
  const cycles = s.cycles === 0
    ? 'CYCLES 0'
    : `CYCLES ${s.cycles} · AVG ${formatSpan(s.cycleMsTotal / s.cycles)}`
  const attempts = s.testFirst + s.blocked + s.unguarded

  return (
    <Box flexDirection="row" gap={2}>
      <Text dimColor>{cycles}</Text>
      {s.neverSawRed > 0 && drawWarningCount(el, s.neverSawRed, 'NEVER SAW RED')}
      <Text dimColor>{`TEST-FIRST ${s.testFirst}/${attempts}`}</Text>
      {drawWarningCount(el, s.blocked, 'BLOCKED')}
      {s.unguarded > 0 && drawWarningCount(el, s.unguarded, 'UNGUARDED')}
    </Box>
  )
}

export function drawBand(el: AnyElements, model: BandModel) {
  const { Box, Text, Button } = el
  const { stats: s, nowMs, modifiedMs, logo } = model

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={ACCENT.ember}
      paddingX={1}
    >
      <Box flexDirection="row" gap={2}>
        {drawLogo(el, logo)}
        <Text bold>THROUGHLINE · TDD</Text>
        {drawPhase(el, s, nowMs)}
        {drawTrail(el, s)}
      </Box>
      {s.current !== null && drawTestIdentity(el, s.current, modifiedMs, nowMs)}
      {drawNumbers(el, s)}
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
