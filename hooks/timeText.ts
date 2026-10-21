const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatAgo(elapsedMs: number): string {
  if (elapsedMs < MINUTE) {
    return 'JUST NOW'
  }
  if (elapsedMs < HOUR) {
    // MIN, not M: "6M AGO" read as six months (Karl's round 3, 2026-10-19).
    return `${Math.floor(elapsedMs / MINUTE)}MIN AGO`
  }
  if (elapsedMs < DAY) {
    return `${Math.floor(elapsedMs / HOUR)}H AGO`
  }
  return `${Math.floor(elapsedMs / DAY)}D AGO`
}

function twoDigits(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatSpan(spanMs: number): string {
  const totalSeconds = Math.max(0, Math.round(spanMs / SECOND))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}H${twoDigits(minutes)}MIN`
  }
  if (minutes > 0) {
    // MIN, as in formatAgo (Karl's round 4, 2026-10-20): `3M15S` named the minute M here and MIN there.
    return seconds > 0 ? `${minutes}MIN${twoDigits(seconds)}S` : `${minutes}MIN`
  }
  return `${seconds}S`
}
