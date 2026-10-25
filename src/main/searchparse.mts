// 원격 파일 검색·바꾸기: Device의 grep으로 찾고, 바꾸기는 파일을 읽어 문자열 치환 (main·화면이 같이 씀)
export type SearchOpts = { regex: boolean; matchCase: boolean }
export type Hit = { path: string; line: number; text: string }
export const MAX_HITS = 1000
const SKIP_DIRS = ['.git', 'node_modules', 'build', 'install', 'log', '__pycache__', '.venv']

// qdir·qquery는 shq로 감싸 넘길 것. -I 바이너리 제외, -Z 경로 뒤에 \0 (경로에 ':'가 있어도 안전)
export const grepCommand = (qdir: string, qquery: string, o: SearchOpts) =>
  `timeout 30 grep -rnIZ${o.regex ? 'E' : 'F'}${o.matchCase ? '' : 'i'} ${SKIP_DIRS.map((d) => `--exclude-dir=${d}`).join(' ')} -e ${qquery} -- ${qdir} 2>/dev/null | head -n ${MAX_HITS + 1}`

export function parseGrep(out: string): { hits: Hit[]; truncated: boolean } {
  const hits: Hit[] = []
  for (const l of out.split('\n')) {
    const z = l.indexOf('\0')
    const m = z > 0 ? /^(\d+):(.*)$/s.exec(l.slice(z + 1)) : null
    if (m) hits.push({ path: l.slice(0, z), line: Number(m[1]), text: m[2].replace(/\r$/, '').slice(0, 300) })
  }
  return { hits: hits.slice(0, MAX_HITS), truncated: hits.length > MAX_HITS }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 글자 치환: 정규식이면 $1 같은 참조도 씀(JS 정규식), 아니면 바꿀 글자를 그대로. 바뀐 개수도 같이
export function replaceText(text: string, query: string, repl: string, o: SearchOpts): { text: string; count: number } {
  if (!query) throw new Error('empty query')
  const re = new RegExp(o.regex ? query : escapeRe(query), o.matchCase ? 'g' : 'gi')
  const count = (text.match(re) ?? []).length
  return { text: !count ? text : o.regex ? text.replace(re, repl) : text.replace(re, () => repl), count }
}
