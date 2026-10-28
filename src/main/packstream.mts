import type { WebContents } from 'electron'
import type { Client, ClientChannel } from 'ssh2'
import { StringDecoder } from 'string_decoder'
import { tr } from './i18n.mts'
import { LiveSet } from './liveset.mts'
import { onOwnerGone, watchOwner } from './packowner.mts'
import { unsafeLines } from './packrun.mts'
import { Batcher, LineAssembler, STREAM_LIMITS, Throttle, type EndReason } from './packstreamcore.mts'

// 팩 흐르는 출력 실행기 (5.1.0). 내장 ROS·빌드·서비스 화면이 쓰는 ptystream.ts는 건드리지 않고 LiveSet만 같이 씀.
// 끝내는 순서: ① pty에 Ctrl-C(SIGINT) ② 3초 안에 안 끝나면 채널 닫기(SIGHUP) — 둘 다 pty의 앞면 프로세스 그룹에 가서 파이프라인 전체가 끝남.
// 화면이 사라지거나(닫기·새로고침·이동)·앱이 끝나면 그 화면이 시작한 스트림을 모두 끝냄. 연결이 끊기면 채널이 저절로 닫힘
type Entry = { id: string; wc: Pick<WebContents, 'send' | 'isDestroyed'>; packId: string; graceMs?: number; ch?: ClientChannel; reason?: EndReason; exit?: number; timer?: NodeJS.Timeout; kill?: NodeJS.Timeout; done: boolean }
const entries = new Map<string, Entry>()
const live = new LiveSet<ClientChannel>()

const finish = (e: Entry, reason: EndReason, code?: number) => {
  if (e.done) return
  e.done = true
  clearTimeout(e.timer)
  clearTimeout(e.kill)
  entries.delete(e.id)
  if (!e.wc.isDestroyed()) e.wc.send('pack:stream-end', e.id, reason, code)
}

// 끝내기 요청: 이유를 기록하고 Ctrl-C → 유예 뒤 채널 닫기
export function stopStream(id: string, reason: EndReason = 'stopped'): void {
  const e = entries.get(id)
  if (!e || e.done) return live.stop(id)
  e.reason ??= reason
  if (!e.ch) return live.stop(id) // 아직 열리는 중이면 열리자마자 닫음
  try {
    e.ch.write('\x03')
  } catch {
    /* 채널이 이미 닫힘 */
  }
  e.kill ??= setTimeout(() => live.stop(id), e.graceMs ?? STREAM_LIMITS.stopGraceMs) // 항목의 stopGrace(5.4.0)가 있으면 그 시간, 없으면 기본 3초
}
// 시험용: 정리가 끝났는지(남은 스트림이 없는지) 확인
export const activeCount = () => entries.size
export const stopOwnedBy = (wc: object) => entries.forEach((e) => e.wc === wc && stopStream(e.id))
export function stopAll(): void {
  for (const e of entries.values()) {
    e.reason ??= 'stopped'
    live.stop(e.id) // 앱이 끝나는 중이라 유예 없이 바로 닫음
  }
}

// 화면(webContents)이 사라지거나 새로 불러와지면 그 화면의 스트림을 모두 끝냄 (Device에 프로세스가 남지 않게). 추적은 packowner가 함
onOwnerGone(stopOwnedBy)

// c: 이 연결의 SSH 클라이언트 (호출하는 쪽이 session에서 찾아 넘김 → 이 모듈은 Electron 없이 시험할 수 있음)
export function startStream(wc: Pick<WebContents, 'send' | 'isDestroyed' | 'once' | 'on'>, c: Pick<Client, 'exec'>, id: string, packId: string, command: string, timeoutSec: number, graceSec?: number): Promise<void> {
  if (entries.has(id)) throw new Error(tr('같은 항목이 이미 실행 중이에요'))
  let perPack = 0
  for (const e of entries.values()) if (e.packId === packId) perPack++
  if (perPack >= STREAM_LIMITS.perPack) throw new Error(tr('이 팩은 실시간 보기를 동시에 {0}개까지만 할 수 있어요', STREAM_LIMITS.perPack))
  if (entries.size >= STREAM_LIMITS.perApp) throw new Error(tr('실시간 보기는 동시에 {0}개까지만 할 수 있어요', STREAM_LIMITS.perApp))
  watchOwner(wc)
  const e: Entry = { id, wc, packId, graceMs: graceSec === undefined ? undefined : graceSec * 1000, done: false }
  entries.set(id, e)
  live.begin(id)
  return new Promise<void>((resolve, reject) =>
    c.exec(command, { pty: { cols: 200, rows: 50, term: 'dumb' } }, (err, ch) => {
      if (err) {
        live.fail(id)
        entries.delete(id)
        return reject(err)
      }
      ch.on('error', () => {})
      if (!live.attach(id, ch)) {
        finish(e, 'stopped') // 열리기 전에 멈춤 요청이 와서 바로 닫음
        return resolve()
      }
      e.ch = ch
      const dec = new StringDecoder('utf8')
      const lines = new LineAssembler()
      const throttle = new Throttle()
      const batch = new Batcher()
      const flush = () => {
        const b = batch.take()
        if (b && !wc.isDestroyed()) wc.send('pack:stream-data', id, b.lines, b.skipped)
      }
      const tick = setInterval(() => {
        batch.add(lines.flush())
        flush()
      }, STREAM_LIMITS.batchMs)
      e.timer = setTimeout(() => stopStream(id, 'timeout'), timeoutSec * 1000)
      ch.on('data', (d: Buffer) => {
        if (e.reason) return // 끝내는 중에는 더 보여 주지 않음
        const v = throttle.add(d.length)
        if (v !== 'ok') return stopStream(id, v)
        batch.add(unsafeLines(lines.push(dec.write(d))))
      })
      ch.on('exit', (code: number | null) => {
        if (typeof code === 'number') e.exit = code
      })
      ch.on('close', () => {
        clearInterval(tick)
        batch.add(unsafeLines(lines.push(dec.end())))
        batch.add(lines.flush(Date.now(), true))
        flush()
        live.remove(id, ch)
        finish(e, e.reason ?? (e.exit === undefined ? 'closed' : 'exit'), e.exit)
      })
      resolve()
    })
  ).catch((err) => {
    live.fail(id)
    entries.delete(id)
    throw err
  })
}
