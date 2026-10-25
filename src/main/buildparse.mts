// 빌드 도구: colcon·catkin_make 명령 만들기와 출력 줄 읽기 (오류 줄에서 파일·줄 번호 뽑기)
export type BuildKind = 'colcon' | 'catkin'
export type BuildOpts = { symlink: boolean; packages: string }

export const isPackages = (s: string) => /^[\w.\- ]*$/.test(s) // colcon --packages-select 뒤에 공백으로 나눠 붙임
export const isBuildDir = (s: string) => s.startsWith('/') && !/[\0\n\r]/.test(s)

// qdir은 shq로 감싸 넘길 것. 끝에 종료 코드를 한 줄 찍어 화면이 성공·실패를 앎
export function buildCommand(kind: BuildKind, qdir: string, o: BuildOpts): string {
  const pkgs = o.packages.trim().split(/\s+/).filter(Boolean)
  const build = kind === 'catkin' ? 'catkin_make' : `colcon build${o.symlink ? ' --symlink-install' : ''}${pkgs.length ? ` --packages-select ${pkgs.join(' ')}` : ''}`
  return `cd ${qdir} && ${build}; echo "${EXIT_MARK}$?"`
}
export const rosdepCommand = (qdir: string) => `cd ${qdir} && rosdep install --from-paths src --ignore-src -r -y`
// 워크스페이스 후보: package.xml이 든 src 폴더의 부모 (홈 아래 4단계까지)
export const WS_CMD =
  `find ~ -maxdepth 4 \\( -name '.*' -o -name node_modules -o -name build -o -name install -o -name log -o -name devel \\) -prune -o -type d -name src -print 2>/dev/null | head -100 | while IFS= read -r d; do [ -n "$(find "$d" -maxdepth 3 -name package.xml -print -quit 2>/dev/null)" ] && dirname "$d"; done`

export const EXIT_MARK = '__JD_EXIT__'
export type Line = { text: string; sev: 'error' | 'warning' | 'plain'; path?: string; line?: number; exit?: number }

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
// 절대·상대 경로:줄(:열) — 확장자가 있고 '/'가 하나 이상 든 것만 (URL·시각 같은 오탐을 줄임)
const LOC = /(?:^|[\s(\[])((?:\.{0,2}\/)?[\w@.+-]+(?:\/[\w@.+-]+)+\.\w+):(\d+)(?::\d+)?/
const PYTB = /File "([^"]+)", line (\d+)/

const normalize = (cwd: string, p: string) => {
  const out: string[] = []
  for (const seg of (p.startsWith('/') ? p : `${cwd}/${p}`).split('/')) {
    if (seg === '..') out.pop()
    else if (seg && seg !== '.') out.push(seg)
  }
  return '/' + out.join('/')
}

// cwd = 빌드한 워크스페이스 (상대 경로를 풀 때 기준)
export function parseLine(raw: string, cwd: string): Line {
  const text = raw.replace(ANSI, '').replace(/\r/g, '')
  const ex = text.startsWith(EXIT_MARK) ? Number(text.slice(EXIT_MARK.length)) : NaN
  if (!Number.isNaN(ex)) return { text, sev: 'plain', exit: ex }
  const m = LOC.exec(text) ?? PYTB.exec(text)
  const sev = /\b(fatal error|error)\b|^Failed\b|\bFAILED\b|command not found/i.test(text) ? 'error' : /\bwarning\b/i.test(text) ? 'warning' : 'plain'
  // 경로가 보이는 줄에서 ':숫자'는 줄 번호, PYTB는 (경로, 줄) 순서가 같음
  return m ? { text, sev, path: normalize(cwd, m[1]), line: Number(m[2]) } : { text, sev }
}
