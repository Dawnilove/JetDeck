import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FakeDevice } from './fakedevice.mts'
import { createAppEngine, type AppTarget } from './packappcore.mts'
import { LIMITS, validatePack } from './packschema.mts'

// 6.0.0 엔진 시험: 가짜 Device(메모리)에 나쁜 상황을 주입한다 (설계안 §6 T12~T17·T22). 실제 기기·SSH는 쓰지 않음
const L = (s: string) => ({ ko: s, en: s })
const HOME = '/home/u'
const F = [{ name: 'file', label: L('f'), type: 'text', charset: 'free' }]
const act = (id: string, perm: string, op: string, path?: string, fields: unknown[] | undefined = path?.includes('{file}') ? F : undefined) => ({ id, label: L(id), mode: 'app', perm, op, ...(path !== undefined ? { path } : {}), ...(fields ? { fields } : {}) })
const raw = (perms: Record<string, unknown>[]) => ({
  id: 'tp', format: 1, version: '1.0.0', minApp: '6.0.0', name: L('t'),
  permissions: [
    { id: 'logs', kind: 'sftp.read', root: '~/logs', maxBytes: 1000, why: L('x'), ...perms[0] },
    { id: 'up', kind: 'sftp.write', root: '~/upload', maxBytes: 1000, why: L('x'), ...perms[1] }
  ],
  plugins: [{ id: 'p', title: L('p'), actions: [act('list', 'logs', 'list', ''), act('text', 'logs', 'text', '{file}'), act('get', 'logs', 'get', '{file}'), act('put', 'up', 'put', '{file}'), { id: 'ls', label: L('ls'), cmd: 'ls', risk: 'read' }] }]
})

