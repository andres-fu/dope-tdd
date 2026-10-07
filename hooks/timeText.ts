const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatAgo(elapsedMs: number): string {
  if (elapsedMs < MINUTE) {
    return 'JUST NOW'
  }
  if (elapsedMs < HOUR) {
    return `${Math.floor(elapsedMs / MINUTE)}M AGO`
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
    return `${hours}H${twoDigits(minutes)}M`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}M${twoDigits(seconds)}S` : `${minutes}M`
  }
  return `${seconds}S`
}
