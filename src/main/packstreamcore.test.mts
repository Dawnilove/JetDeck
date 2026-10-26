import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Batcher, LineAssembler, STREAM_LIMITS, Throttle } from './packstreamcore.mts'

test('줄 모으기: 조각에 걸친 줄을 이어 붙이고 \r\n 은 한 번만 줄바꿈', () => {
  const a = new LineAssembler()
  assert.deepEqual(a.push('hel'), [])
  assert.deepEqual(a.push('lo\nwor'), ['hello'])
  assert.deepEqual(a.push('ld\r'), ['world'])
  assert.deepEqual(a.push('\nnext\r\n'), ['next']) // \r\n 이 조각 사이에서 갈려도 빈 줄 없음
  assert.deepEqual(a.push('50%\r100%\n'), ['50%', '100%']) // 진행 막대의 \r 도 줄바꿈
  assert.deepEqual(a.push('\n'), [''])
})

test('줄 모으기: ANSI·제어 문자 제거, 비밀 가림, 긴 줄 자르기', () => {
  const a = new LineAssembler()
  const out = a.push('\u001b[31mred\u001b[0m‮ x\nTOKEN=abc password=hunter2\n' + 'x'.repeat(5000) + '\n')
  assert.equal(out[0], 'red x')
  assert.ok(!out[1].includes('hunter2'), out[1])
  assert.equal(out[2].length, STREAM_LIMITS.line + 1)
  assert.ok(out[2].endsWith('…'))
})

test('줄 모으기: 줄바꿈 없는 조각은 조용해지면 또는 4KB가 되면 내보냄', () => {
  const a = new LineAssembler()
  assert.deepEqual(a.push('partial', 1000), [])
  assert.deepEqual(a.flush(1100), []) // 아직 조용하지 않음
  assert.deepEqual(a.flush(1000 + STREAM_LIMITS.partialIdleMs), ['partial'])
  assert.deepEqual(a.flush(5000), [])
  const big = a.push('y'.repeat(STREAM_LIMITS.partialBytes))
  assert.equal(big.length, 1)
  a.push('end')
  assert.deepEqual(a.flush(0, true), ['end'])
})

test('속도·총량 감시', () => {
  const t = new Throttle()
  const per = STREAM_LIMITS.rateBytesPerSec // 1초에 1MB씩이면 5초 합이 한도
  assert.equal(t.add(per, 0), 'ok')
  assert.equal(t.add(per, 1000), 'ok')
  assert.equal(t.add(per, 2000), 'ok')
  assert.equal(t.add(per, 3000), 'ok')
  assert.equal(t.add(per, 4000), 'ok') // 합 5MB = 한도, 넘지 않음
  assert.equal(t.add(1, 4500), 'rate')
  const slow = new Throttle() // 느리면 창 밖으로 밀려나 계속 ok
  for (let i = 0; i < 100; i++) assert.equal(slow.add(100 * 1024, i * 1000), 'ok')
  const total = new Throttle()
  let last = 'ok'
  for (let i = 0; i < 50 && last === 'ok'; i++) last = total.add(1024 * 1024, i * 6000) // 6초에 1MB: 속도는 괜찮지만 총량 20MB 초과
  assert.equal(last, 'total')
})

test('묶음: 커지면 오래된 줄부터 버리고 개수를 알림', () => {
  const b = new Batcher()
  assert.equal(b.take(), null)
  b.add(['a', 'b'])
  assert.deepEqual(b.take(), { lines: ['a', 'b'], skipped: 0 })
  const big = 'z'.repeat(1000)
  b.add(Array.from({ length: 100 }, (_, i) => `${i}${big}`))
  const r = b.take()!
  assert.ok(r.skipped > 30 && r.lines.length + r.skipped === 100)
  assert.ok(r.lines[r.lines.length - 1].startsWith('99')) // 최신 줄은 남음
  assert.equal(b.take(), null)
})
