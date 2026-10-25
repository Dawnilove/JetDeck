// 터미널 출력 검색 (4.4.0): 화면 버퍼 줄 목록에서 일치 위치를 찾음 (Electron·xterm 없이 시험)
export type Hit = { row: number; col: number; len: number }

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
export function toLog(rows: { text: string; wrapped: boolean }[]): string {
  const out: string[] = []
  for (const r of rows) {
    if (r.wrapped && out.length) out[out.length - 1] += r.text
    else out.push(r.text)
  }
  return out.map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '') + '\n'
}
