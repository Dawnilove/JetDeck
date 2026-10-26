import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { activeCount, startStream, stopAll, stopOwnedBy, stopStream } from './packstream.mts'
import { UNSAFE_MARK, unsafeNotice } from './packrun.mts'
import { STREAM_LIMITS } from './packstreamcore.mts'

// 5.1.0: 흐르는 출력 실행기. SSH 채널·화면을 가짜로 만들어 시작·멈춤·정리 순서를 시험 (실제 pty의 SIGHUP/SIGINT 전달은 Device 실기에서 확인)
class FakeChannel extends EventEmitter {
  written: string[] = []
  closed = false
  write(s: string) {
    this.written.push(s)
    return true
  }
  close() {
    if (this.closed) return
    this.closed = true
    setImmediate(() => this.emit('close')) // 실제 채널도 닫기 요청 뒤 close 이벤트가 따로 옴
  }
}
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
type ExecCb = (err: Error | undefined, ch: FakeChannel) => void
const fakeClient = (opened: FakeChannel[], delay = false) => ({
  exec: (_cmd: string, _opts: unknown, cb: ExecCb) => {
    const ch = new FakeChannel()
    opened.push(ch)
    if (delay) setTimeout(() => cb(undefined, ch), 20)
    else cb(undefined, ch)
    return true
  }
})
const asClient = (c: ReturnType<typeof fakeClient>) => c as never
const asWc = (w: FakeWc) => w as never
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
// 시험마다 앞 시험이 남긴 스트림을 모두 정리한 뒤 시작 (고정 시간 대기는 CPU가 바쁠 때 흔들려서, 남은 게 없을 때까지 기다림)
// 조건이 될 때까지 기다림 (고정 시간 대기는 CPU가 바쁠 때 흔들림)
const until = async (cond: () => boolean) => {
  for (let t = 0; t < 3000 && !cond(); t += 5) await wait(5)
}
const settle = async () => {
  for (let t = 0; t < 3000 && activeCount() > 0; t += 5) {
    stopAll()
    await wait(5)
  }
  assert.equal(activeCount(), 0)
}
const fast = () => {
  STREAM_LIMITS.batchMs = 10
  STREAM_LIMITS.stopGraceMs = 30
}

test('데이터가 줄로 모여 화면에 가고, 명령이 끝나면 종료 코드와 함께 end', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's1', 'pk', 'sh -c x', 60)
  chs[0].emit('data', Buffer.from('hello\nwor'))
  chs[0].emit('data', Buffer.from('ld\n'))
  await wait(40)
  assert.deepEqual(wc.of('pack:stream-data').flatMap((x) => x[2] as string[]), ['hello', 'world'])
  chs[0].emit('exit', 3)
  chs[0].emit('close')
  assert.deepEqual(wc.of('pack:stream-end')[0].slice(1), ['s1', 'exit', 3])
})

test('연결이 끊겨 종료 코드 없이 닫히면 closed', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's2', 'pk', 'x', 60)
  chs[0].emit('close')
  assert.equal(wc.of('pack:stream-end')[0][2], 'closed')
})

test('멈춤: 먼저 Ctrl-C, 유예 안에 안 끝나면 채널을 닫음, 이유는 stopped', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's3', 'pk', 'x', 60)
  stopStream('s3')
  assert.deepEqual(chs[0].written, ['\x03'])
  assert.equal(chs[0].closed, false)
  chs[0].emit('data', Buffer.from('late\n')) // 끝내는 중에 온 출력은 보여 주지 않음
  for (let t = 0; t < 2000 && !wc.of('pack:stream-end').length; t += 5) await wait(5) // 고정 시간은 CPU가 바쁠 때 흔들림
  assert.equal(chs[0].closed, true)
  assert.equal(wc.of('pack:stream-end')[0][2], 'stopped')
  assert.equal(wc.of('pack:stream-data').length, 0)
})

test('멈춤: Ctrl-C로 곧바로 끝나면 채널을 따로 닫지 않아도 end 한 번', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's4', 'pk', 'x', 60)
  stopStream('s4')
  chs[0].emit('exit', 130)
  chs[0].emit('close')
  await wait(60)
  assert.equal(wc.of('pack:stream-end').length, 1)
  assert.deepEqual(wc.of('pack:stream-end')[0].slice(2), ['stopped', 130])
})

test('채널이 열리기 전에 멈춤 요청이 오면 열리자마자 닫음', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  const p = startStream(asWc(wc), asClient(fakeClient(chs, true)), 's5', 'pk', 'x', 60)
  stopStream('s5')
  await p
  assert.equal(chs[0].closed, true)
  assert.equal(wc.of('pack:stream-end')[0][2], 'stopped')
})