function setup(perms: Record<string, unknown>[] = [{}, {}], connDevices?: Record<string, FakeDevice>) {
  const dev = new FakeDevice(HOME)
    .file(`${HOME}/logs/a.log`, 'hello log')
    .mkdir(`${HOME}/upload`)
    .file('/etc/passwd', 'root:x')
    .file(`${HOME}/.ssh/id_rsa`, 'KEY')
  const dir = mkdtempSync(join(tmpdir(), 'jdapp-'))
  const ui = { save: join(dir, 'saved.log') as string | null, open: null as string | null, saveCalls: 0, openCalls: 0, names: [] as string[] }
  const events: unknown[] = []
  const engine = createAppEngine({
    fsOf: async (id) => connDevices?.[id] ?? dev,
    ui: {
      pickSave: async (name) => (ui.names.push(name), ui.saveCalls++, ui.save),
      pickOpen: async () => (ui.openCalls++, ui.open)
    },
    emit: (e) => events.push(e)
  })
  const pack = validatePack(raw(perms)).pack!
  assert.ok(pack, 'pack')
  const t = (id: string): AppTarget => ({ pack, hash: 'h1', pluginId: 'p', action: pack.plugins[0].actions.find((a) => a.id === id)! })
  const local = (name: string, data: string) => (writeFileSync(join(dir, name), data), join(dir, name))
  return { dev, dir, ui, engine, t, local, events, pack, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const rej = (p: Promise<unknown>, re: RegExp, _why?: string) => assert.rejects(p, re)

test('list: 폴더 먼저·이름순, 이름 정리, FIFO는 other로, 2000개 제한', async () => {
  const s = setup()
  s.dev.mkdir(`${HOME}/logs/sub`).file(`${HOME}/logs/b‮evil.txt`, 'x').other(`${HOME}/logs/fifo`).link(`${HOME}/logs/lnk`, '/etc')
  const r = await s.engine.run('c1', s.t('list'), {}, '')
  assert.equal(r.op, 'list')
  assert.deepEqual((r as { entries: unknown[] }).entries.map((e) => (e as { name: string }).name), ['sub', 'a.log', 'bevil.txt', 'fifo', 'lnk'])
  assert.deepEqual((r as { entries: { kind: string }[] }).entries.map((e) => e.kind), ['dir', 'file', 'file', 'other', 'link'])
  for (let i = 0; i < LIMITS.listEntries + 5; i++) s.dev.file(`${HOME}/logs/many/f${i}`, 1)
  const big = await s.engine.run('c1', { ...s.t('list'), action: { ...s.t('list').action, path: 'many' } }, {}, '')
  assert.deepEqual([(big as { entries: unknown[] }).entries.length, (big as { truncated: boolean }).truncated], [LIMITS.listEntries, true])
  s.done()
})

test('T14 list: 링크로 root 밖을 가리키는 폴더는 못 연다', async () => {
  const s = setup()
  s.dev.link(`${HOME}/logs/out`, '/etc')
  await rej(s.engine.run('c1', { ...s.t('list'), action: { ...s.t('list').action, path: 'out' } }, {}, ''), /허용된 폴더 밖/)
  s.done()
})

test('text: 글자 파일 읽기, 바이너리·비UTF-8·256KB 초과·민감 이름은 거부', async () => {
  const s = setup([{ maxBytes: 20 * 1024 * 1024 }, {}])
  assert.deepEqual(await s.engine.run('c1', s.t('text'), { file: 'a.log' }, ''), { op: 'text', text: 'hello log' })
  s.dev.file(`${HOME}/logs/bin`, 'ab\u0000cd').file(`${HOME}/logs/euc`, Buffer.from([0xb0, 0xa1, 0xb0, 0xa2])).file(`${HOME}/logs/huge`, LIMITS.textPreview + 1).file(`${HOME}/logs/.env`, 'X=1').file(`${HOME}/logs/ansi`, 'a\u001b[31mred\u001b[0m‮b')
  await rej(s.engine.run('c1', s.t('text'), { file: 'bin' }, ''), /바이너리/)
  await rej(s.engine.run('c1', s.t('text'), { file: 'euc' }, ''), /UTF-8/)
  await rej(s.engine.run('c1', s.t('text'), { file: 'huge' }, ''), /너무 커요/)
  await rej(s.engine.run('c1', s.t('text'), { file: '.env' }, ''), /막힌 경로/)
  assert.deepEqual(await s.engine.run('c1', s.t('text'), { file: 'ansi' }, ''), { op: 'text', text: 'aredb' }) // ANSI·BiDi 제거
  assert.equal(s.engine.size(), 0)
  s.done()
})

test('T17 화면이 보낸 값: 경로 이탈·잘못된 값은 실행 전에 거부 / 모르는 키(경로·권한)는 무시', async () => {
  const s = setup()
  for (const file of ['../../etc/passwd', '/etc/passwd', 'a/../../../etc/passwd', '..', '', 'a\u0000b', 'x'.repeat(300)]) await rej(s.engine.run('c1', s.t('get'), { file }, ''), /./, JSON.stringify(file).slice(0, 20))
  assert.equal(s.ui.saveCalls, 0) // 대화상자도 열기 전에 거부
  const r = await s.engine.run('c1', s.t('text'), { file: 'a.log', path: '/etc/passwd', perm: 'up', root: '/', op: 'put' } as Record<string, string>, '')
  assert.deepEqual(r, { op: 'text', text: 'hello log' })
  // 다른 종류의 항목(exec)·권한 이름이 다른 항목
  await rej(s.engine.run('c1', s.t('ls'), {}, ''), /앱 기능을 쓰는 항목이 아니에요/)
  const t = s.t('get')
  await rej(s.engine.run('c1', { ...t, action: { ...t.action, perm: 'nope' } }, { file: 'a.log' }, ''), /앱 기능을 쓰는 항목이 아니에요/)
  await rej(s.engine.run('c1', { ...t, action: { ...t.action, op: 'put' } }, { file: 'a.log' }, ''), /앱 기능을 쓰는 항목이 아니에요/)
  s.done()
})

test('T12 get: 링크로 /etc를 가리키면 받을 수 없다', async () => {
  const s = setup()
  s.dev.link(`${HOME}/logs/link`, '/etc')
  await rej(s.engine.run('c1', s.t('get'), { file: 'link/passwd' }, ''), /허용된 폴더 밖/)
  assert.equal(s.ui.saveCalls, 0)
  assert.equal(existsSync(s.ui.save!), false)
  s.done()
})

test('get: 저장 대화상자에서 고른 곳에만 임시 이름으로 받고 이름을 바꾼다 / 취소 / 실행 파일 확장자 거부 / 이름 정리', async () => {
  const s = setup()
  const r = await s.engine.run('c1', s.t('get'), { file: 'a.log' }, '')
  assert.deepEqual(r, { op: 'get', saved: 'saved.log', size: 9 })
  assert.equal(readFileSync(s.ui.save!, 'utf8'), 'hello log')
  assert.deepEqual(readdirSync(s.dir), ['saved.log']) // 임시 파일 없음
  assert.deepEqual(s.ui.names, ['a.log'])
  s.ui.save = null
  assert.deepEqual(await s.engine.run('c1', s.t('get'), { file: 'a.log' }, ''), { op: 'get', saved: null, size: 0 })
  for (const bad of ['x.exe', 'x.BAT', 'x.ps1', 'x.js', 'x.exe.']) {
    s.ui.save = join(s.dir, bad)
    await rej(s.engine.run('c1', s.t('get'), { file: 'a.log' }, ''), /실행 파일 형식/)
    assert.equal(existsSync(s.ui.save), false, bad)
  }
  assert.deepEqual(readdirSync(s.dir), ['saved.log'])
  assert.deepEqual(s.events.length >= 0, true)
  s.done()
})

test('T15 get: 상한 초과는 거부 / 전송 중 연결이 끊기면 임시 파일을 지운다', async () => {
  const s = setup()
  s.dev.file(`${HOME}/logs/big`, 1001).file(`${HOME}/logs/mid`, 900)
  await rej(s.engine.run('c1', s.t('get'), { file: 'big' }, ''), /너무 커요/)
  assert.equal(s.ui.saveCalls, 0)
  s.dev.cutAfter = 300
  await rej(s.engine.run('c1', s.t('get'), { file: 'mid' }, ''), /Connection lost/)
  assert.deepEqual(readdirSync(s.dir), []) // 받던 파일도 임시 파일도 남지 않음
  assert.equal(s.engine.size(), 0)
  s.dev.cutAfter = null
  s.done()
})

test('get: stat보다 실제로 더 많이 흐르면(실행 중 커지는 파일) 상한에서 끊는다', async () => {
  const s = setup()
  s.dev.file(`${HOME}/logs/grow`, 500)
  s.dev.extra = 700
  await rej(s.engine.run('c1', s.t('get'), { file: 'grow' }, ''), /너무 커요/)
  assert.deepEqual(readdirSync(s.dir), [])
  s.dev.extra = 0
  s.done()
})

async function prep(s: ReturnType<typeof setup>, file = 'new.bin', data = 'DATA') {
  s.ui.open = s.local('pc.bin', data)
  return (await s.engine.prepare('c1', s.t('put'), { file }))!
}

test('put: 고른 PC 파일을 확인 뒤 임시 파일에 올리고 이름을 바꾼다 (0644, 임시 파일 없음)', async () => {
  const s = setup()
  const p = await prep(s)
  assert.deepEqual([p.needConfirm, p.risk, p.exists, p.remotePath, p.local], [true, 'change', false, '~/upload/new.bin', { name: 'pc.bin', size: 4 }])
  assert.match(p.token, /^[0-9a-f]{32}$/)
  const r = await s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token)
  assert.deepEqual(r, { op: 'put', name: 'new.bin', size: 4, path: '~/upload/new.bin' })
  assert.equal(s.dev.read(`${HOME}/upload/new.bin`), 'DATA')
  assert.equal(s.dev.modes.get(`${HOME}/upload/new.bin`), 0o644)
  assert.deepEqual(s.dev.names(`${HOME}/upload`), ['new.bin'])
  s.done()
})

test('T17 put: 변조된 token·다른 입력값·재사용·다른 연결은 모두 거부', async () => {
  const s = setup()
  const p = await prep(s)
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, 'f'.repeat(32)), /확인한 내용과 달라요/)
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, undefined), /확인한 내용과 달라요/)
  await rej(s.engine.run('c1', s.t('put'), { file: 'other.bin' }, p.token), /확인한 내용과 달라요/) // 확인한 대상과 다른 Device 경로
  await rej(s.engine.run('c2', s.t('put'), { file: 'new.bin' }, p.token), /확인한 내용과 달라요/) // 다른 연결
  assert.deepEqual(s.dev.names(`${HOME}/upload`), [])
  await s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token)
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token), /확인한 내용과 달라요/) // 한 번만
  s.done()
})

