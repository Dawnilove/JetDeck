// 터미널 출력 검색 (4.4.0): 화면 버퍼 줄 목록에서 일치 위치를 찾음 (Electron·xterm 없이 시험)
export type Hit = { row: number; col: number; len: number }

// 버퍼 한 줄: text는 문자열, map[i]는 text[i]가 놓인 셀 열 (끝에 줄 끝 열 하나 더). 한글·이모지는 문자 수와 셀 수가 달라서 필요
export type Row = { text: string; wrapped: boolean; map: number[] }
export type Cell = { chars: string; width: number }

export function buildRow(cells: Cell[], wrapped: boolean): Row {
  const parts: { x: number; w: number; ch: string }[] = []
  cells.forEach((c, x) => {
    if (c.width > 0) parts.push({ x, w: c.width, ch: c.chars || ' ' })
  })
  while (parts.length && parts[parts.length - 1].ch === ' ') parts.pop()
  let text = ''
  const map: number[] = []
  for (const p of parts) {
    text += p.ch
    for (let k = 0; k < p.ch.length; k++) map.push(p.x)
  }
  const last = parts[parts.length - 1]
  map.push(last ? last.x + last.w : 0)
  return { text, wrapped, map }
}

// 문자열 위치 일치를 셀 열·칸 수로
export const toCells = (r: Row, h: Hit): Hit => {
  const col = r.map[h.col] ?? h.col
  return { row: h.row, col, len: Math.max(1, (r.map[h.col + h.len] ?? col + h.len) - col) }
}

// 한 줄에서 겹치지 않게 모두 찾음. 대소문자는 기본 무시
export function findAll(lines: string[], q: string, matchCase = false): Hit[] {
  if (!q) return []
  const needle = matchCase ? q : q.toLowerCase()
  const hits: Hit[] = []
  lines.forEach((line, row) => {
    const hay = matchCase ? line : line.toLowerCase()
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) hits.push({ row, col: i, len: needle.length })
  })
  return hits
}

// 줄 끝 공백을 지우고 끝의 빈 줄을 뺀 로그 글자 (줄바꿈으로 이어진 줄은 xterm이 isWrapped로 알려 주면 합침)
export function toLog(rows: Pick<Row, 'text' | 'wrapped'>[]): string {
  const out: string[] = []
  for (const r of rows) {
    if (r.wrapped && out.length) out[out.length - 1] += r.text
    else out.push(r.text)
  }
  return out.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '') + '\n'
}
