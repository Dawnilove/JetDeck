import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeDevice } from './fakedevice.mts'
import { createAppEngine, type AppEvent, type AppTarget } from './packappcore.mts'
import { checkSubmission } from './packcheck.mts'
import type { SerialChoice } from './packserial.mts'
import { commandMap, diffPerms } from './packstore.mts'
import { LIMITS, permStrings, SERIAL_BAUDS, SERIAL_MIN_APP, summarizePack, validatePack } from './packschema.mts'
import { permRisk } from './risk.mts'
import type { SerialSource } from './serialread.mts'

// 6.1.0 serial.read 권한 시험 (설계안 §6 T2·T4~T8·T10·T14~T16·T20): 스키마 규칙과 엔진 (가짜 포트·가짜 고르기 창)
const L = (s: string) => ({ ko: s, en: s })
const sperm = (o: Record<string, unknown> = {}) => ({ id: 'uart', kind: 'serial.read', baud: 115200, why: L('장치 로그'), ...o })
const sapp = (o: Record<string, unknown> = {}) => ({ id: 'read', label: L('읽기'), mode: 'app', perm: 'uart', op: 'read', ...o })
const pack = (permissions: unknown[] | undefined, actions: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'tp', format: 1, version: '1.0.0', minApp: SERIAL_MIN_APP, name: L('t'), ...(permissions ? { permissions } : {}), plugins: [{ id: 'p', title: L('p'), actions }], ...extra
})
const run = (permissions: unknown[] | undefined, actions: unknown[], extra: Record<string, unknown> = {}) => validatePack(pack(permissions, actions, extra))
const errs = (r: ReturnType<typeof run>) => [...r.errors, ...r.warnings].join('|')

test('serial.read: 올바른 선언은 통과하고 기본값·위험도·색인 글자가 맞다', () => {
  const r = run([sperm()], [sapp()])
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  const p = r.pack!.permissions![0]
  assert.deepEqual([p.kind, p.baud, p.maxMinutes, p.maxBytes, p.root, p.remotePort], ['serial.read', 115200, 10, LIMITS.permBytesDefault, undefined, undefined])
  const a = r.pack!.plugins[0].actions[0]
  assert.deepEqual([a.mode, a.op, a.risk, a.cmd, a.reasons, a.understated, a.path], ['app', 'read', 'change', '', ['serial-read'], false, undefined])
  assert.deepEqual(permRisk('serial.read'), { risk: 'change', reasons: ['serial-read'] })
  assert.deepEqual(permStrings(r.pack!), ['serial.read:115200'])
  assert.equal(summarizePack(r.pack!).perm, 1)
  assert.equal(SERIAL_BAUDS.length, 8)
})

test('T2 보율: 허용 목록 밖·낮은 보율·문자열·없음은 오류, 목록의 8개는 통과', () => {
  for (const baud of [0, 134, 300, 1200, 2400, 14400, 115201, 1500000, '115200', null, undefined, 9600.5]) assert.match(errs(run([sperm({ baud })], [sapp()])), /baud/, String(baud))
  for (const baud of SERIAL_BAUDS) assert.deepEqual(run([sperm({ baud })], [sapp()]).errors, [], String(baud))
})

test('T4 팩이 포트·경로·쓰기·제어선을 적으면 오류, 다른 권한에 baud를 적어도 오류', () => {
  for (const k of ['port', 'path', 'device', 'root', 'remotePort', 'overwrite', 'write', 'dtr', 'rts', 'hupcl', 'rtscts', 'rtsMode']) assert.match(errs(run([sperm({ [k]: k === 'root' ? '~/x' : k === 'remotePort' ? 8888 : 'COM5' })], [sapp()])), /serial\.read 권한은/, k)
  assert.match(errs(run([{ id: 'logs', kind: 'sftp.read', root: '~/logs', baud: 9600, why: L('x') }], [{ id: 'l', label: L('l'), mode: 'app', perm: 'logs', op: 'list' }])), /baud/)
  assert.match(errs(run([{ id: 'web', kind: 'tunnel', remotePort: 8888, baud: 9600, why: L('x') }], [{ id: 'o', label: L('o'), mode: 'app', perm: 'web', op: 'open' }])), /baud/)
  assert.match(errs(run([sperm({ maxMinutes: 61 })], [sapp()])), /maxMinutes/)
  assert.match(errs(run([sperm({ maxMinutes: 0 })], [sapp()])), /maxMinutes/)
  assert.match(errs(run([sperm({ maxBytes: 21 * 1024 * 1024 })], [sapp()])), /maxBytes/)
  assert.match(errs(run([sperm({ why: undefined })], [sapp()])), /why/)
})

