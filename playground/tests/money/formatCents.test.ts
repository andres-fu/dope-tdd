import { expect, test } from 'vitest'
import { formatCents } from '../../src/money/formatCents'

test('formats positive amounts', () => {
  expect(formatCents(1250)).toBe('$12.50')
  expect(formatCents(5)).toBe('$0.05')
  expect(formatCents(0)).toBe('$0.00')
})

test('puts the minus sign before the dollar sign', () => {
  expect(formatCents(-1250)).toBe('-$12.50')
})

test('keeps the minus sign when the amount is under a dollar', () => {
  expect(formatCents(-50)).toBe('-$0.50')
})
