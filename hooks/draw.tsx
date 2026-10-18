import type { Elements, RenderSurface } from 'claude-code'

import type { CurrentTest, Override, TddStats } from '../types'
import { bandView } from './bandModel.ts'
import type { Problem, Step, Watch } from './bandModel.ts'
import type { GuardConfig } from './config.ts'
import { moduleLabel } from './mirror.ts'
import { ACCENT, ALARM_TEXT, RED_TIMER_ALARM_MS } from './theme.ts'
import { formatSpan } from './timeText.ts'

type AnyElements = Elements[RenderSurface]

const TITLE = 'DOPE TDD'

export type BandModel = {
  stats: TddStats
  config: GuardConfig
  nowMs: number
  logo: string | null
  /** The git operation the guard stands down for, or '' when it is on. */
  standingDown: string
  /** The repo's override record: a waiting request, and the current module's open override, show on the band. */
  overrides: readonly Override[]
  onViewTest: () => unknown
  onApprove: () => unknown
  onDeny: () => unknown
  onResume: () => unknown
  /** Ends the open override on a module, or `pause`. */
  onEnd: (target: string) => unknown
  onReset: () => unknown
}

function drawLogo(el: AnyElements, logo: string | null) {
  if (logo !== null && 'Svg' in el) {
    const { Svg } = el
    return <Svg source={logo} alt="Dope TDD skull" width={16} height={17} />
  }
  const { Text } = el
  return <Text bold color={ACCENT.ember}>☠</Text>
}

function drawPhase(el: AnyElements, s: TddStats, nowMs: number, standingDown: string) {
  const { Text } = el
  if (standingDown !== '') {
    return <Text bold color={ACCENT.paused}>{`⏸ GIT ${standingDown.toUpperCase()}`}</Text>
  }
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

/** The first thing the band says: whether dope-tdd can see the code and read the runs at all (bandModel.ts). */
function drawWatch(el: AnyElements, watch: Watch) {
  const { Text } = el
  if (watch.kind === 'watching') {
    return <Text color={ACCENT.pass}>{`● WATCHING ${watch.where}`}</Text>
  }
  if (watch.kind === 'not-watching') {
    const files = `${watch.files} edited code file${watch.files === 1 ? ' matches' : 's match'} no test layout: ${watch.example}${watch.files > 1 ? ` +${watch.files - 1}` : ''}`
    return [<Text bold color={ACCENT.paused}>⚠ NOT WATCHING</Text>, <Text>{files}</Text>]
  }
  return <Text bold color={ACCENT.paused}>⚠ CAN'T READ RUNS</Text>
}

function drawStep(el: AnyElements, step: Step) {
  const { Text } = el
  if (step.state === 'failed') {
    return <Text bold color={step.word === 'MISSED' ? ACCENT.ember : ACCENT.paused}>{step.word ?? `${step.name} ✗`}</Text>
  }
  if (step.state === 'done') {
    // Red seen by the catch check, not by hand: done, but said quietly, so it reads as evidence and not as credit.
    if (step.name === 'red' && step.word !== undefined) {
      return <Text color={ACCENT.pass}>{`red ✓ ${step.word.toLowerCase()}`}</Text>
    }
    return step.word === undefined ? <Text color={ACCENT.pass}>{`${step.name} ✓`}</Text> : <Text bold color={ACCENT.pass}>{step.word}</Text>
  }
  // REFACTOR and UNVERIFIED are facts about the change, not credit: plain, never the pass colour.
  return step.word === undefined ? <Text dimColor>{`${step.name} ·`}</Text> : <Text bold>{step.word}</Text>
}

function drawChain(el: AnyElements, s: TddStats, chain: readonly Step[], label: string) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" gap={2}>
      <Text bold>{label.toUpperCase()}</Text>
      {chain.map(step => drawStep(el, step))}
      {s.redElsewhere.length > 0 && <Text dimColor>RED ELSEWHERE</Text>}
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

/** Only problems above zero: a row of zeros read as "all good" even when dope-tdd could see nothing. */
function drawProblems(el: AnyElements, problems: readonly Problem[]) {
  const { Box, Text } = el
  return (
    <Box flexDirection="row" gap={2}>
      {problems.map(problem => <Text bold color={problem.tone === 'alarm' ? ACCENT.ember : ACCENT.paused}>{problem.label}</Text>)}
    </Box>
  )
}

export function drawBand(el: AnyElements, model: BandModel) {
  const { Box, Text, Button } = el
  const { stats: s, config, nowMs, logo } = model
  const view = bandView(s, config, model.overrides, nowMs)
  const watching = view.watch.kind === 'watching'
  const progress = view.showProgress

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
        {drawWatch(el, view.watch)}
        {(progress || s.paused || model.standingDown !== '') && drawPhase(el, s, nowMs, model.standingDown)}
        {progress && drawTrail(el, s)}
      </Box>
      {watching && s.current !== null && view.chain !== null && drawChain(el, s, view.chain, moduleLabel(config, s.current.module))}
      {/* Every open door gets a sign, whichever module is current, and a way to close it (live trial, 2026-10-18). */}
      {view.open.map(door => (
        <Box flexDirection="row" gap={2}>
          <Text bold color={ACCENT.paused}>OVERRIDE OPEN</Text>
          <Text>{door.text}</Text>
          <Button key={`end-${door.target}`} label="END" onPress={() => model.onEnd(door.target)} />
        </Box>
      ))}
      {view.pending !== null && (
        <Box flexDirection="row" gap={2}>
          <Text bold color={ACCENT.paused}>OVERRIDE REQUESTED</Text>
          <Text>{`${view.pending.kind} · ${view.pending.module === null ? 'every module' : moduleLabel(config, view.pending.module)}: "${view.pending.reason.trim()}"`}</Text>
        </Box>
      )}
      {view.problems.length > 0 && drawProblems(el, view.problems)}
      <Box flexDirection="row" gap={2}>
        <Text dimColor>NEXT</Text>
        <Text>{view.next}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        {s.current !== null && <Button key="view-test" label="VIEW TEST" onPress={model.onViewTest} />}
        {view.pending !== null && <Button key="approve" label="APPROVE" onPress={model.onApprove} />}
        {view.pending !== null && <Button key="deny" label="DENY" onPress={model.onDeny} />}
        {/* No pause button: a pause takes a time and a reason (/tdd pause). Resume is one press. */}
        {s.paused && <Button key="resume" label="RESUME" onPress={model.onResume} />}
        <Button key="reset" label="RESET" onPress={model.onReset} />
      </Box>
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
