import { app, ipcMain, type WebContents } from 'electron'
import { tr } from './i18n.mts'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Client } from 'ssh2'
import { begin, end } from './activity'
import type { Act } from './activitylog.mts'
import { redact } from './activitylog.mts'
import { run } from './monitor'
import { labelOf, parseObs, Tracker, type ObsSession } from './obsparse.mts'
import { psSnapshot } from './proc'

// 다른 SSH 접속 관찰: 연결되어 있는 동안 2초마다 ps를 읽어, 내 JetDeck 접속이 아닌 SSH 세션의 활동을 AI 활동 기록에 남김. 젯슨에는 아무것도 설치하지 않음
// shortcut: 2초 간격 ps라 그보다 짧은 명령은 놓침, 더 정확히 하려면 auditd가 필요(설치) — 필요해지면 옵션으로
const flagFile = () => join(app.getPath('userData'), 'observe.json')
let enabled = (() => {
  try {
    return JSON.parse(readFileSync(flagFile(), 'utf8')).on !== false
  } catch {
    return true // 기본 켬
  }
})()

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const TRIES = 3 // 접속 주소를 못 읽으면(다른 계정 등) 세 번 시도 후 포기
// 관찰을 끌 때 진행 중인 기록을 닫는 함수들 (연결마다 하나)
const pauses = new Set<() => void>()

export function startObserver(connId: string, hostName: string, client: Client, wc: WebContents): void {
  let tracker = new Tracker()
  const open = new Map<string, Act>() // 이벤트 키 → 진행 중인 기록 (끝날 때 닫음)
  const ips = new Map<number, string>() // [priv] pid → 접속한 PC 주소
  const tries = new Map<number, number>()
  let busy = false

  // 진행 중인 기록을 모두 닫음. 다시 켜면 지금 있는 접속부터 새로 기록하도록 추적도 처음부터
  const closeAll = (detail: string) => {
    for (const a of open.values()) end(wc, a, detail)
    open.clear()
    tracker = new Tracker()
  }

  // 세션의 첫 자식 프로세스의 환경 변수 SSH_CONNECTION에서 접속한 PC 주소를 읽음 (같은 계정만 읽힘)
  const ipOf = async (s: ObsSession) => {
    if (ips.has(s.priv)) return
    if (s.child == null) return
    const n = (tries.get(s.priv) ?? 0) + 1
    tries.set(s.priv, n)
    const out = await run(client, `tr '\\0' '\\n' < /proc/${s.child}/environ 2>/dev/null | grep '^SSH_CONNECTION=' | head -1`)
    const ip = out.trim().replace('SSH_CONNECTION=', '').split(' ')[0] ?? ''
    if (ip || n >= TRIES) ips.set(s.priv, ip)
  }

  const tick = async () => {
    if (!enabled || busy) return
    busy = true
    try {
      const snap = parseObs(await psSnapshot(client))
      if (!snap || !enabled) return
      for (const s of snap.sessions) await ipOf(s)
      const label = (s: ObsSession) => labelOf(s, ips.get(s.priv) ?? '', snap.ip, snap.me)
      for (const e of tracker.update(snap.sessions, Date.now())) {
        if (e.type === 'conn' && e.phase === 'start') {
          open.set(`c${e.session.pid}`, begin(wc, { t: e.t, client: label(e.session), connId: '', host: hostName, tool: 'external_conn', summary: tr('접속 중 (세션 PID {0})', e.session.pid) }))
        } else if (e.type === 'conn') {
          const a = open.get(`c${e.pid}`)
          if (a) (end(wc, a, ''), open.delete(`c${e.pid}`))
        } else if (e.phase === 'start') {
          open.set(e.key, begin(wc, { t: e.t, client: label(e.session), connId, host: hostName, tool: 'external', summary: cut(redact(e.cmd.args), 300) }))
        } else {
          const a = open.get(e.key)
          if (a) (end(wc, a, ''), open.delete(e.key))
        }
      }
    } catch {
      /* 연결이 끊기는 중이거나 ps 실패 — 다음 주기에 다시 */
    } finally {
      busy = false
    }
  }
  const timer = setInterval(tick, 2000)
  const pause = () => closeAll(tr('관찰을 꺼서 기록을 멈췄어요'))
  pauses.add(pause)
  client.once('close', () => {
    clearInterval(timer)
    pauses.delete(pause)
    closeAll(tr('연결이 끊겨 관찰을 멈췄어요'))
  })
}

export function registerObserveIpc(): void {
  ipcMain.handle('observe:get', () => enabled)
  ipcMain.handle('observe:set', (_e, on: boolean) => {
    enabled = on === true
    if (!enabled) pauses.forEach((p) => p()) // '실행 중'으로 남지 않게 진행 중인 기록을 닫음
    try {
      writeFileSync(flagFile(), JSON.stringify({ on: enabled }))
    } catch {
      /* 저장 실패해도 이번 실행 동안은 적용 */
    }
  })
}
