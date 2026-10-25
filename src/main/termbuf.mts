// AI가 읽을 터미널 최근 출력 보관 (4.3.0): 터미널(셸)마다 원본을 최근 MAX자까지 메모리에만 두고, 읽을 때 화면 제어 문자를 걷어 냄
const MAX = 200_000
const bufs = new Map<string, string>()

export function pushTerm(id: string, chunk: string): void {
  const s = (bufs.get(id) ?? '') + chunk
  bufs.set(id, s.length > MAX ? s.slice(-MAX) : s)
}
export const dropTerm = (id: string): void => void bufs.delete(id)
export const rawTerm = (id: string): string => bufs.get(id) ?? ''

// 색·커서 이동 같은 제어 문자를 지우고 줄바꿈 없는 \r(덮어쓰기)·백스페이스를 처리해 읽을 수 있는 글자로.
// shortcut: vim·htop 같은 전체 화면 프로그램은 화면을 다시 그린 흔적이 섞여 읽기 어려울 수 있음, 필요하면 가상 터미널로 해석
export function cleanTerm(raw: string): string {
  let s = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]|\x1b[=>78]/g, '')
    .replace(/\x07/g, '')
  while (/[^\n\x08]\x08/.test(s)) s = s.replace(/[^\n\x08]\x08/g, '')
  return s
    .split('\n')
    .map((l) => l.replace(/\r+$/, '').split('\r').pop() ?? '')
    .join('\n')
}

// 마지막 n줄 (끝의 빈 줄은 뺌)
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\n+$/, '').split('\n')
  return lines.slice(-Math.max(1, Math.min(500, Math.floor(n) || 100))).join('\n')
}
