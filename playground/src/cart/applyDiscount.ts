export function applyDiscount(priceCents: number, percentOff: number): number {
  const discount = priceCents * (percentOff / 100)
  return Math.floor(priceCents - discount)
}
