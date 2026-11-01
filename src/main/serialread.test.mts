import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, test } from 'node:test'
// @ts-expect-error 이 패키지의 타입 파일이 package.json exports에 연결돼 있지 않음 (동작은 정상)
import { MockBinding } from '@serialport/binding-mock'
import { SerialPortStream } from '@serialport/stream'
import { openRead, READ_OPEN, type PortLike } from './serialread.mts'

// 6.1.0 시리얼 읽기 열기 시험 (설계안 §6 T1·T3·T9·T10). 진짜 포트 대신 serialport의 가짜 바인딩을 쓴다
afterEach(() => MockBinding.reset())

type Made = { port: SerialPortStream<typeof MockBinding>; sets: unknown[] }
function maker(made: Made[]) {
  return (o: Record<string, unknown>): PortLike => {
    const port = new SerialPortStream({ binding: MockBinding, ...o } as ConstructorParameters<typeof SerialPortStream>[0]) as SerialPortStream<typeof MockBinding>
    const sets: unknown[] = []
    const set = port.set.bind(port)
    port.set = ((s: unknown, cb?: (e?: Error | null) => void) => (sets.push(s), set(s as never, cb as never))) as typeof port.set
    made.push({ port, sets })
    return port as unknown as PortLike
  }
}

test('T1 열기 옵션 고정: hupcl·rtscts·xon·xoff·xany 꺼짐, lock 켜짐, 보율은 팩이 정한 값', async () => {
  MockBinding.createPort('/dev/ttyTEST')
  const made: Made[] = []
  await openRead(maker(made), '/dev/ttyTEST', 115200, 'win32')
  const o = (made[0].port as unknown as { port: { openOptions: Record<string, unknown> } }).port.openOptions
  assert.deepEqual([o.hupcl, o.rtscts, o.xon, o.xoff, o.xany, o.lock, o.baudRate, o.dataBits, o.stopBits, o.parity], [false, false, false, false, false, true, 115200, 8, 1, 'none'])
  assert.equal(READ_OPEN.hupcl, false)
})

test('T3 쓰기 없음: 돌려주는 객체에 write가 없고, 데이터를 받아도 포트에 쓴 적이 없다', async () => {
  MockBinding.createPort('/dev/ttyTEST')
  const made: Made[] = []
  const src = await openRead(maker(made), '/dev/ttyTEST', 9600, 'win32')
  assert.deepEqual(Object.keys(src).sort(), ['close', 'onData', 'onEnd'])
  const got: string[] = []
  src.onData((b) => got.push(b.toString()))
  ;(made[0].port as unknown as { port: { emitData(d: string): void } }).port.emitData('hi\n')
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(got, ['hi\n'])
  assert.equal((made[0].port as unknown as { port: { lastWrite: unknown } }).port.lastWrite, null)
  src.close()
})

test('T3 구조: 열기·세션 코드에 포트 쓰기 호출이 없다', () => {
  for (const f of ['serialread.mts', 'packserial.mts']) {
    const code = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    assert.doesNotMatch(code.replace(/dec\.write\(|lines\.flush\(/g, ''), /\.write\(|\.drain\(|\.flush\(/, f)
  }
})

test('Linux만 열고 나서 제어선(DTR·RTS)을 낮춘다, 정확히 한 번', async () => {
  MockBinding.createPort('/dev/ttyA')
  MockBinding.createPort('/dev/ttyB')
  const lin: Made[] = []
  const win: Made[] = []
  await openRead(maker(lin), '/dev/ttyA', 115200, 'linux')
  await openRead(maker(win), '/dev/ttyB', 115200, 'win32')
  assert.deepEqual(lin[0].sets, [{ dtr: false, rts: false }])
  assert.deepEqual(win[0].sets, [])
})

test('T9 이미 쓰는 포트는 잠금 때문에 열리지 않고 사용자 문구가 나온다 (빼앗지 않음)', async () => {
  MockBinding.createPort('/dev/ttyTEST')
  const first = await openRead(maker([]), '/dev/ttyTEST', 115200, 'win32')
  await assert.rejects(openRead(maker([]), '/dev/ttyTEST', 115200, 'win32'), /다른 프로그램/)
  first.close()
})

test('T9 없는 포트는 오류 (재시도 없음)', async () => {
  await assert.rejects(openRead(maker([]), '/dev/none', 115200, 'win32'))
})

test('T10 10초 안에 안 열리면 실패, 늦게 열린 포트는 바로 닫는다', async () => {
  let openCb: ((e?: Error | null) => void) | undefined
  let closed = 0
  const fake: PortLike = { open: (cb) => (openCb = cb), on: () => fake, set: () => undefined, close: () => void closed++, isOpen: true }
  await assert.rejects(openRead(() => fake, 'COM9', 115200, 'win32', 20), /너무 오래/)
  openCb!(null) // 시간이 지난 뒤 열림
  assert.equal(closed, 1)
})

test('끝남: close()는 포트를 닫고 onEnd가 불린다', async () => {
  MockBinding.createPort('/dev/ttyTEST')
  const src = await openRead(maker([]), '/dev/ttyTEST', 115200, 'win32')
  const ends: string[] = []
  src.onEnd((w) => ends.push(w))
  src.close()
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(ends, ['closed'])
})
