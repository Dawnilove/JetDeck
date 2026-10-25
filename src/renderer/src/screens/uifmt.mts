// 화면에서 쓰는 순수 함수 (Electron·React 없이 시험): 팔레트 퍼지 검색, 파일 크기 표시, 포워딩과 같은 ssh 명령
import { tr } from '../../../main/i18n.mts'

// 퍼지 검색: 글자가 순서대로 들어 있으면 일치. 연속으로 맞을수록, 앞쪽에서 맞을수록 점수가 높음
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  const s = text.toLowerCase()
  let from = 0
  let last = -2
  let score = 0
  for (const ch of q) {
    const i = s.indexOf(ch, from)
    if (i < 0) return null
    score += (i === last + 1 ? 3 : 1) - i * 0.001
    last = i
    from = i + 1
  }
  return score
}

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`

// 같은 동작을 하는 ssh 명령 (터미널에서 직접 할 때 참고)
export function sshCommand(kind: 'L' | 'R' | 'D', lp: string, rp: string, target: string): string {
  const pc = tr('내PC포트')
  const dev = tr('Device포트')
  if (kind === 'L') return `ssh -L ${lp || pc}:localhost:${rp || dev} ${target}`
  if (kind === 'R') return `ssh -R ${rp || dev}:localhost:${lp || pc} ${target}`
  return `ssh -D ${lp || pc} ${target}`
}