test('T5·T6 read 항목: 명령·자동 실행·경로·입력 칸·잘못된 op는 오류', () => {
  for (const o of [{ cmd: 'ls' }, { auto: true }, { path: 'x' }, { display: { type: 'chart' } }, { fields: [{ name: 'f', label: L('f'), type: 'text' }] }, { op: 'list' }, { op: 'open' }, { op: 'put' }, { op: undefined }, { perm: 'nope' }])
    assert.notDeepEqual(run([sperm()], [sapp(o)]).errors, [], JSON.stringify(o))
  assert.match(errs(run([sperm()], [sapp({ risk: 'read' })])), /더 높아요/) // 낮게 적으면 앱 계산이 이김
  assert.equal(run([sperm()], [sapp({ risk: 'read' })]).pack!.plugins[0].actions[0].understated, true)
  assert.equal(run([sperm()], [sapp({ risk: 'read' })]).pack!.plugins[0].actions[0].risk, 'change')
  // 다른 권한의 op를 시리얼 권한에 쓰는 것 / 시리얼 op를 sftp 권한에 쓰는 것
  assert.notDeepEqual(run([{ id: 'logs', kind: 'sftp.read', root: '~/logs', why: L('x') }], [{ id: 'l', label: L('l'), mode: 'app', perm: 'logs', op: 'read' }]).errors, [])
})

test('T5 minApp: 없음·6.0.0·5.9.9는 오류(팩 전체 거부), 6.1.0은 통과. sftp·터널 팩은 6.0.0 그대로 통과', () => {
  for (const minApp of [undefined, '6.0.0', '5.9.9']) {
    const r = validatePack(pack([sperm()], [sapp()], { minApp }))
    assert.equal(r.pack, null, String(minApp))
    assert.match(r.errors.join('|'), /minApp/)
  }
  assert.equal(validatePack(pack([sperm()], [sapp()], { minApp: '6.1.0' })).pack !== null, true)
  assert.equal(validatePack(pack([sperm()], [sapp()], { minApp: '6.10.0' })).pack !== null, true)
  const old = pack([{ id: 'logs', kind: 'sftp.read', root: '~/logs', why: L('x') }], [{ id: 'l', label: L('l'), mode: 'app', perm: 'logs', op: 'list' }], { minApp: '6.0.0' })
  assert.deepEqual(validatePack(old).errors, []) // 6.0.0 하위 호환: 권한 팩은 그대로
  assert.equal(validatePack(pack([sperm()], [sapp()]), { appVersion: '6.0.0' }).pack, null) // 6.0.0 앱은 minApp 6.1.0 팩을 거부
})

test('T16 허용: baud가 바뀌면 changed, 기존 6.0.0 권한의 비교 글자는 그대로', () => {
  const a = commandMap(run([sperm()], [sapp()]).pack!)
  const b = commandMap(run([sperm({ baud: 9600 })], [sapp()]).pack!)
  assert.deepEqual(diffPerms(a, b), { added: [], changed: ['perm:uart'], removed: [] })
  assert.deepEqual(diffPerms(a, commandMap(run([sperm(), sperm({ id: 'second' })], [sapp(), sapp({ id: 'r2', perm: 'second' })]).pack!)).added, ['perm:second'])
  const sftp = run([{ id: 'logs', kind: 'sftp.read', root: '~/logs', why: L('x') }], [{ id: 'l', label: L('l'), mode: 'app', perm: 'logs', op: 'list' }], { minApp: '6.0.0' }).pack!
  assert.equal(commandMap(sftp)['perm:logs'], '{"kind":"sftp.read","root":"~/logs","maxBytes":5242880}') // baud 키가 안 들어가야 6.0.0에서 허용한 팩이 꺼지지 않음
})

