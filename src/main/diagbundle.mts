// 진단 번들 (4.4.0): 문제를 신고할 때 붙일 정보를 한 파일로. 비밀·개인 정보는 넣지 않거나 가림 (Electron 없이 시험)
// 넣는 것: 앱·OS 버전, 호스트 개수와 종류(이름·주소·사용자·키 경로 없음), AI 요청 목록(도구·상태·시간만), 최근 앱 경고·오류 줄(가려서)
import { redact } from './activitylog.mts'
import type { Act } from './activitylog.mts'

const LOG_MAX = 100
const LINE_MAX = 500 // 보여줄 줄 길이: 가린 뒤에 자름 (자르고 가리면 경계에 걸린 비밀이 안 가려짐)
const KEEP_MAX = 20_000 // 메모리에 모을 때만 거는 큰 한도 (shortcut: 이 길이에 걸친 비밀은 못 가림)
const logs: string[] = []

// 앱(main)의 console.warn/error를 최근 100줄만 메모리에 모음. 앱을 닫으면 사라짐
export function captureConsole(): void {
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      logs.push(`${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`.slice(0, KEEP_MAX))
      if (logs.length > LOG_MAX) logs.shift()
      orig(...args)
    }
  }
}
export const recentLogs = (): string[] => [...logs]

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 경로 구분자는 / \ 어느 쪽이든 맞게
// 다른 영문·숫자 사이에 낀 건 가리지 않음 ('pi'가 'api'·'EPIPE' 안에서 가려지지 않게)
const wordRe = (n: string) => new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, 'gi')
const pathRe = (p: string) => new RegExp(p.split(/[\\/]+/).map(esc).join('[\\\\/]+'), 'gi')

// 비밀(redact 규칙)에 더해 내 PC 사용자 이름·홈 경로·IP·.local 이름·MAC·저장된 기기 이름/주소/사용자를 가림
export function scrub(text: string, o: { home?: string; user?: string; names?: string[] } = {}): string {
  let s = redact(text)
  if (o.home) s = s.replace(pathRe(o.home), '~')
  for (const n of [...(o.names ?? [])].filter((x) => x && x.length >= 2).sort((a, b) => b.length - a.length)) s = s.replace(wordRe(n), '<name>')
  if (o.user && o.user.length >= 2) s = s.replace(wordRe(o.user), '<user>')
  return s
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:local|lan|home)\b/gi, '<host>')
    .replace(/\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi, '<mac>')
}

export type DiagHost = { kind?: string; auth?: string; port?: number; keepalive?: boolean; autoReconnect?: boolean; x11?: boolean; remote?: string }
export type DiagInput = {
  version: string
  versions: Record<string, string>
  platform: string
  arch: string
  osRelease: string
  lang: string
  hosts: DiagHost[]
  acts: Pick<Act, 't' | 'client' | 'tool' | 'status' | 'ms'>[]
  logs: string[]
  scrubOpts: { home?: string; user?: string; names?: string[] }
  now?: Date
}

export function buildDiag(i: DiagInput): string {
  const count = (f: (h: DiagHost) => string) => {
    const m = new Map<string, number>()
    for (const h of i.hosts) m.set(f(h), (m.get(f(h)) ?? 0) + 1)
    return [...m].map(([k, n]) => `${k} ${n}`).join(', ') || '-'
  }
  const out = [
    `JetDeck diagnostics (${(i.now ?? new Date()).toISOString()})`,
    'Names, addresses, users, key paths, passwords and file contents are NOT included. Secret-looking values and IPs in log lines are masked.',
    '',
    '## App',
    `version ${i.version} · language ${i.lang}`,
    `OS ${i.platform} ${i.arch} ${i.osRelease}`,
    ...Object.entries(i.versions).map(([k, v]) => `${k} ${v}`),
    '',
    '## Hosts',
    `total ${i.hosts.length}`,
    `kind: ${count((h) => h.kind ?? 'ssh')}`,
    `auth: ${count((h) => h.auth ?? '-')}`,
    `remote screen: ${count((h) => h.remote ?? 'none')} · X11 ${i.hosts.filter((h) => h.x11).length} · keepalive ${i.hosts.filter((h) => h.keepalive).length} · auto-reconnect ${i.hosts.filter((h) => h.autoReconnect).length}`,
    `non-default ports: ${i.hosts.filter((h) => h.port && h.port !== 22).length}`,
    '',
    `## AI requests (last ${i.acts.length}, no commands or results)`,
    ...i.acts.map((a) => `${new Date(a.t).toISOString()} ${a.client} ${a.tool} ${a.status}${a.ms == null ? '' : ` ${a.ms}ms`}`),
    '',
    `## App warnings/errors (last ${i.logs.length})`,
    ...i.logs.map((l) => scrub(l, i.scrubOpts).slice(0, LINE_MAX))
  ]
  return out.join('\n') + '\n'
}
