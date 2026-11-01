// 팩 시리얼 읽기 한 번의 순수 부분 (6.1.0, 설계안 §2-5·§2-7·§2-8): 받은 바이트를 줄로 모으고, 시간·바이트·속도 한도를 지키고, 끝나면 반드시 포트를 닫는다.
// 포트는 SerialSource로만 안다 (쓰기 없음). Electron·실제 포트 없이 시험 (packserial.test.mts)
import { StringDecoder } from 'node:string_decoder'
import { Batcher, LineAssembler, STREAM_LIMITS, Throttle } from './packstreamcore.mts'
import type { SerialSource } from './serialread.mts'

export type SerialChoice = { path: string; label: string; vendorId?: string; productId?: string; serialNumber?: string }
// 같은 장치인지 비교하는 값: 고른 뒤 포트 이름이 다른 장치로 바뀌면 달라진다
export const identOf = (p: SerialChoice): string => [p.path, p.vendorId ?? '', p.productId ?? '', p.serialNumber ?? ''].join('\u0000')
// 고르기 창에 보일 순서: USB(vendorId 있음)를 먼저, 최대 8개
export const PICK_MAX = 8
export function orderChoices(list: SerialChoice[]): { shown: SerialChoice[]; more: boolean } {
  const sorted = [...list].sort((a, b) => Number(!!b.vendorId) - Number(!!a.vendorId) || a.path.localeCompare(b.path))
  return { shown: sorted.slice(0, PICK_MAX), more: sorted.length > PICK_MAX }
}

export type SerialEnd = 'stopped' | 'timeout' | 'closed' | 'error' | 'rate' | 'total' | 'bytes' | 'conn' | 'pack' | 'quit'
export type SerialReadOptions = {
  source: SerialSource
  ms: number // 열어 둘 시간
  maxBytes: number // 받을 총량
  idleMs?: number // 이 시간 동안 데이터가 없으면 onIdle (한 번)
  flushMs?: number // 화면에 묶어 보내는 간격
  onLines: (lines: string[], skipped: number) => void
  onIdle: () => void
  onEnd: (why: SerialEnd, bytes: number) => void // 한 번만 불림
}
export type SerialRead = { endsAt: number; stop: (why?: SerialEnd) => void }

export function startSerialRead(o: SerialReadOptions): SerialRead {
  const dec = new StringDecoder('utf8') // 한글이 조각 경계에서 잘려도 안 깨지게
  const lines = new LineAssembler()
  const throttle = new Throttle()
  const batch = new Batcher()
  let bytes = 0
  let ended = false
  let gotData = false
  const emit = () => {
    const b = batch.take()
    if (b) o.onLines(b.lines, b.skipped)
  }
  const flush = setInterval(() => (batch.add(lines.flush()), emit()), o.flushMs ?? STREAM_LIMITS.batchMs)
  flush.unref?.()
  const limit = setTimeout(() => end('timeout'), o.ms)
  limit.unref?.()
  const idle = setTimeout(() => !gotData && !ended && o.onIdle(), o.idleMs ?? 10_000)
  idle.unref?.()

  function end(why: SerialEnd): void {
    if (ended) return
    ended = true
    clearInterval(flush)
    clearTimeout(limit)
    clearTimeout(idle)
    try {
      o.source.close()
    } catch {
      // 이미 닫힌 포트
    }
    batch.add(lines.push(dec.end()))
    batch.add(lines.flush(Date.now(), true))
    emit()
    o.onEnd(why, bytes)
  }

  o.source.onData((chunk) => {
    if (ended) return
    gotData = true
    const room = o.maxBytes - bytes
    const part = chunk.length > room ? chunk.subarray(0, Math.max(room, 0)) : chunk
    bytes += part.length
    const t = throttle.add(part.length)
    batch.add(lines.push(dec.write(part)))
    if (chunk.length > room) return end('bytes')
    if (t !== 'ok') end(t)
  })
  o.source.onEnd((why) => end(why))
  return { endsAt: Date.now() + o.ms, stop: (why = 'stopped') => end(why) }
}