test('T16 제출 검사: 요약표에 시리얼 범위가 나오고, 낮은 minApp·허용 밖 보율은 실패', () => {
  const body = '## What\nx\n## Permissions\nReads the board log lines so the user can see them here.\n'
  const path = 'docs/packs/files/board-log/1.0.0/board-log.jdpack.json'
  const check = (obj: unknown) => checkSubmission({ changed: [{ status: 'A', path }], read: (p) => (p === path ? new TextEncoder().encode(JSON.stringify(obj)) : null), existingIds: [], prBody: body })
  const mk = (permissions: unknown[], extra: Record<string, unknown> = {}) => ({ ...pack(permissions, [sapp()], extra), id: 'board-log', author: 'someone', license: 'MIT', desc: L('d') })
  const ok = check(mk([sperm()]))
  assert.equal(ok.ok, true, ok.problems.join(' | '))
  assert.match(ok.reports[0].perms[0].scope, /this PC serial port .*115200 baud/)
  const lowApp = check(mk([sperm()], { minApp: '6.0.0' }))
  assert.equal(lowApp.ok, false)
  const badBaud = check(mk([sperm({ baud: 1200 })]))
  assert.equal(badBaud.ok, false)
})

// ── 엔진 ──
type Fake = { choices: SerialChoice[]; sources: { src: SerialSource; push(s: string): void; closed: number; end(w: 'closed' | 'error'): void }[]; events: AppEvent[]; picks: number[]; opens: string[] }
function setup(over: { active?: (id: string, hash: string) => boolean; idleMs?: number; ms?: (m: number) => number } = {}) {
  const f: Fake = {
    choices: [
      { path: 'COM5', label: 'USB Serial Device (COM5)', vendorId: '2341', productId: '0043', serialNumber: 'S1' },
      { path: 'COM1', label: 'Communications Port (COM1)' }
    ],
    sources: [], events: [], picks: [0], opens: []
  }
  let activeFn = over.active
  const engine = createAppEngine({
    fsOf: async () => new FakeDevice(),
    ui: { pickSave: async () => null, pickOpen: async () => null, pickPort: async () => f.picks.shift() ?? null },
    emit: (e) => f.events.push(e),
    listPorts: async () => f.choices,
    openRead: async (path) => {
      f.opens.push(path)
      let data: (b: Buffer) => void = () => {}
      let end: (w: 'closed' | 'error') => void = () => {}
      const rec = { closed: 0, push: (s: string) => data(Buffer.from(s)), end: (w: 'closed' | 'error') => end(w), src: { onData: (cb: (b: Buffer) => void) => (data = cb), onEnd: (cb: (w: 'closed' | 'error') => void) => (end = cb), close: () => void rec.closed++ } as SerialSource }
      f.sources.push(rec)
      return rec.src
    },
    isActive: (id, h) => (activeFn ? activeFn(id, h) : true),
    serialIdleMs: over.idleMs ?? 60_000,
    serialMs: over.ms
  })
  const target = (id = 'tp', actionId = 'read', hash = 'h1', permOver: Record<string, unknown> = {}, actions: unknown[] = [sapp({ id: actionId })]): AppTarget => {
    const pk = validatePack({ ...pack([sperm(permOver)], actions), id }).pack!
    assert.ok(pk)
    return { pack: pk, hash, pluginId: 'p', action: pk.plugins[0].actions.find((a) => a.id === actionId)! }
  }
  const start = async (t: AppTarget, conn = 'c1') => {
    const p = (await engine.prepare(conn, t, {}))!
    return { p, r: await engine.run(conn, t, {}, p.token) as { id: string; port: string; baud: number; endsAt: number } }
  }
  return { f, engine, target, start, setActive: (fn: (id: string, h: string) => boolean) => (activeFn = fn) }
}
const rej = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re)
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

test('엔진: 고르기 → 확인 정보 → 실행 → 글자 → 정지. 보여 주는 값은 앱 계산', async () => {
  const s = setup()
  const t = s.target()
  const { p, r } = await s.start(t)
  assert.deepEqual([p.op, p.kind, p.risk, p.needConfirm, p.reasons], ['read', 'serial.read', 'change', true, ['serial-read']])
  assert.deepEqual(p.serial, { path: 'COM5', label: 'USB Serial Device (COM5)', vidpid: '2341:0043', baud: 115200, minutes: 10, maxBytes: LIMITS.permBytesDefault })
  assert.deepEqual(s.f.opens, ['COM5'])
  assert.equal(r.port, 'COM5')
  s.f.sources[0].push('hello\nworld\n')
  await wait(260) // 화면 묶음 간격(200ms)
  const data = s.f.events.filter((e) => e.type === 'serial-data').flatMap((e) => (e as { lines: string[] }).lines)
  assert.deepEqual(data, ['hello', 'world'])
  assert.equal(s.engine.stop(r.id), true)
  assert.equal(s.f.sources[0].closed, 1)
  const closed = s.f.events.find((e) => e.type === 'serial' && e.state === 'closed')!
  assert.deepEqual([closed.type === 'serial' && closed.reason, closed.type === 'serial' && closed.bytes], ['stopped', 12])
  assert.equal(s.engine.serialCount(), 0)
})

