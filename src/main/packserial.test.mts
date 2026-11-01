import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identOf, orderChoices, PICK_MAX, startSerialRead, type SerialChoice, type SerialEnd } from './packserial.mts'
import type { SerialSource } from './serialread.mts'

// 6.1.0 시리얼 읽기 세션 시험 (설계안 §6 T11~T14). 가짜 소스가 위협 입력을 넣는다
function fakeSource() {
  let data: (b: Buffer) => void = () => {}
  let end: (w: 'closed' | 'error') => void = () => {}
  const s = { closed: 0 }
  const src: SerialSource = { onData: (cb) => (data = cb), onEnd: (cb) => (end = cb), close: () => void s.closed++ }
  return { src, s, push: (b: Buffer | string) => data(Buffer.from(b)), end: (w: 'closed' | 'error') => end(w) }
}
function start(over: Partial<Parameters<typeof startSerialRead>[0]> = {}) {
  const f = fakeSource()
  const lines: string[] = []
  const ends: [SerialEnd, number][] = []
  let idle = 0
  const r = startSerialRead({ source: f.src, ms: 60_000, maxBytes: 1_000_000, idleMs: 60_000, flushMs: 5, onLines: (l) => lines.push(...l), onIdle: () => idle++, onEnd: (w, b) => ends.push([w, b]), ...over })
  return { f, r, lines, ends, idle: () => idle }
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

test('줄 모으기: 조각 경계·\\r\\n·한글이 잘려도 깨지지 않는다', async () => {
  const t = start()
  const han = Buffer.from('가나\n')
  t.f.push('a\r')
  t.f.push('\nb')
  t.f.push(han.subarray(0, 2)) // 한글 한 글자 중간에서 끊김
  t.f.push(han.subarray(2))
  await wait()
  t.r.stop()
  assert.deepEqual(t.lines, ['a', 'b가나'])
})

test('T11 위협 출력: ANSI·BiDi·제어 문자·깨진 UTF-8·비밀이 정리된다', async () => {
  const t = start()
  t.f.push('\u001b[31m빨강\u001b[0m\n')
  t.f.push('abc‮def\u0000ghi\n')
  t.f.push(Buffer.from([0xff, 0xfe, 0x41, 0x0a]))
  t.f.push('API_TOKEN=abcdef123456\n')
  t.f.push('\u001b]0;가짜 제목\u0007제목 뒤\n')
  await wait()
  t.r.stop()
  const all = t.lines.join('\n')
  assert.doesNotMatch(all, /\u001b|‮|\u0000/)
  assert.match(all, /빨강/)
  assert.match(all, /abcdefghi/)
  assert.doesNotMatch(all, /abcdef123456/)
  assert.doesNotMatch(all, /가짜 제목/)
  assert.ok(t.lines.some((l) => l.endsWith('A'))) // 깨진 바이트 뒤 글자는 살아 있음
})

test('T11 줄바꿈 없는 긴 글자는 한 줄 길이에서 잘린다', async () => {
  const t = start()
  t.f.push('x'.repeat(10_000))
  await wait()
  t.r.stop()
  assert.ok(t.lines.every((l) => l.length <= 2001), String(t.lines.map((l) => l.length)))
})

test('T12 바이트 상한: 상한까지만 받고 포트를 닫는다', async () => {
  const t = start({ maxBytes: 10 })
  t.f.push('0123456789ABCDEF\n')
  await wait()
  assert.deepEqual(t.ends, [['bytes', 10]])
  assert.equal(t.f.s.closed, 1)
  assert.match(t.lines.join(''), /0123456789/)
  assert.doesNotMatch(t.lines.join(''), /ABCDEF/)
  t.f.push('late') // 끝난 뒤 온 데이터는 무시
  assert.equal(t.ends.length, 1)
})

test('T12 속도 상한: 5초 평균 1MB/s를 넘으면 정지', async () => {
  const t = start({ maxBytes: 20 * 1024 * 1024 })
  t.f.push(Buffer.alloc(6 * 1024 * 1024, 0x61))
  await wait()
  assert.equal(t.ends[0][0], 'rate')
  assert.equal(t.f.s.closed, 1)
})

test('T12 시간 상한: 시간이 끝나면 timeout으로 닫는다', async () => {
  const t = start({ ms: 20 })
  await wait(60)
  assert.deepEqual(t.ends.map((e) => e[0]), ['timeout'])
  assert.equal(t.f.s.closed, 1)
})

test('T13 데이터가 없으면 한 번만 안내하고 포트는 열어 둔다 / 데이터가 오면 안내 없음', async () => {
  const quiet = start({ idleMs: 15 })
  await wait(50)
  assert.equal(quiet.idle(), 1)
  assert.equal(quiet.f.s.closed, 0)
  quiet.r.stop()
  const busy = start({ idleMs: 30 })
  busy.f.push('x\n')
  await wait(60)
  assert.equal(busy.idle(), 0)
  busy.r.stop()
})

test('T14 끝나는 길마다 닫기는 정확히 한 번, onEnd도 한 번', async () => {
  for (const how of ['stop', 'twice', 'usb', 'error', 'why'] as const) {
    const t = start()
    t.f.push('남은 줄')
    if (how === 'stop') t.r.stop()
    if (how === 'twice') (t.r.stop(), t.r.stop('quit'))
    if (how === 'usb') (t.f.end('closed'), t.f.end('closed'))
    if (how === 'error') (t.f.end('error'), t.f.end('closed'))
    if (how === 'why') t.r.stop('conn')
    assert.equal(t.f.s.closed, 1, how)
    assert.equal(t.ends.length, 1, how)
    assert.deepEqual(t.lines, ['남은 줄'], how) // 줄바꿈 없는 마지막 조각도 끝날 때 내보냄
  }
  const a = start()
  a.f.end('error')
  assert.equal(a.ends[0][0], 'error')
  const b = start()
  b.r.stop('conn')
  assert.equal(b.ends[0][0], 'conn')
})

test('포트 고르기 순서: USB 먼저, 최대 8개, 더 있으면 표시', () => {
  const mk = (path: string, usb: boolean): SerialChoice => ({ path, label: path, ...(usb ? { vendorId: '2341', productId: '0043' } : {}) })
  const r = orderChoices([mk('COM1', false), mk('COM7', true), mk('COM2', false), mk('COM3', true)])
  assert.deepEqual(r.shown.map((c) => c.path), ['COM3', 'COM7', 'COM1', 'COM2'])
  assert.equal(r.more, false)
  const many = orderChoices(Array.from({ length: 12 }, (_, i) => mk(`COM${i + 10}`, false)))
  assert.equal(many.shown.length, PICK_MAX)
  assert.equal(many.more, true)
})

test('identOf: 경로·VID·PID·시리얼 번호 중 하나라도 다르면 다른 장치', () => {
  const a: SerialChoice = { path: 'COM5', label: 'x', vendorId: '2341', productId: '0043', serialNumber: 'S1' }
  assert.equal(identOf(a), identOf({ ...a, label: '다른 이름' })) // 이름(label)은 비교하지 않음
  for (const b of [{ path: 'COM6' }, { vendorId: '1' }, { productId: '1' }, { serialNumber: 'S2' }, { serialNumber: undefined }]) assert.notEqual(identOf(a), identOf({ ...a, ...b }))
})
