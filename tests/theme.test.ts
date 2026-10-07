import { describe, expect, test } from 'claude-code/testing'

import { ACCENT, LAYER_COLOR } from '../hooks/theme'

const DARK_SURFACE = '#1F1E1D'
const LIGHT_SURFACE = '#FFFFFF'

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('accent colors', () => {
  test('every accent reads at 3:1 on both a dark and a light app background', () => {
    const accents = [...Object.values(ACCENT), ...Object.values(LAYER_COLOR).filter((c): c is NonNullable<typeof c> => c !== null)]
    for (const color of accents) {
      expect(contrast(color, DARK_SURFACE), `${color} on dark`).toBeGreaterThanOrEqual(3)
      expect(contrast(color, LIGHT_SURFACE), `${color} on light`).toBeGreaterThanOrEqual(3)
    }
  })
})