test('최대 실행 시간이 지나면 timeout 으로 멈춤', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's6', 'pk', 'x', 0.05)
  await until(() => wc.of('pack:stream-end').length > 0)
  assert.equal(chs[0].closed, true)
  assert.equal(wc.of('pack:stream-end')[0][2], 'timeout')
})

test('출력이 너무 빠르면 rate 로 자동 정지', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 's7', 'pk', 'x', 60)
  for (let i = 0; i < 7; i++) chs[0].emit('data', Buffer.alloc(1024 * 1024, 'a'))
  await until(() => wc.of('pack:stream-end').length > 0)
  assert.equal(wc.of('pack:stream-end')[0][2], 'rate')
  assert.equal(chs[0].closed, true)
})

test('화면이 사라지거나 새로 불러와지면 그 화면의 스트림을 모두 끝냄 (다른 화면 것은 그대로)', async () => {
  await settle()
  fast()
  const a = new FakeWc()
  const b = new FakeWc()
  const chs: FakeChannel[] = []
  const cl = asClient(fakeClient(chs))
  await startStream(asWc(a), cl, 'a1', 'pk', 'x', 60)
  await startStream(asWc(a), cl, 'a2', 'pk', 'x', 60)
  await startStream(asWc(b), cl, 'b1', 'other', 'x', 60)
  a.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }) // 하위 프레임·같은 문서 이동은 무시
  a.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  assert.deepEqual(chs.map((c) => c.written.length), [0, 0, 0])
  a.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }) // 새로고침
  assert.deepEqual(chs.map((c) => c.written.length), [1, 1, 0])
  await wait(60)
  assert.deepEqual(chs.map((c) => c.closed), [true, true, false])
  b.emit('destroyed') // 창이 닫힘
  assert.equal(chs[2].written.length, 1)
  await wait(60)
  assert.equal(chs[2].closed, true)
})

test('render-process-gone 도 정리', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 'g1', 'pk', 'x', 60)
  wc.emit('render-process-gone')
  assert.equal(chs[0].written.length, 1)
  await wait(60)
})

test('동시 실행 한도: 팩당 2개, 앱 전체 4개, 같은 id 중복 금지', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  const cl = asClient(fakeClient(chs))
  await startStream(asWc(wc), cl, 'l1', 'p1', 'x', 60)
  await startStream(asWc(wc), cl, 'l2', 'p1', 'x', 60)
  assert.throws(() => startStream(asWc(wc), cl, 'l3', 'p1', 'x', 60), /동시에 2개/)
  assert.throws(() => startStream(asWc(wc), cl, 'l1', 'p2', 'x', 60), /이미 실행 중/)
  await startStream(asWc(wc), cl, 'l4', 'p2', 'x', 60)
  await startStream(asWc(wc), cl, 'l5', 'p3', 'x', 60)
  assert.throws(() => startStream(asWc(wc), cl, 'l6', 'p4', 'x', 60), /동시에 4개/)
  stopOwnedBy(wc)
  await until(() => activeCount() === 0)
  assert.equal(chs.every((c) => c.closed), true)
  assert.doesNotThrow(() => startStream(asWc(wc), cl, 'l7', 'p1', 'x', 60)) // 정리되면 다시 시작할 수 있음
  stopAll()
  await wait(30)
})

test('앱 종료(stopAll): 유예 없이 바로 채널을 닫음', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 'q1', 'pk', 'x', 60)
  stopAll()
  assert.equal(chs[0].closed, true)
  await wait(20)
  assert.equal(wc.of('pack:stream-end')[0][2], 'stopped')
})

test('exec 가 실패하면 항목을 지우고 오류를 던짐 (다시 시작 가능)', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const bad = { exec: (_c: string, _o: unknown, cb: (e: Error) => void) => (cb(new Error('boom')), true) }
  await assert.rejects(startStream(asWc(wc), bad as never, 'e1', 'pk', 'x', 60), /boom/)
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 'e1', 'pk', 'x', 60)
  stopAll()
  await wait(20)
})

test('보호 함수가 거부한 표식 줄은 사람이 읽는 문구로 바뀌어 화면에 감', async () => {
  await settle()
  fast()
  const wc = new FakeWc()
  const chs: FakeChannel[] = []
  await startStream(asWc(wc), asClient(fakeClient(chs)), 'u1', 'pk', 'sh -c x', 60)
  chs[0].emit('data', Buffer.from(`${UNSAFE_MARK}\r\nreal line\r\n`))
  await until(() => wc.of('pack:stream-data').length >= 1)
  assert.deepEqual((wc.of('pack:stream-data')[0][2] as string[]).slice(0, 2), [unsafeNotice(), 'real line'])
  chs[0].emit('close')
  await settle()
})
