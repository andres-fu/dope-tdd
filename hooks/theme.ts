export const ACCENT = {
  ember: '#D4581A',
  pass: '#4E9A52',
  paused: '#C08A16',
  clay: '#CF6E5E',
  slate: '#5A87C2',
} as const

export const ALARM_TEXT = '#FBF9F5'

export const LAYER_COLOR = {
  frontend: ACCENT.clay,
  backend: ACCENT.slate,
  logic: null,
} as const

export const RED_TIMER_ALARM_MS = 10 * 60_000
