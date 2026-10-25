// 명령 스니펫: 이름 + 명령(여러 줄 가능). 이전 '빠른 명령'(문자열 목록)을 이어받음
export type Snippet = { name: string; cmd: string; enter: boolean } // enter=false: 마지막 줄은 입력만 하고 Enter는 누르지 않음

export const SNIPPET_DEFAULT: Snippet[] = ['claude', 'tegrastats', 'nvpmodel -q', 'df -h'].map((c) => ({ name: c, cmd: c, enter: true }))

// 저장된 값(새 형식) → 없으면 예전 빠른 명령(문자열 목록) → 없으면 기본값
export function parseSnippets(raw: string | null, legacy: string | null): Snippet[] {
  const read = (s: string | null): unknown => {
    try {
      return JSON.parse(s ?? 'null')
    } catch {
      return null
    }
  }
  const v = read(raw)
  if (Array.isArray(v))
    return v.flatMap((x) => (x && typeof x.cmd === 'string' && x.cmd.trim() ? [{ name: String(x.name ?? '').trim() || x.cmd.trim().split('\n')[0], cmd: x.cmd, enter: x.enter !== false }] : []))
  const old = read(legacy)
  if (Array.isArray(old)) return old.filter((x) => typeof x === 'string' && x.trim()).map((c) => ({ name: c, cmd: c, enter: true }))
  return SNIPPET_DEFAULT
}

// 스니펫 중 실행 전에 확인할 것 (되돌릴 수 없는 명령)
export const DANGER = /\b(sudo|reboot|shutdown|poweroff|halt|rm|mkfs|dd)\b/

// 터미널에 쓸 글자: 줄은 Enter(\r)로 이음, 마지막 줄 뒤 Enter는 enter일 때만
export const keystrokes = (s: Snippet): string => s.cmd.replace(/\r?\n/g, '\r').replace(/\r+$/, '') + (s.enter ? '\r' : '')
