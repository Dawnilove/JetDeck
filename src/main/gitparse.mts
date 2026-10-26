// Git 상태: Device의 git CLI 출력(porcelain v1, -z)을 읽어 브랜치·변경 파일 표로 만듦
export type GitCode = 'M' | 'A' | 'D' | 'U' | '!' // 수정·추가(스테이지)·삭제·새 파일(추적 안 됨)·충돌
export type GitInfo = { top: string; branch: string; ahead: number; behind: number; files: Record<string, GitCode> } // files: 절대 경로 → 상태

const codeOf = (xy: string): GitCode => {
  if (xy === '??') return 'U'
  if (/U/.test(xy) || xy === 'AA' || xy === 'DD') return '!'
  if (xy.includes('D')) return 'D'
  if (xy[0] === 'A') return 'A'
  return 'M'
}

export function parseGit(out: string): GitInfo | null {
  const nl = out.indexOf('\n')
  if (!out.startsWith('TOP=') || nl < 0) return null
  const top = out.slice(4, nl)
  const info: GitInfo = { top, branch: '', ahead: 0, behind: 0, files: {} }
  for (const e of out.slice(nl + 1).split('\0')) {
    if (e.startsWith('## ')) {
      const m = /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.\S+)?(?: \[(.*)\])?$/.exec(e)
      info.branch = m?.[1] === 'HEAD (no branch)' ? 'HEAD' : (m?.[1] ?? '')
      info.ahead = Number(/ahead (\d+)/.exec(m?.[2] ?? '')?.[1] ?? 0)
      info.behind = Number(/behind (\d+)/.exec(m?.[2] ?? '')?.[1] ?? 0)
    } else if (e.length > 3 && e[2] === ' ') info.files[(top === '/' ? '' : top) + '/' + e.slice(3)] = codeOf(e.slice(0, 2))
  }
  return info
}

// 폴더 아래에 바뀐 파일이 있는지 (탐색기 폴더 표시용)
export const dirChanged = (info: GitInfo, dir: string) => Object.keys(info.files).some((p) => p.startsWith(dir + '/'))
