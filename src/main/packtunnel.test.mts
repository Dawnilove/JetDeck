import assert from 'node:assert/strict'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { test } from 'node:test'
import { FakeDevice } from './fakedevice.mts'
import { createAppEngine, type AppEvent, type AppTarget } from './packappcore.mts'
import { validatePack } from './packschema.mts'

// 6.0.0 터널 시험 (설계안 §6 T17~T19·T22). 가짜 Device = 이 PC의 에코 서버 하나. 실제 SSH·실제 기기는 쓰지 않음
const L = (s: string) => ({ ko: s, en: s })
const tunnelPack = (id: string, ports: number[], minutes = 10) => ({
  id, format: 1, version: '1.0.0', minApp: '6.0.0', name: L(id),
  permissions: ports.map((p, i) => ({ id: `w${i}`, kind: 'tunnel', remotePort: p, maxMinutes: minutes, why: L('웹') })),
  plugins: [{ id: 'p', title: L('p'), actions: ports.map((_, i) => ({ id: `open${i}`, label: L('열기'), mode: 'app', perm: `w${i}`, op: 'open' })) }]
})

type Fake = { server: Server; port: number; open: Set<Socket>; seen: number[] }
async function fakeDevicePort(): Promise<Fake> {
  const open = new Set<Socket>()
  const seen: number[] = []
  const server = createServer((s) => {
    open.add(s)
    s.on('error', () => {})
    s.on('close', () => open.delete(s))
    s.pipe(s) // 에코
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  return { server, port, open, seen }
}

async function setup(opts: { minutes?: number; ms?: (m: number) => number; packs?: string[] } = {}) {
  const dev = await fakeDevicePort()
  const events: AppEvent[] = []
  const connectedTo: [string, number][] = []
  const engine = createAppEngine({
    fsOf: async () => new FakeDevice(),
    ui: { pickSave: async () => null, pickOpen: async () => null },
    emit: (e) => events.push(e),
    // 진짜 어댑터(forwardOut)는 Device의 127.0.0.1:remotePort로 가는 것. 시험에서는 에코 서버로 이음
    connectTo: (connId, sock, remotePort) => {
      connectedTo.push([connId, remotePort])
      const out = connect(dev.port, '127.0.0.1')
      out.on('error', () => sock.destroy())
      sock.on('error', () => out.destroy())
      sock.pipe(out).pipe(sock)
      sock.on('close', () => out.destroy())
    },
    tunnelMs: opts.ms
  })
  const targets = (id: string, ports: number[]) => {
    const pack = validatePack(tunnelPack(id, ports, opts.minutes)).pack!
    assert.ok(pack)
    return ports.map((_, i): AppTarget => ({ pack, hash: `h-${id}`, pluginId: 'p', action: pack.plugins[0].actions[i] }))
  }
  const open = async (connId: string, t: AppTarget) => {
    const p = (await engine.prepare(connId, t, {}))!
    return { p, r: await engine.run(connId, t, {}, p.token) }
  }
  const done = async () => {
    engine.stopAll()
    await new Promise((r) => dev.server.close(r))
  }
  return { dev, engine, events, connectedTo, targets, open, done }
}
const echo = (port: number, data = 'ping') =>
  new Promise<string>((resolve, reject) => {
    const c = connect(port, '127.0.0.1')
    c.once('error', reject)
    c.once('connect', () => c.write(data))
    c.once('data', (b) => (c.destroy(), resolve(b.toString())))
  })
const refused = (port: number, host = '127.0.0.1') =>
  new Promise<boolean>((resolve) => {
    const c = connect(port, host)
    c.once('connect', () => (c.destroy(), resolve(false)))
    c.once('error', () => resolve(true))
    c.setTimeout(1500, () => (c.destroy(), resolve(true))) // 응답이 없는 주소(막힘)도 접속 못 한 것
  })
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const rej = (p: Promise<unknown>, re: RegExp, _why?: string) => assert.rejects(p, re)

test('터널: prepare는 아무것도 열지 않고 확인 창 정보를 주고, run하면 127.0.0.1에서 Device로 이어진다', async () => {
  const s = await setup()
  const [t] = s.targets('tp', [8888])
  const p = (await s.engine.prepare('c1', t, {}))!
  assert.deepEqual([p.op, p.kind, p.risk, p.needConfirm, p.reasons], ['open', 'tunnel', 'change', true, ['tunnel']])
  assert.deepEqual([p.tunnel!.remotePort, p.tunnel!.minutes], [8888, 10])
  assert.ok(p.tunnel!.port >= 1024)
  assert.equal(await refused(p.tunnel!.port), true) // 확인 전에는 닫혀 있음
  assert.equal(s.engine.tunnelCount(), 0)
  const r = await s.engine.run('c1', t, {}, p.token)
  assert.equal(r.op, 'open')
  const { id, host, port, remotePort } = r as { id: string; host: string; port: number; remotePort: number }
  assert.deepEqual([host, remotePort], ['127.0.0.1', 8888])
  assert.equal(port, p.tunnel!.port) // 확인 창에서 보여 준 번호
  assert.equal(await echo(port), 'ping')
  assert.deepEqual(s.connectedTo, [['c1', 8888]])
  assert.deepEqual(s.events.map((e) => (e.type === 'tunnel' ? e.state : e.type)), ['open'])
  assert.equal(s.engine.stop(id), true)
  await tick()
  assert.equal(s.engine.tunnelCount(), 0)
  assert.deepEqual(s.events.map((e) => (e.type === 'tunnel' ? e.state : e.type)), ['open', 'closed'])
  await s.done()
})

test('T18 같은 PC의 LAN 주소로는 접속할 수 없다 (127.0.0.1만 열림)', async () => {
  const s = await setup()
  const [t] = s.targets('tp', [8888])
  const { r } = await s.open('c1', t)
  const port = (r as { port: number }).port
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
  if (lan) assert.equal(await refused(port, lan.address), true, `LAN ${lan.address}`)
  assert.equal(await refused(port, '127.0.0.1'), false)
  await s.done()
})

test('T18 정지·시간 초과·연결 끊김·팩 변경 뒤: 포트가 닫히고 열린 연결과 Device 쪽 연결이 0', async () => {
  const s = await setup({ ms: () => 150 })
  const [t1, t2, t3] = s.targets('tp', [8881, 8882, 8883])
  const wait = async (port: number) => {
    await tick(60)
    assert.equal(await refused(port), true, `port ${port}`)
    assert.equal(s.dev.open.size, 0, '가짜 Device에 남은 연결')
  }
  // 정지: 연결을 하나 연 채로 멈춤
  const a = (await s.open('c1', t1)).r as { id: string; port: number }
  const hold = connect(a.port, '127.0.0.1')
  hold.on('error', () => {})
  await new Promise((r) => hold.once('connect', r))
  await tick()
  assert.equal(s.dev.open.size, 1)
  s.engine.stop(a.id)
  await wait(a.port)
  assert.equal(hold.destroyed, true)
  // 시간 초과 (150ms)
  const b = (await s.open('c1', t2)).r as { id: string; port: number }
  assert.equal(await echo(b.port), 'ping')
  await tick(200)
  await wait(b.port)
  assert.equal(s.events.some((e) => e.type === 'tunnel' && e.state === 'closed' && e.reason === 'timeout'), true)
  // 연결이 끊김
  const c = (await s.open('c1', t3)).r as { port: number }
  s.engine.stopConn('c2')
  assert.equal(await echo(c.port), 'ping') // 다른 연결 것은 그대로
  s.engine.stopConn('c1')
  await wait(c.port)
  // 팩이 꺼지거나 파일이 바뀜 (T22)
  const d = (await s.open('c1', t1)).r as { port: number } // 닫힌 항목은 다시 열 수 있음
  s.engine.reconcile(() => true)
  assert.equal(await echo(d.port), 'ping')
  s.engine.reconcile((id, hash) => id === 'tp' && hash === 'changed')
  await wait(d.port)
  assert.equal(s.engine.tunnelCount(), 0)
  await s.done()
})

test('T18 앱 종료(stopAll)도 모든 터널을 닫는다', async () => {
  const s = await setup()
  const [t1, t2] = s.targets('tp', [8881, 8882])
  const a = (await s.open('c1', t1)).r as { port: number }
  const b = (await s.open('c1', t2)).r as { port: number }
  s.engine.stopAll()
  await tick()
  assert.deepEqual([await refused(a.port), await refused(b.port), s.engine.tunnelCount()], [true, true, 0])
  await s.done()
})

test('T19 같은 항목 두 번·팩당 2개 초과·앱 전체 4개 초과는 거부 / 닫으면 다시 열 수 있다', async () => {
  const s = await setup()
  const [a1, a2, a3] = s.targets('pack-a', [8881, 8882, 8883])
  const [b1, b2, b3] = s.targets('pack-b', [8881, 8882, 8883])
  const first = (await s.open('c1', a1)).r as { id: string }
  await rej(s.engine.prepare('c1', a1, {}), /이미 열려 있어요/) // 같은 항목
  await s.open('c1', a2)
  await rej(s.engine.prepare('c1', a3, {}), /수를 넘었어요/) // 팩당 2개
  await s.open('c1', b1)
  await s.open('c1', b2)
  assert.equal(s.engine.tunnelCount(), 4)
  await rej(s.engine.prepare('c1', b3, {}), /수를 넘었어요/) // 팩당 2개
  s.engine.stop(first.id)
  await tick()
  await s.open('c1', a3) // 하나 닫으면 다시 열림
  assert.equal(s.engine.tunnelCount(), 4)
  await s.done()
})

test('T19 prepare를 먼저 해 둔 여러 token으로 한도를 넘기려 해도 run에서 다시 막는다', async () => {
  const s = await setup()
  const [a1, a2, a3] = s.targets('pack-a', [8881, 8882, 8883])
  const toks = await Promise.all([a1, a2, a3].map((t) => s.engine.prepare('c1', t, {})))
  await s.engine.run('c1', a1, {}, toks[0]!.token)
  await s.engine.run('c1', a2, {}, toks[1]!.token)
  await rej(s.engine.run('c1', a3, {}, toks[2]!.token), /수를 넘었어요/)
  assert.equal(s.engine.tunnelCount(), 2)
  await s.done()
})

test('T17 터널: 변조된 token·다른 항목의 token·다른 연결·재사용은 거부', async () => {
  const s = await setup()
  const [a1, a2] = s.targets('tp', [8881, 8882])
  const p1 = (await s.engine.prepare('c1', a1, {}))!
  const p2 = (await s.engine.prepare('c1', a2, {}))!
  for (const tok of [undefined, '', 'f'.repeat(32), p2.token]) await rej(s.engine.run('c1', a1, {}, tok), /확인한 내용과 달라요/)
  await rej(s.engine.run('c2', a1, {}, p1.token), /확인한 내용과 달라요/)
  assert.equal(s.engine.tunnelCount(), 0)
  await s.engine.run('c1', a1, {}, p1.token)
  await rej(s.engine.run('c1', a1, {}, p1.token), /확인한 내용과 달라요/) // 한 번만
  await s.done()
})

test('로컬 포트가 그 사이 쓰이면 새 빈 포트로 열고 알려 준다', async () => {
  const s = await setup()
  const [t] = s.targets('tp', [8888])
  const p = (await s.engine.prepare('c1', t, {}))!
  const squatter = createServer()
  await new Promise<void>((r) => squatter.listen(p.tunnel!.port, '127.0.0.1', r))
  const r = (await s.engine.run('c1', t, {}, p.token)) as { port: number }
  assert.notEqual(r.port, p.tunnel!.port)
  assert.equal(await echo(r.port), 'ping')
  await new Promise((res) => squatter.close(res))
  await s.done()
})

test('터널 전: 연결 어댑터가 없으면 열지 않는다 / 거부 포트는 실행에서도 막는다', async () => {
  const s = await setup()
  const [t] = s.targets('tp', [8888])
  const bad = { ...t, pack: { ...t.pack, permissions: [{ ...t.pack.permissions![0], remotePort: 22 }] } }
  await rej(s.engine.prepare('c1', bad, {}), /경로가 올바르지 않아요/)
  await s.done()
})

test('Device로 잇다가 예외가 나면(연결이 막 끊김) 그 소켓만 닫고 터널은 계속된다', async () => {
  const s = await setup()
  const [t] = s.targets('tp', [8888])
  const { r } = await s.open('c1', t)
  const port = (r as { port: number }).port
  let calls = 0
  const eng = createAppEngine({
    fsOf: async () => new FakeDevice(),
    ui: { pickSave: async () => null, pickOpen: async () => null },
    connectTo: () => { calls++; throw new Error('not connected') }
  })
  const p = (await eng.prepare('c1', t, {}))!
  const r2 = (await eng.run('c1', t, {}, p.token)) as { port: number }
  const c = connect(r2.port, '127.0.0.1')
  c.on('error', () => {})
  await new Promise((res) => c.once('close', res))
  assert.equal(calls, 1)
  assert.equal(eng.tunnelCount(), 1) // 터널은 그대로
  eng.stopAll()
  assert.equal(await refused(port, '127.0.0.1'), false) // 다른 엔진의 터널은 영향 없음
  await s.done()
})
