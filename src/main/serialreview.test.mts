import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redact } from './activitylog.mts'
import { createAppEngine, type AppTarget } from './packappcore.mts'
import type { SerialChoice } from './packserial.mts'
import { Batcher, LineAssembler, STREAM_LIMITS } from './packstreamcore.mts'
import type { Pack } from './packschema.mts'
import { openRead, type PortLike, type SerialSource } from './serialread.mts'

// 6.1.0 보안 리뷰 지적(#1~#8) 시험. 가짜 소스·가짜 포트만 쓴다

test('#1 빈 줄 65,536개가 한꺼번에 들어와도 묶음 자르기가 느려지지 않는다', () => {
  const b = new Batcher()
  const ls = new LineAssembler().push('\n'.repeat(65536))
  assert.equal(ls.length, 65536)
  const t = performance.now()
  b.add(ls)
  b.add(ls)
  assert.ok(performance.now() - t < 500, '묶음 자르기가 너무 오래 걸림')
  const r = b.take()!
  assert.ok(r.lines.length <= STREAM_LIMITS.batchBytes / 1 + 1)
  assert.equal(r.lines.length + r.skipped, 131072) // 버린 줄 수 + 남은 줄 수 = 들어온 줄 수
})

test('#4 개인 키는 BEGIN~END 사이 모든 줄이 숨겨지고 그 뒤 줄은 다시 보인다', () => {
  const l = new LineAssembler()
  const out = l.push('before\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----\nafter\n')
  assert.equal(out.length, 3)
  assert.equal(out[0], 'before')
  assert.match(out[1], /개인 키|private key/i)
  assert.equal(out[2], 'after')
  assert.ok(!out.join('\n').includes('MIIE') && !out.join('\n').includes('BKcw'))
})

test('#4 키가 여러 조각에 걸쳐 와도 숨기고, END가 오지 않으면 200줄 뒤 다시 보인다', () => {
  const l = new LineAssembler()
  const out = [...l.push('-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBB'), ...l.push('BB\n')]
  assert.equal(out.length, 1)
  const many = l.push('x\n'.repeat(250) + 'visible\n')
  assert.equal(many.at(-1), 'visible')
  assert.ok(many.length < 250)
})

test('#6 값 중간에서 400ms 멈춰 끊겨도 이어진 조각의 값이 가려진다', () => {
  const l = new LineAssembler()
  const t0 = 1_000_000
  const a = [...l.push('password=', t0), ...l.flush(t0 + 500)]
  const b = l.push('hunter2\n', t0 + 600)
  assert.ok(!a.concat(b).join('').includes('hunter2'), JSON.stringify([a, b]))
  const l2 = new LineAssembler()
  const c = [...l2.push('password=hun', t0), ...l2.flush(t0 + 500), ...l2.push('ter2\n', t0 + 600)]
  assert.ok(!c.join('').includes('ter2'), JSON.stringify(c))
  // 비밀이 아닌 조각 뒤에는 가리지 않는다
  const l3 = new LineAssembler()
  const d = [...l3.push('boot ok', t0), ...l3.flush(t0 + 500), ...l3.push(' done\n', t0 + 600)]
  assert.deepEqual(d, ['boot ok', ' done'])
})

test('#7 psk·pass 값을 가린다', () => {
  for (const s of ['psk="mywifikey"', 'PSK: mywifikey', 'wifi_pass=abc', 'pass=abc']) assert.ok(!/mywifikey|abc/.test(redact(s)), s)
})

test('#3 Linux에서 제어선을 낮추지 못하면 읽지 않고 포트를 닫고 실패한다', async () => {
  let closed = 0
  const fake: PortLike = { open: (cb) => cb(null), on: () => fake, set: (_o, cb) => cb?.(new Error('cannot set')), close: () => void closed++, isOpen: true }
  await assert.rejects(openRead(() => fake, '/dev/ttyX', 115200, 'linux'), /제어선|control lines/)
  assert.equal(closed, 1)
})

test('#8 늦게 열린 포트를 닫을 때 콜백을 넘긴다 (닫기 실패가 error 이벤트로 던져지지 않게)', async () => {
  let openCb: ((e?: Error | null) => void) | undefined
  const args: unknown[] = []
  const fake: PortLike = { open: (cb) => (openCb = cb), on: () => fake, set: () => undefined, close: (...a: unknown[]) => void args.push(...a), isOpen: true }
  await assert.rejects(openRead(() => fake, 'COM9', 115200, 'win32', 10), /너무 오래|too long/)
  openCb!(null)
  assert.equal(typeof args[0], 'function')
})

// 엔진: #2·#5
const pack = { id: 'p', permissions: [{ id: 'u1', kind: 'serial.read', baud: 115200, maxMinutes: 10, maxBytes: 5242880, why: 'x' }], plugins: [] } as unknown as Pack
const target = { pack, hash: 'h', pluginId: 'pl', action: { id: 'a', mode: 'app', perm: 'u1', op: 'read' } } as unknown as AppTarget
const port: SerialChoice = { path: 'COM5', label: 'L', vendorId: '2341', productId: '0043' }
function engine(listGate?: Promise<void>) {
  let opened = 0
  let closed = 0
  let calls = 0
  const src: SerialSource = { onData: () => {}, onEnd: () => {}, close: () => void closed++ }
  const e = createAppEngine({
    fsOf: async () => {
      throw new Error('x')
    },
    ui: { pickSave: async () => null, pickOpen: async () => null, pickPort: async () => 0 },
    listPorts: async () => {
      if (++calls === 2) await listGate
      return [port]
    },
    openRead: async () => (opened++, src),
    serialMs: () => 60_000
  })
  return { e, opened: () => opened, closed: () => closed }
}

test('#2 화면이 정한 id를 그대로 쓰고, 그 id로 멈출 수 있다', async () => {
  const t = engine()
  const p = (await t.e.prepare('c', target, undefined))!
  const r = await t.e.run('c', target, undefined, p.token, 'sr-abc123')
  assert.equal(r.op === 'read' && r.id, 'sr-abc123')
  assert.equal(t.e.stop('sr-abc123'), true)
  assert.equal(t.e.serialCount(), 0)
  assert.equal(t.closed(), 1)
})

test('#2 올바르지 않거나 이미 쓰는 id는 거부한다', async () => {
  const t = engine()
  const p = (await t.e.prepare('c', target, undefined))!
  await assert.rejects(t.e.run('c', target, undefined, p.token, 'a b/c'), /올바르지|not valid/i)
  assert.equal(t.e.serialCount(), 0)
})

test('#5 포트 목록을 기다리는 동안 정지가 오면 포트를 열지 않는다', async () => {
  let release!: () => void
  const t = engine(new Promise<void>((r) => (release = r)))
  const p = (await t.e.prepare('c', target, undefined))!
  const run = t.e.run('c', target, undefined, p.token)
  await new Promise((r) => setImmediate(r))
  t.e.stopConn('c')
  release()
  await assert.rejects(run)
  assert.equal(t.opened(), 0)
  assert.equal(t.e.serialCount(), 0)
})
