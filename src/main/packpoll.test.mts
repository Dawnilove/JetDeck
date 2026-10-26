import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, test } from 'node:test'
import { startPoll, stopAllPolls, stopPoll, type PollConn } from './packpoll.mts'
import { LIMITS, type ChartDisplay } from './packschema.mts'

// 5.2.0 그래프 실행기: 가짜 연결·가짜 화면으로 시작·멈춤·겹침 건너뜀·간격 늘림·연속 실패·소유자 정리를 시험 (실제 SSH는 Device 실기에서)
const L = (s: string) => ({ ko: s, en: s })
const D = (every: number): ChartDisplay => ({ type: 'chart', every, points: 300, split: 'ws', series: [{ label: L('a'), col: 1, scale: 1 }, { label: L('b'), col: 2, scale: 1 }] })
class FakeWc extends EventEmitter {
  sent: [string, ...unknown[]][] = []
  destroyed = false
  send(ch: string, ...a: unknown[]) {
    this.sent.push([ch, ...a])
  }
  isDestroyed() {
    return this.destroyed
  }
  of(ch: string) {
    return this.sent.filter((x) => x[0] === ch)
  }
}
const asWc = (w: FakeWc) => w as never
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
// 고정 시간 대신 끝날 때까지 기다림 (CPU가 바쁘거나 타이머가 거칠면 고정 시간은 흔들림)
const until = async (cond: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !cond(); t += 5) await wait(5)
}
// run: 호출마다 script 함수가 출력(또는 오류)을 정함
const conn = (script: (n: number) => Promise<string> | string) => {
  const c = { calls: 0, closeCbs: new Set<() => void>(), unsubbed: 0 }
  const pc: PollConn = {
    run: async () => script(++c.calls),
    onClose: (cb) => (c.closeCbs.add(cb), () => void (c.unsubbed++, c.closeCbs.delete(cb)))
  }
  return { c, pc }
}
afterEach(() => stopAllPolls())

test('시작하면 바로 한 번 실행하고, 간격마다 점을 보냄 (시각 t·지금 간격 포함). 멈추면 더 실행하지 않음', async () => {
  const wc = new FakeWc()
  const { c, pc } = conn(() => '1.5 2\n__EXIT__0\n')
  startPoll(asWc(wc), pc, 'g1', 'pk', 'cmd', D(0.02), 10)
  await until(() => wc.of('pack:poll-data').length >= 3)
  const data = wc.of('pack:poll-data')
  assert.ok(data.length >= 3, String(data.length))
  const [, id, t, samples, every, hint] = data[0] as [string, string, number, { value: number }[], number, string | undefined]
  assert.equal(id, 'g1')
  assert.ok(Math.abs(t - Date.now()) < 1000)
  assert.deepEqual(samples.map((s) => s.value), [1.5, 2])
  assert.equal(every, 0.02)
  assert.equal(hint, undefined)
  stopPoll('g1')
  assert.deepEqual(wc.of('pack:poll-end')[0].slice(1), ['g1', 'stopped', undefined])
  const n = c.calls
  await wait(80)
  assert.equal(c.calls, n)
  assert.equal(c.unsubbed, 1) // 연결 감시 풀림
  stopPoll('g1') // 두 번 불러도 end 는 한 번
  assert.equal(wc.of('pack:poll-end').length, 1)
})

test('이전 실행이 안 끝났으면 건너뛰고, 실행이 간격의 절반을 넘으면 간격이 두 배로', async () => {
  const wc = new FakeWc()
  let running = 0
  let maxRunning = 0
  const { c, pc } = conn(async () => {
    maxRunning = Math.max(maxRunning, ++running)
    await wait(60)
    running--
    return '1 2\n__EXIT__0'
  })
  startPoll(asWc(wc), pc, 'g2', 'pk', 'cmd', D(0.02), 10)
  await wait(420)
  assert.equal(maxRunning, 1) // 겹쳐 실행하지 않음
  assert.ok(c.calls <= 7, `실행 ${c.calls}번 — 간격을 늘리지 않았다면 20번쯤`)
  const everys = wc.of('pack:poll-data').map((x) => x[4] as number)
  assert.ok(everys[everys.length - 1] > everys[0], everys.join(','))
  assert.ok(everys[everys.length - 1] <= 60)
})

test('연속 실패 5번이면 자동 정지(이유 포함), 사이에 성공하면 세기가 처음부터', async () => {
  const wc = new FakeWc()
  const seq = ['boom\n__EXIT__1', 'boom\n__EXIT__1', 'boom\n__EXIT__1', 'boom\n__EXIT__1', '1 2\n__EXIT__0'] // 4번 실패 + 성공
  const { c, pc } = conn((n) => (n <= 5 ? seq[n - 1] : 'oops: no such file\n__EXIT__2'))
  startPoll(asWc(wc), pc, 'g3', 'pk', 'cmd', D(0.01), 10)
  await until(() => wc.of('pack:poll-end').length > 0)
  assert.equal(c.calls, 10) // 성공 뒤 실패 5번에서 멈춤
  assert.deepEqual(wc.of('pack:poll-end')[0].slice(1), ['g3', 'failures', 'oops: no such file'])
  assert.equal(wc.of('pack:poll-data').length, 1) // 성공한 한 번만 점을 보냄
})

test('종료 코드 표시가 없거나(시간 초과·끊김) 오류로 거절돼도 실패로 셈', async () => {
  const wc = new FakeWc()
  const { pc } = conn((n) => (n % 2 ? 'partial output' : Promise.reject(new Error('channel closed'))))
  startPoll(asWc(wc), pc, 'g4', 'pk', 'cmd', D(0.01), 10)
  await until(() => wc.of('pack:poll-end').length > 0)
  assert.equal(wc.of('pack:poll-end')[0][2], 'failures')
  assert.equal(wc.of('pack:poll-data').length, 0)
})

