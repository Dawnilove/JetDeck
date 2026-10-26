import type { WebContents } from 'electron'
import { tr } from './i18n.mts'
import { onOwnerGone, watchOwner } from './packowner.mts'
import { FailCounter, lastLine, Pacer, parseChart, readLines, splitExit, type PollEndReason, type Sample } from './packpollcore.mts'
import { hasUnsafeMark, unsafeNotice } from './packrun.mts'
import { LIMITS, type ChartDisplay } from './packschema.mts'

// 팩 그래프 되풀이 실행기 (5.2.0). main이 every초마다 읽기 명령을 한 번씩 실행해 점을 화면에 보냄. 화면은 그리기만 함.
// 명령은 매번 끝나는 모양(timeout 래퍼)이라 Device에 프로세스가 남지 않음. 멈추는 때: 사용자 · 화면이 사라짐(packowner) · 연결 끊김 · 연속 실패 5번 · 앱 종료
// 이벤트: pack:poll-data(id, t, samples, every, hint?) — hint는 읽은 숫자가 없을 때 마지막 출력 한 줄 / pack:poll-end(id, reason, detail?)
export type PollConn = {
  run: (command: string) => Promise<string> // 같은 SSH 연결에서 명령을 실행해 출력 전체를 돌려줌
  onClose: (cb: () => void) => () => void // 연결이 끊기면 cb를 부름. 돌려주는 함수로 구독을 풂
}
type Entry = { id: string; wc: Pick<WebContents, 'send' | 'isDestroyed'>; packId: string; timer?: NodeJS.Timeout; guard?: NodeJS.Timeout; running: boolean; pacer: Pacer; fails: FailCounter; unsub?: () => void; done: boolean }
const entries = new Map<string, Entry>()

function finish(e: Entry, reason: PollEndReason, detail?: string): void {
  if (e.done) return
  e.done = true
  clearTimeout(e.timer)
  clearTimeout(e.guard) // 응답 없는 실행을 기다리는 타이머도 (남기면 앱 종료가 늦어짐)
  e.unsub?.()
  entries.delete(e.id)
  if (!e.wc.isDestroyed()) e.wc.send('pack:poll-end', e.id, reason, detail)
}
export const stopPoll = (id: string): void => {
  const e = entries.get(id)
  if (e) finish(e, 'stopped')
}
export const stopPollsOwnedBy = (wc: object): void => entries.forEach((e) => e.wc === wc && finish(e, 'stopped'))
export const stopAllPolls = (): void => entries.forEach((e) => finish(e, 'stopped'))
onOwnerGone(stopPollsOwnedBy)

// command: 팩 명령을 감싼 실행 문자열(packrun.buildPoll). timeoutSec: 한 번 실행의 최대 시간 (Device의 timeout이 못 끝내는 경우를 위해 앱도 5초 더 기다리고 실패로 침)
export function startPoll(wc: Pick<WebContents, 'send' | 'isDestroyed' | 'once' | 'on'>, conn: PollConn, id: string, packId: string, command: string, d: ChartDisplay, timeoutSec: number): void {
  if (entries.has(id)) throw new Error(tr('같은 항목이 이미 실행 중이에요'))
  let perPack = 0
  for (const e of entries.values()) if (e.packId === packId) perPack++
  if (perPack >= LIMITS.chartPerPack) throw new Error(tr('이 팩은 그래프를 동시에 {0}개까지만 시작할 수 있어요', LIMITS.chartPerPack))
  if (entries.size >= LIMITS.chartPerApp) throw new Error(tr('그래프는 동시에 {0}개까지만 시작할 수 있어요', LIMITS.chartPerApp))
  watchOwner(wc)
  const e: Entry = { id, wc, packId, running: false, pacer: new Pacer(d.every), fails: new FailCounter(), done: false }
  entries.set(id, e)
  e.unsub = conn.onClose(() => finish(e, 'closed'))

  const attempt = async (): Promise<void> => {
    const t = Date.now()
    try {
      const raw = await Promise.race([conn.run(command), new Promise<never>((_r, rej) => (e.guard = setTimeout(() => rej(new Error('timeout')), (timeoutSec + 5) * 1000)))])
      if (e.done) return // 기다리는 동안 멈춤
      const { body, code } = splitExit(raw)
      if (hasUnsafeMark(body)) return finish(e, 'failures', unsafeNotice()) // 저장소 설정이 위험해서 git을 안 돌림: 되풀이해도 같으므로 바로 멈춤
      const lines = readLines(body)
      e.pacer.record(Date.now() - t)
      if (code !== 0) return fail(lastLine(lines))
      e.fails.ok()
      const samples: Sample[] = parseChart(d, lines)
      if (!e.wc.isDestroyed()) e.wc.send('pack:poll-data', id, t, samples, e.pacer.cur, samples.length ? undefined : lastLine(lines))
    } catch {
      if (!e.done) fail('')
    } finally {
      clearTimeout(e.guard)
    }
  }
  const fail = (detail: string) => {
    if (e.fails.fail()) finish(e, 'failures', detail)
  }
  // 고정 간격으로 두드림. 이전 실행이 안 끝났으면 이번은 건너뜀. 간격은 실행이 끝날 때마다 다음 두드림부터 새 값
  const tick = () => {
    if (e.done) return
    e.timer = setTimeout(tick, e.pacer.cur * 1000)
    if (e.running) return
    e.running = true
    void attempt().finally(() => (e.running = false))
  }
  tick()
}