test('엔진: 취소하면 null, 포트가 없으면 오류, 자동 선택·기억 없음', async () => {
  const s = setup()
  s.f.picks = [] // 고르기 창을 취소
  assert.equal(await s.engine.prepare('c1', s.target(), {}), null)
  s.f.choices = []
  await rej(s.engine.prepare('c1', s.target(), {}), /시리얼 포트가 없어요/)
  s.f.choices = [{ path: 'COM5', label: 'x' }]
  s.f.picks = [7] // 목록에 없는 번호
  assert.equal(await s.engine.prepare('c1', s.target(), {}), null)
})

test('T6 token 위조: 바꾼 값·다른 항목·재사용·다른 연결은 거부', async () => {
  const s = setup()
  const a = s.target('tp', 'read', 'h1', {}, [sapp({ id: 'read' }), sapp({ id: 'other' })])
  const p = (await s.engine.prepare('c1', a, {}))!
  await rej(s.engine.run('c1', a, {}, 'x'.repeat(32)), /확인한 내용과 달라요/)
  await rej(s.engine.run('c1', a, {}, undefined), /확인한 내용과 달라요/)
  await rej(s.engine.run('c2', a, {}, p.token), /확인한 내용과 달라요/) // 다른 연결
  const other: AppTarget = { ...a, action: a.pack.plugins[0].actions.find((x) => x.id === 'other')! }
  await rej(s.engine.run('c1', other, {}, p.token), /확인한 내용과 달라요/) // 다른 항목
  await s.engine.run('c1', a, {}, p.token) // 진짜는 통과
  await rej(s.engine.run('c1', a, {}, p.token), /확인한 내용과 달라요/) // 재사용
  s.engine.stopAll()
})

test('T6 token은 팩 지문에 묶인다: 팩이 바뀌어 다시 허용되면 이전 확인은 쓸 수 없다', async () => {
  const s = setup()
  s.f.picks = [0, 0, 0]
  const p = (await s.engine.prepare('c1', s.target('tp', 'read', 'h1'), {}))!
  await rej(s.engine.run('c1', s.target('tp', 'read', 'h2'), {}, p.token), /확인한 내용과 달라요/)
  const q = (await s.engine.prepare('c1', s.target('tp', 'read', 'h1', { baud: 9600 }), {}))! // 같은 지문 이름이어도 보율이 다르면 token이 다름
  assert.notEqual(p.token, q.token)
})

test('T7 고른 뒤 장치가 바뀌거나 사라지면 거부 (열지 않음)', async () => {
  const s = setup()
  const t = s.target()
  let p = (await s.engine.prepare('c1', t, {}))!
  s.f.choices[0] = { ...s.f.choices[0], serialNumber: 'S2' } // 같은 COM5에 다른 장치
  await rej(s.engine.run('c1', t, {}, p.token), /바뀌었어요/)
  s.f.picks = [0]
  p = (await s.engine.prepare('c1', t, {}))!
  s.f.choices = []
  await rej(s.engine.run('c1', t, {}, p.token), /바뀌었어요/)
  assert.deepEqual(s.f.opens, [])
  assert.equal(s.engine.serialCount(), 0)
})

test('T8 고르는 동안·확인하는 동안 팩이 꺼지면 열지 않는다', async () => {
  const s = setup({ active: () => false })
  await rej(s.engine.prepare('c1', s.target(), {}), /켜져 있지 않아요/)
  const s2 = setup()
  const p = (await s2.engine.prepare('c1', s2.target(), {}))!
  s2.setActive(() => false)
  await rej(s2.engine.run('c1', s2.target(), {}, p.token), /켜져 있지 않아요/)
  assert.deepEqual(s2.f.opens, [])
})

