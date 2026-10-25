// AI 활동 기록 (2.7.0 3단계 A): MCP로 들어온 요청을 최근 500건까지 앱 메모리에만 보관. 비밀 가리기·요약·목록 관리 (Electron 없이 시험)
import { tr } from './i18n.mts'
export type ActStatus = 'running' | 'ok' | 'error' | 'denied'
export type Act = {
  id: number
  t: number // 시작 시각(ms)
  client: string // 어느 AI 도구가 불렀는지
  connId: string // 이 요청이 쓰는 연결(없으면 '')
  host: string // 화면에 보일 기기 이름
  tool: string
  summary: string
  status: ActStatus
  ms: number | null // 걸린 시간 (실행 중이면 null)
  detail: string // 결과 (가려진 상태, 최대 DETAIL_MAX자)
}
export const MAX = 500
export const DETAIL_MAX = 20_000

// 비밀처럼 보이는 값을 ••••로. 정규식이라 모든 비밀을 막지는 못함 (화면에도 적음)
const MASK = '••••'
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => tr('(개인 키는 가렸어요)')],
  [/\b(\w*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key)\w*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`],
  [/(--(?:password|passwd|token|secret|api-key)[= ]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`],
  [/(\bsshpass\s+-p\s*)(?:"[^"]*"|'[^']*'|\S+)/g, `$1${MASK}`],
  [/(\becho\s+)(?:"[^"]*"|'[^']*'|\S+)(\s*\|\s*sudo\s+-S\b)/g, `$1${MASK}$2`],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, `$1${MASK}`],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+(@)/g, `$1${MASK}$2`],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,})\b/g, MASK]
]
export function redact(text: string): string {
  let s = text
  for (const [re, to] of RULES) s = s.replace(re, to as string)
  return s
}
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + tr('…({0}자 생략)', s.length - n) : s)

// 목록에 보일 한 줄 요약. 파일 내용은 비밀이 들어 있을 수 있어 기록하지 않음 (경로·크기만)
export function summarize(tool: string, a: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (tool) {
    case 'run_command':
      return cut(redact(s(a.command).trim()), 300)
    case 'read_terminal':
      return tr('터미널 {0}번 · 마지막 {1}줄', s(a.terminal) || '1', s(a.lines) || '100')
    case 'read_file':
    case 'list_dir':
      return s(a.path) || '~'
    case 'write_file':
      return tr('{0} ({1}자 저장)', s(a.path), s(a.content).length)
    case 'connect':
      return s(a.host)
    default:
      return ''
  }
}
// 결과에 남길 내용: 파일 읽기 결과는 비밀이 들어 있을 수 있어 기록하지 않음
export function detailOf(tool: string, text: string): string {
  if (tool === 'read_terminal') return tr('(터미널 내용은 기록하지 않아요)')
  if (tool === 'read_file') return tr('(파일 내용은 기록하지 않아요)')
  return cut(redact(text), DETAIL_MAX)
}

// 도구 실행 결과: 화면에 보일 상태는 문장을 읽지 않고 실행한 쪽이 직접 알려 줌 (언어가 바뀌어도 판별이 깨지지 않게)
export type ToolResult = { text: string; status?: ActStatus }
// 명령의 종료 코드 → 상태 (시간 초과로 끊겨 코드가 없으면 오류)
export const exitStatus = (code: number | null | undefined): ActStatus => (code === 0 ? 'ok' : 'error')

let nextId = 1
export function startAct(list: Act[], a: Omit<Act, 'id' | 'status' | 'ms' | 'detail'>, max = MAX): Act {
  const act: Act = { ...a, id: nextId++, status: 'running', ms: null, detail: '' }
  list.push(act)
  if (list.length > max) list.splice(0, list.length - max)
  return act
}
export function finishAct(act: Act, status: ActStatus, detail: string, now: number): void {
  act.status = status
  act.ms = Math.max(0, now - act.t)
  act.detail = detail
}
