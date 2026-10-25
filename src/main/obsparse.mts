// 다른 SSH 접속 관찰 (2.7.0 3단계 B): JetDeck을 거치지 않고 따로 접속한 SSH 세션의 활동을 ps로 읽어 추정. 해석·변화 추적 (Electron 없이 시험)
import { tr } from './i18n.mts'
// 구조: sshd [priv](root) → "sshd: 사용자@notty|pts/N"(그 사용자) → 실행한 명령. 내 JetDeck 접속 아래에 있는 것은 뺌
import { procName, psRows } from './procparse.mts'

export type ObsProc = { pid: number; ppid: number; user: string; secs: number; args: string }
export type ObsCmd = { pid: number; args: string; secs: number }
export type ObsSession = { priv: number; pid: number; child: number | null; user: string; kind: 'notty' | 'pts'; secs: number; cmds: ObsCmd[] } // child: 세션의 첫 자식(쉘·명령) — 접속 주소를 그 환경 변수에서 읽음
export type ObsSnap = { me: string; ip: string; sessions: ObsSession[] }

const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'fish', '-bash', '-sh', '-zsh'])
const PRIV = /^sshd: (\S+) \[priv\]$/
const SESSION = /^sshd: (\S+?)@(notty|pts\/\d+)/

export function parseObs(out: string): ObsSnap | null {
  const me = out.match(/^__ME__=(.*)$/m)?.[1].trim() ?? ''
  const ip = out.match(/^__IP__=(.*)$/m)?.[1].trim() ?? ''
  const anc = [...out.matchAll(/^__ANC__=(\d+)$/gm)].map((m) => Number(m[1]))
  const psPart = out.split('__PS__')[1]
  if (psPart === undefined) return null
  const procs: ObsProc[] = psRows(psPart)
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const kids = new Map<number, ObsProc[]>()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  // 내 접속의 [priv]를 못 찾으면 어디까지가 내 것인지 알 수 없으므로 아무것도 보고하지 않음 (오탐 방지)
  const ours = anc.find((pid) => PRIV.test(byPid.get(pid)?.args ?? ''))
  if (ours === undefined) return { me, ip, sessions: [] }

  const sessions: ObsSession[] = []
  for (const priv of procs.filter((p) => PRIV.test(p.args) && p.pid !== ours)) {
    for (const s of kids.get(priv.pid) ?? []) {
      const m = s.args.match(SESSION)
      if (!m) continue
      sessions.push({ priv: priv.pid, pid: s.pid, child: kids.get(s.pid)?.[0]?.pid ?? null, user: m[1], kind: m[2] === 'notty' ? 'notty' : 'pts', secs: s.secs, cmds: commandsUnder(s.pid, kids) })
    }
  }
  return { me, ip, sessions }
}

// 세션 아래의 "명령": 쉘이 -c로 감싼 것은 안쪽 문장, 쉘이 아닌 프로세스는 그 자체(자식은 그 명령의 일부라 따로 안 셈). 일 없는 쉘은 무시
function commandsUnder(root: number, kids: Map<number, ObsProc[]>): ObsCmd[] {
  const cmds: ObsCmd[] = []
  const walk = (pid: number) => {
    for (const c of kids.get(pid) ?? []) {
      if (SHELLS.has(procName(c.args))) {
        const inner = c.args.match(/\s-c\s+(.+)$/)?.[1]
        if (inner) cmds.push({ pid: c.pid, args: inner, secs: c.secs })
        else walk(c.pid)
      } else cmds.push({ pid: c.pid, args: c.args, secs: c.secs })
    }
  }
  walk(root)
  return cmds
}

// 화면에 보일 이름: "다른 접속 · 명령형 · 192.168.0.5 (이 PC) · root 계정"
export function labelOf(s: Pick<ObsSession, 'kind' | 'user'>, ip: string, ourIp: string, me: string): string {
  return [tr('다른 접속'), s.kind === 'notty' ? tr('명령형') : tr('터미널형'), ip && (ip === ourIp ? tr('{0} (이 PC)', ip) : ip), s.user !== me && tr('{0} 계정', s.user)].filter(Boolean).join(' · ')
}

export type ObsEvent =
  | { type: 'conn'; phase: 'start'; session: ObsSession; t: number }
  | { type: 'conn'; phase: 'end'; pid: number; t: number }
  | { type: 'cmd'; phase: 'start'; key: string; session: ObsSession; cmd: ObsCmd; t: number }
  | { type: 'cmd'; phase: 'end'; key: string; t: number }

// 읽을 때마다 이전과 비교해 시작·끝 이벤트를 냄. 명령은 2번 연속 보이거나 이미 2초 넘게 돈 것만 (순간 프로세스가 잡음이 되지 않게)
export class Tracker {
  private conns = new Set<number>()
  private cmds = new Map<string, { since: number; seen: number; shown: boolean }>()

  update(sessions: ObsSession[], now: number): ObsEvent[] {
    const ev: ObsEvent[] = []
    const live = new Set(sessions.map((s) => s.pid))
    for (const s of sessions) if (!this.conns.has(s.pid)) (this.conns.add(s.pid), ev.push({ type: 'conn', phase: 'start', session: s, t: now - s.secs * 1000 }))
    for (const pid of [...this.conns]) if (!live.has(pid)) (this.conns.delete(pid), ev.push({ type: 'conn', phase: 'end', pid, t: now }))

    const seen = new Set<string>()
    for (const s of sessions)
      for (const c of s.cmds) {
        const key = `${s.pid}:${c.pid}:${c.args}`
        seen.add(key)
        let st = this.cmds.get(key)
        if (!st) this.cmds.set(key, (st = { since: now - c.secs * 1000, seen: 0, shown: false }))
        st.seen++
        if (!st.shown && (st.seen >= 2 || c.secs >= 2)) {
          st.shown = true
          ev.push({ type: 'cmd', phase: 'start', key, session: s, cmd: c, t: st.since })
        }
      }
    for (const [key, st] of [...this.cmds]) {
      if (seen.has(key)) continue
      this.cmds.delete(key)
      if (st.shown) ev.push({ type: 'cmd', phase: 'end', key, t: now })
    }
    return ev
  }
}