test('T9 열기 오류는 그대로 오류가 되고 개수 칸을 비운다', async () => {
  const s = setup()
  const eng = createAppEngine({ fsOf: async () => new FakeDevice(), ui: { pickSave: async () => null, pickOpen: async () => null, pickPort: async () => 0 }, listPorts: async () => s.f.choices, openRead: async () => { throw new Error('COM5을(를) 다른 프로그램이 쓰고 있어요') } })
  const t = s.target()
  const p = (await eng.prepare('c1', t, {}))!
  await rej(eng.run('c1', t, {}, p.token), /다른 프로그램/)
  assert.equal(eng.serialCount(), 0)
})

test('T14 끝나는 길: 정지·연결 끊김·팩 끄기·앱 종료·USB 뽑힘 모두 포트를 한 번 닫는다', async () => {
  for (const how of ['stop', 'conn', 'pack', 'quit', 'usb', 'time'] as const) {
    const s = setup({ ms: how === 'time' ? () => 20 : undefined })
    const { r } = await s.start(s.target())
    if (how === 'stop') s.engine.stop(r.id)
    if (how === 'conn') s.engine.stopConn('c1')
    if (how === 'pack') s.engine.reconcile(() => false)
    if (how === 'quit') s.engine.stopAll()
    if (how === 'usb') s.f.sources[0].end('closed')
    if (how === 'time') await wait(60)
    assert.equal(s.f.sources[0].closed, 1, how)
    assert.equal(s.engine.serialCount(), 0, how)
    const closed = s.f.events.filter((e) => e.type === 'serial' && e.state === 'closed')
    assert.equal(closed.length, 1, how)
    assert.equal(closed[0].type === 'serial' && closed[0].reason, { stop: 'stopped', conn: 'conn', pack: 'pack', quit: 'quit', usb: 'closed', time: 'timeout' }[how], how)
  }
})

test('T14 팩이 켜져 있는 동안은 계속, 같은 팩이 다시 켜지면(지문 같음) 멈추지 않는다', async () => {
  const s = setup()
  await s.start(s.target())
  s.engine.reconcile((id, h) => id === 'tp' && h === 'h1')
  assert.equal(s.engine.serialCount(), 1)
  s.engine.reconcile((id, h) => id === 'tp' && h === 'h2') // 파일이 바뀜
  assert.equal(s.engine.serialCount(), 0)
})

test('T15 개수 제한: 같은 항목 중복·팩당 1개·앱 전체 2개', async () => {
  const s = setup()
  s.f.choices = [{ path: 'COM5', label: 'a', vendorId: '1', productId: '1' }]
  s.f.picks = [0, 0, 0, 0, 0]
  const a = s.target('pa')
  await s.start(a)
  await rej(s.engine.prepare('c1', a, {}), /이미 하고 있어요/) // 같은 항목
  const two = s.target('pa', 'r2', 'h1', {}, [sapp({ id: 'read' }), sapp({ id: 'r2' })])
  await rej(s.engine.prepare('c1', two, {}), /넘었어요/) // 같은 팩의 두 번째
  await s.start(s.target('pb'))
  await rej(s.engine.prepare('c1', s.target('pc'), {}), /넘었어요/) // 앱 전체 2개
  assert.equal(s.engine.serialCount(), 2)
  s.engine.stopAll()
})

test('T10 데이터가 없으면 안내 이벤트가 한 번 나오고 포트는 열려 있다', async () => {
  const s = setup({ idleMs: 20 })
  const { r } = await s.start(s.target())
  await wait(60)
  assert.equal(s.f.events.filter((e) => e.type === 'serial-idle').length, 1)
  assert.equal(s.f.sources[0].closed, 0)
  s.engine.stop(r.id)
})

test('T20 포트 이름의 제어 문자·BiDi·긴 글자는 정리되어 확인 창 정보로 간다', async () => {
  const s = setup()
  s.f.choices = [{ path: 'COM5', label: `USB‮\u0000${'가'.repeat(100)}`, vendorId: '2341', productId: '0043' }]
  const p = (await s.engine.prepare('c1', s.target(), {}))!
  assert.doesNotMatch(p.serial!.label, /‮|\u0000/)
  assert.ok(p.serial!.label.length <= 60)
})

test('T19 읽는 글자는 AI 터미널 기록·활동 기록으로 가는 코드와 이어지지 않는다', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['packserial.mts', 'serialread.mts', 'packappcore.mts']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /termbuf|pushTerm|activitylog\.mts'|appendActivity/, f)
})