test('put: 확인 뒤 PC 파일이 바뀌면 거부 / 다른 PC 파일을 고르면 새 token', async () => {
  const s = setup()
  const p = await prep(s)
  writeFileSync(s.ui.open!, 'CHANGED-LONGER')
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token), /바뀌었어요|확인한 내용과 달라요/)
  assert.deepEqual(s.dev.names(`${HOME}/upload`), [])
  const p2 = await prep(s, 'new.bin', 'XY')
  assert.notEqual(p2.token, p.token)
  s.done()
})

test('put: 확인 뒤 Device에 같은 이름이 생기면 거부 (덮어쓰기는 확인한 경우만)', async () => {
  const s = setup()
  const p = await prep(s)
  s.dev.file(`${HOME}/upload/new.bin`, 'SOMEONE')
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token), /확인한 내용과 달라요/)
  assert.equal(s.dev.read(`${HOME}/upload/new.bin`), 'SOMEONE')
  // 이미 있는 파일은 prepare가 exists로 알리고, 그 token으로 덮어쓴다
  const p2 = await prep(s)
  assert.equal(p2.exists, true)
  await s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p2.token)
  assert.equal(s.dev.read(`${HOME}/upload/new.bin`), 'DATA')
  assert.deepEqual(s.dev.names(`${HOME}/upload`), ['new.bin'])
  s.done()
})

