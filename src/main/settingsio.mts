// 설정 내보내기·가져오기 (4.3.0): 호스트 목록·스니펫·테마를 JSON 파일 하나로. 비밀번호는 넣지 않고(키 파일은 경로만),
// 스니펫 안의 비밀처럼 보이는 값은 AI 활동 기록과 같은 규칙(redact)으로 가림. Electron 없이 시험
import { redact } from './activitylog.mts'
import { tr } from './i18n.mts'

export type Snip = { name: string; cmd: string; enter: boolean }
export type SettingsFile = { app: 'JetDeck'; format: 1; version: string; exportedAt: string; hosts: Record<string, unknown>[]; snippets: Snip[]; theme: string }

const MAX_HOSTS = 200
const MAX_SNIPS = 200

// 화면·MCP용 호스트 정보에서 이 PC·Device에 묶인 값(id·MAC·비밀번호 여부)을 뺌
export const exportHost = (h: Record<string, unknown>): Record<string, unknown> => {
  const { id: _i, hasPassword: _p, wake: _w, passwordEnc: _e, ...rest } = h
  return rest
}

export function buildExport(o: { hosts: Record<string, unknown>[]; snippets: Snip[]; theme: string; version: string; now?: Date }): { text: string; masked: number } {
  let masked = 0
  const snippets = o.snippets.map((s) => {
    const cmd = redact(s.cmd)
    if (cmd !== s.cmd) masked++
    return { name: redact(s.name), cmd, enter: s.enter !== false }
  })
  const file: SettingsFile = { app: 'JetDeck', format: 1, version: o.version, exportedAt: (o.now ?? new Date()).toISOString(), hosts: o.hosts.map(exportHost), snippets, theme: o.theme }
  return { text: JSON.stringify(file, null, 2), masked }
}

// 파일 내용은 믿지 않고 모양만 검사해서 돌려줌 (호스트 각각의 세부 검사는 store.clean이 함)
export function parseImport(text: string): { hosts: Record<string, unknown>[]; snippets: Snip[]; theme: string } {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error(tr('JetDeck 설정 파일이 아니에요 (JSON을 읽을 수 없어요)'))
  }
  const o = v as Partial<SettingsFile> | null
  if (!o || typeof o !== 'object' || o.app !== 'JetDeck' || o.format !== 1) throw new Error(tr('JetDeck 설정 파일이 아니에요'))
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  const hosts = (Array.isArray(o.hosts) ? o.hosts : []).filter(isObj).slice(0, MAX_HOSTS)
  const snippets = (Array.isArray(o.snippets) ? o.snippets : [])
    .flatMap((s: unknown) => (isObj(s) && typeof s.cmd === 'string' && s.cmd.trim() && s.cmd.length <= 20_000 ? [{ name: String(s.name ?? '').slice(0, 100) || s.cmd.trim().split('\n')[0].slice(0, 100), cmd: s.cmd, enter: s.enter !== false }] : []))
    .slice(0, MAX_SNIPS)
  const theme = typeof o.theme === 'string' && /^[\w.-]{1,64}$/.test(o.theme) ? o.theme : ''
  return { hosts, snippets, theme }
}

// 같은 기기인지 보는 열쇠: SSH는 주소·포트·사용자, 시리얼은 포트 이름
export const hostKey = (h: { kind?: string; host?: string; port?: number; username?: string; serialPath?: string }): string =>
  h.kind === 'serial' ? `serial:${(h.serialPath ?? '').toLowerCase()}` : `ssh:${(h.host ?? '').toLowerCase()}:${h.port}:${h.username}`

// 내보낼 때 가려진 명령인지 (가려진 것으로 덮어쓰면 원래 명령을 잃음)
const isMasked = (cmd: string) => cmd.includes('••••') || cmd.includes('(개인 키는 가렸어요)') || cmd.includes(tr('(개인 키는 가렸어요)'))

// overwrite: 이름이 같고 명령이 다른 스니펫은 가져온 것으로 바꿈 (기본은 새 것만 추가). 가려진 명령은 덮어쓰지 않고 kept로 셈.
// 같은 이름이 여럿이어도 가져오기 전 목록의 서로 다른 항목에 하나씩만 맞춤
export const mergeSnippets = (cur: Snip[], inc: Snip[], overwrite = false): { list: Snip[]; added: number; updated: number; kept: number } => {
  const list = [...cur]
  const used = new Set<number>()
  let added = 0
  let updated = 0
  let kept = 0
  for (const s of inc) {
    if (cur.some((c) => c.name === s.name && c.cmd === s.cmd)) continue
    const i = overwrite ? cur.findIndex((c, k) => c.name === s.name && !used.has(k)) : -1
    if (i >= 0 && isMasked(s.cmd)) (used.add(i), kept++)
    else if (i >= 0) (used.add(i), (list[i] = s), updated++)
    else (list.push(s), added++)
  }
  return { list, added, updated, kept }
}