test('연결이 응답 없이 멈추면 앱이 기다림을 끊고 실패로 셈 (timeout+5초 대신 짧게)', async () => {
  const wc = new FakeWc()
  const { c, pc } = conn(() => new Promise<string>(() => {})) // 영영 안 끝남
  startPoll(asWc(wc), pc, 'g5', 'pk', 'cmd', D(0.01), -4.98) // 기다림 = (-4.98+5)초 = 20ms
  await until(() => wc.of('pack:poll-end').length > 0)
  assert.equal(wc.of('pack:poll-end')[0][2], 'failures')
  assert.ok(c.calls >= 5)
})

test('읽은 숫자가 없으면 빈 점 목록과 마지막 출력 한 줄(hint)을 보냄 (실패는 아님)', async () => {
  const wc = new FakeWc()
  const { pc } = conn(() => 'nothing useful here\nsecond line\n__EXIT__0')
  startPoll(asWc(wc), pc, 'g6', 'pk', 'cmd', D(0.01), 10)
  await wait(120)
  const d = wc.of('pack:poll-data')[0]
  assert.deepEqual(d[3], [])
  assert.equal(d[5], 'second line')
  assert.equal(wc.of('pack:poll-end').length, 0) // 숫자가 없어도 5번 넘게 돌며 정지하지 않음
})

test('동시 한도: 팩당 5개·앱 10개, 같은 id 중복 거부', () => {
  const wc = new FakeWc()
  const { pc } = conn(() => new Promise<string>(() => {}))
  assert.equal(LIMITS.chartPerPack, 5) // 공식 센서 그래프 5개를 한 팩에서 함께 돌릴 수 있게
  assert.equal(LIMITS.chartPerApp, 10)
  for (let i = 1; i <= LIMITS.chartPerPack; i++) startPoll(asWc(wc), pc, `a${i}`, 'p1', 'c', D(50), 10)
  assert.throws(() => startPoll(asWc(wc), pc, 'a6', 'p1', 'c', D(50), 10), /동시에 5개/)
  assert.throws(() => startPoll(asWc(wc), pc, 'a1', 'p2', 'c', D(50), 10), /이미 실행 중/)
  for (let i = 1; i <= LIMITS.chartPerApp - LIMITS.chartPerPack; i++) startPoll(asWc(wc), pc, `b${i}`, 'p2', 'c', D(50), 10)
  assert.throws(() => startPoll(asWc(wc), pc, 'c1', 'p3', 'c', D(50), 10), /동시에 10개/)
  stopPoll('a1')
  startPoll(asWc(wc), pc, 'c1', 'p3', 'c', D(50), 10) // 자리가 나면 다시 시작됨
})

test('소유자 정리: 화면 이동·렌더러 죽음·창 닫힘이면 그 화면의 그래프가 모두 멈추고 다른 화면 것은 유지', async () => {
  const w1 = new FakeWc()
  const w2 = new FakeWc()
  const a = conn(() => '1 2\n__EXIT__0')
  const b = conn(() => '1 2\n__EXIT__0')
  startPoll(asWc(w1), a.pc, 'o1', 'pk', 'c', D(0.01), 10)
  startPoll(asWc(w1), a.pc, 'o2', 'pk', 'c', D(0.01), 10)
  startPoll(asWc(w2), b.pc, 'o3', 'pk2', 'c', D(0.01), 10)
  await wait(40)
  w1.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }) // 하위 프레임: 무시
  w1.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }) // 같은 문서: 무시
  assert.equal(w1.of('pack:poll-end').length, 0)
  w1.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  assert.deepEqual(w1.of('pack:poll-end').map((x) => x[1]).sort(), ['o1', 'o2'])
  const n = a.c.calls
  await wait(50)
  assert.equal(a.c.calls, n)
  assert.equal(w2.of('pack:poll-end').length, 0)
  assert.ok(b.c.calls > 2)
  // 렌더러가 죽거나 창이 닫히면 (닫힌 화면에는 보내지 않음)
  w2.destroyed = true
  w2.emit('destroyed')
  const m = b.c.calls
  await wait(50)
  assert.equal(b.c.calls, m)
  assert.equal(w2.of('pack:poll-end').length, 0)
  const w3 = new FakeWc()
  startPoll(asWc(w3), a.pc, 'o4', 'pk', 'c', D(0.01), 10)
  w3.emit('render-process-gone')
  assert.equal(w3.of('pack:poll-end')[0][1], 'o4')
})

test('연결이 끊기면 closed 로 멈추고, 끝난 그래프의 결과는 더 안 보냄', async () => {
  const wc = new FakeWc()
  const { c, pc } = conn(async () => {
    await wait(30)
    return '1 2\n__EXIT__0'
  })
  startPoll(asWc(wc), pc, 'k1', 'pk', 'c', D(0.5), 10)
  await wait(5)
  c.closeCbs.forEach((cb) => cb()) // 실행 중에 연결이 끊김
  assert.deepEqual(wc.of('pack:poll-end')[0].slice(1, 3), ['k1', 'closed'])
  await wait(80)
  assert.equal(wc.of('pack:poll-data').length, 0) // 기다리던 결과는 버림
  assert.equal(c.calls, 1)
})

test('stopAllPolls: 앱 종료 때 모두 정리', async () => {
  const wc = new FakeWc()
  const { pc } = conn(() => '1 2\n__EXIT__0')
  startPoll(asWc(wc), pc, 's1', 'pk', 'c', D(0.01), 10)
  startPoll(asWc(wc), pc, 's2', 'pk', 'c', D(0.01), 10)
  stopAllPolls()
  assert.equal(wc.of('pack:poll-end').length, 2)
})