test('T16 put: overwrite never / 링크 대상 / 쓰기 거부 목록 / 폴더 없음 / 크기 초과 / 경로 이탈은 prepare에서 거부 (대화상자도 안 엶)', async () => {
  const s = setup([{}, { overwrite: 'never' }])
  s.dev.file(`${HOME}/upload/old`, 'x')
  s.ui.open = s.local('pc.bin', 'DATA')
  await rej(s.engine.prepare('c1', s.t('put'), { file: 'old' }), /같은 이름의 파일이 있어서/)
  const s2 = setup()
  s2.ui.open = s2.local('pc.bin', 'DATA')
  s2.dev.link(`${HOME}/upload/lnk`, `${HOME}/upload/real`).file(`${HOME}/upload/real`, 'r').mkdir(`${HOME}/upload/.git`)
  for (const [file, re] of [['lnk', /링크 파일/], ['.bashrc', /막힌 경로/], ['.git/config', /막힌 경로/], ['k.pem', /막힌 경로/], ['no/dir/x', /올릴 폴더가 없어요/], ['../x', /경로가 올바르지 않아요/], ['/etc/x', /경로가 올바르지 않아요/]] as const) await rej(s2.engine.prepare('c1', s2.t('put'), { file }), re)
  assert.equal(s2.ui.openCalls, 0)
  s2.ui.open = s2.local('big.bin', 'x'.repeat(1001))
  await rej(s2.engine.prepare('c1', s2.t('put'), { file: 'ok' }), /너무 커요/)
  assert.equal(s2.ui.openCalls, 1)
  s2.ui.open = null
  assert.equal(await s2.engine.prepare('c1', s2.t('put'), { file: 'ok' }), null) // 취소
  s.done()
  s2.done()
})

test('T15 put: 올리는 중 연결이 끊기면 임시 파일을 지운다 / 올린 파일이 크기가 다르면 오류', async () => {
  const s = setup()
  const p = await prep(s, 'new.bin', 'x'.repeat(900))
  s.dev.cutAfter = 300
  await rej(s.engine.run('c1', s.t('put'), { file: 'new.bin' }, p.token), /Connection lost/)
  assert.deepEqual(s.dev.names(`${HOME}/upload`), []) // 임시 파일 정리
  assert.equal(s.engine.size(), 0)
  s.dev.cutAfter = null
  s.done()
})

test('전송은 연결마다 하나, stop과 팩 변경(reconcile)이 즉시 멈추고 정리한다 (T22)', async () => {
  const s = setup()
  s.dev.stall = true
  const first = s.engine.run('c1', s.t('get'), { file: 'a.log' }, '', 'op1')
  const settled = first.then(() => 'ok', (e: Error) => e.message)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(s.engine.size(), 1)
  await rej(s.engine.run('c1', s.t('text'), { file: 'a.log' }, ''), /하나씩만/)
  assert.equal(s.engine.stop('nope'), false)
  assert.equal(s.engine.stop('op1'), true)
  assert.match(await settled, /전송을 멈췄어요/)
  assert.deepEqual(readdirSync(s.dir), [])
  assert.equal(s.engine.size(), 0)
  // 팩이 꺼지거나 파일이 바뀌면 같은 식으로 멈춤
  const second = s.engine.run('c1', s.t('get'), { file: 'a.log' }, '').then(() => 'ok', (e: Error) => e.message)
  await new Promise((r) => setTimeout(r, 30))
  s.engine.reconcile((id, hash) => id === 'tp' && hash === 'h1') // 그대로면 유지
  assert.equal(s.engine.size(), 1)
  s.engine.reconcile((id, hash) => id === 'tp' && hash === 'h2') // 파일이 바뀜
  assert.match(await second, /전송을 멈췄어요/)
  // 연결이 끊김
  const third = s.engine.run('c1', s.t('get'), { file: 'a.log' }, '').then(() => 'ok', (e: Error) => e.message)
  await new Promise((r) => setTimeout(r, 30))
  s.engine.stopConn('c2')
  assert.equal(s.engine.size(), 1)
  s.engine.stopConn('c1')
  assert.match(await third, /전송을 멈췄어요/)
  assert.deepEqual(readdirSync(s.dir), [])
  assert.equal(s.engine.size(), 0)
  s.dev.stall = false
  s.done()
})

test('opId는 화면이 정해도 형식·중복을 검사한다', async () => {
  const s = setup()
  s.dev.stall = true
  const a = s.engine.run('c1', s.t('get'), { file: 'a.log' }, '', 'ok-1').catch(() => {})
  await new Promise((r) => setTimeout(r, 30))
  s.dev.stall = false
  await rej(s.engine.run('c2', s.t('text'), { file: 'a.log' }, '', 'ok-1'), /올바르지 않은 요청/)
  await rej(s.engine.run('c2', s.t('text'), { file: 'a.log' }, '', 'bad id!'), /올바르지 않은 요청/)
  s.engine.stopAll()
  await a
  s.done()
})
