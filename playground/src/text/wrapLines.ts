export function wrapLines(text: string, width: number): string[] {
  const w = text.split(' ')
  const r: string[] = []
  let c = ''
  for (let i = 0; i < w.length; i++) {
    if (c.length === 0) {
      c = w[i]
    } else if (c.length + 1 + w[i].length <= width) {
      c = c + ' ' + w[i]
    } else {
      r.push(c)
      c = w[i]
    }
  }
  if (c.length > 0) {
    r.push(c)
  }
  return r
}
