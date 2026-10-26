import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import deviceJson from './packs/device.json' with { type: 'json' }
import { approveAndEnable, buildCatalog, diffCommands, enabledPacks, forgetPack, inspectPackBytes, installPackBytes, PACK_EXT, readState, readUserDir, setEnabled, sha256, writeState, type PackEntry, type RawFile, type StateFile } from './packstore.mts'

const L = (s: string) => ({ ko: s, en: s })
const mk = (id: string, cmd = 'ls', extra: Record<string, unknown> = {}) => ({ id, format: 1, version: '1.0.0', name: L(id), plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd, risk: 'read' }] }], ...extra })
const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const empty = (): StateFile => ({ version: 1, packs: {} })
const officialIn = [{ fileName: 'device.json', raw: deviceJson as unknown }]
const raw = (fileName: string, o: unknown) => ({ fileName, file: '/x/' + fileName, bytes: bytes(o) })
const cat = (user: RawFile[], state = empty()) => buildCatalog({ official: officialIn, user, state, appVersion: '5.0.0' })
const byId = (es: PackEntry[], id: string, i = 0) => es.filter((e) => e.id === id)[i]
const tmp = () => mkdtempSync(join(tmpdir(), 'jdpack-'))

test('공식 팩은 허용 없이 켜짐, 상태로 끌 수 있음', () => {
  const e = byId(cat([]), 'device')
  assert.deepEqual([e.source, e.status, e.enabled, e.approval], ['official', 'ok', true, 'official'])
  assert.equal(e.pack!.official, true)
  const off = byId(cat([], { version: 1, packs: { device: { enabled: false } } }), 'device')
  assert.deepEqual([off.enabled, off.wantEnabled], [false, false])
  assert.equal(enabledPacks(cat([])).length, 1)
})

test('외부 팩: 처음엔 꺼짐(허용 필요) → 허용하면 켜짐 → 파일이 바뀌면 자동으로 꺼짐', () => {
  const f1 = raw('a.jdpack.json', mk('my-pack'))
  let e = byId(cat([f1]), 'my-pack')
  assert.deepEqual([e.status, e.enabled, e.approval], ['ok', false, 'new'])
  assert.equal(e.hash, sha256(f1.bytes))
  assert.throws(() => setEnabled(empty(), e, true), /허용이 필요/)
  const st = approveAndEnable(empty(), e, e.hash, new Date('2026-10-26T00:00:00Z'))
  assert.deepEqual([st.packs['my-pack'].enabled, st.packs['my-pack'].approvedVersion, st.packs['my-pack'].approvedAt], [true, '1.0.0', '2026-10-26T00:00:00.000Z'])
  e = byId(cat([f1], st), 'my-pack')
  assert.deepEqual([e.enabled, e.approval], [true, 'approved'])
  assert.equal(enabledPacks(cat([f1], st)).length, 2)
  // 한 글자만 바뀌어도 지문이 달라져 꺼지고, 허용했던 명령과 비교해 줌
  const changed = raw('a.jdpack.json', mk('my-pack', 'ls -la', { version: '1.1.0' }))
  e = byId(cat([changed], st), 'my-pack')
  assert.deepEqual([e.enabled, e.wantEnabled, e.approval], [false, true, 'changed'])
  assert.deepEqual(e.changes, { added: [], changed: ['p/a'], removed: [] })
  assert.equal(enabledPacks(cat([changed], st)).length, 1) // 공식만
  assert.throws(() => setEnabled(st, e, true), /허용이 필요/) // 바뀐 파일은 허용 창 없이 켤 수 없음
  // 끄고 같은 지문이면 허용 창 없이 다시 켬
  e = byId(cat([f1], st), 'my-pack')
  const off = setEnabled(st, e, false)
  assert.equal(byId(cat([f1], off), 'my-pack').enabled, false)
  const on = setEnabled(off, byId(cat([f1], off), 'my-pack'), true)
  assert.equal(byId(cat([f1], on), 'my-pack').enabled, true)
  // 상태에 켜짐만 적고 허용 지문이 없거나 다르면(상태 파일 손으로 고침) 동작 안 함
  assert.equal(byId(cat([f1], { version: 1, packs: { 'my-pack': { enabled: true } } }), 'my-pack').enabled, false)
  assert.equal(byId(cat([f1], { version: 1, packs: { 'my-pack': { enabled: true, approvedHash: 'a'.repeat(64) } } }), 'my-pack').enabled, false)
})

test('허용은 사용자에게 보여 준 지문과 같을 때만', () => {
  const e = byId(cat([raw('a.jdpack.json', mk('my-pack'))]), 'my-pack')
  assert.throws(() => approveAndEnable(empty(), e, 'b'.repeat(64)), /바뀌었어요/)
  assert.throws(() => approveAndEnable(empty(), e, ''), /바뀌었어요/)
  assert.throws(() => approveAndEnable(empty(), byId(cat([]), 'device'), 'x'), /공식 팩/)
  const bad = byId(cat([raw('b.jdpack.json', { id: 'x' })]), 'file:b.jdpack.json')
  assert.throws(() => approveAndEnable(empty(), bad, bad.hash), /문제가 있는/)
})

test('충돌: 같은 id 파일이 둘이면 둘 다 꺼짐, 공식 id를 쓴 외부 팩은 거부', () => {
  const a = raw('a.jdpack.json', mk('dup'))
  const b = raw('b.jdpack.json', mk('dup', 'ls -l'))
  const first = byId(cat([a]), 'dup')
  const st = approveAndEnable(empty(), first, first.hash)
  const es = cat([a, b], st)
  const dups = es.filter((e) => e.id === 'dup')
  assert.equal(dups.length, 2)
  for (const e of dups) assert.deepEqual([e.status, e.enabled], ['conflict', false])
  assert.deepEqual(dups[0].conflictWith, ['b.jdpack.json'])
  assert.match(dups[0].errors[0], /여러 개/)
  assert.throws(() => approveAndEnable(st, dups[0], dups[0].hash), /문제가 있는/)
  // 공식 id 사칭 (예약어 · 실제 공식 팩 id)
  for (const id of ['device', 'jetdeck-tools', 'ros2']) {
    const e = byId(cat([raw('x.jdpack.json', mk(id))]), 'file:x.jdpack.json')
    assert.equal(e.status, 'invalid', id)
    assert.equal(e.pack, null)
  }
  assert.equal(byId(cat([raw('x.jdpack.json', mk('device'))]), 'device').source, 'official') // 공식 팩은 그대로
  assert.equal(cat([raw('x.jdpack.json', mk('device'))]).filter((e) => e.enabled).length, 1)
})

test('문제 있는 파일: JSON 오류 · 형식 오류 · 읽기 실패 · 너무 큼', () => {
  const es = cat([
    { fileName: 'a.jdpack.json', bytes: new TextEncoder().encode('{ not json') },
    raw('b.jdpack.json', { id: 'b', format: 1 }),
    { fileName: 'c.jdpack.json', bytes: null, error: '파일이 512KB보다 커요' },
    { fileName: 'd.jdpack.json', bytes: null, error: '파일을 읽지 못했어요' }
  ])
  const user = es.filter((e) => e.source === 'user')
  assert.deepEqual(user.map((e) => e.status), ['invalid', 'invalid', 'too-big', 'unreadable'])
  assert.ok(user.every((e) => !e.enabled && !e.pack && e.errors.length))
  // BOM이 있어도 읽힘
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(mk('bom-pack'))])
  assert.equal(byId(cat([{ fileName: 'bom.jdpack.json', bytes: bom }]), 'bom-pack').status, 'ok')
})

test('minApp이 앱보다 높으면 로드 거부', () => {
  const e = byId(cat([raw('a.jdpack.json', mk('new-pack', 'ls', { minApp: '9.0.0' }))]), 'file:a.jdpack.json')
  assert.equal(e.status, 'invalid')
  assert.match(e.errors[0], /9\.0\.0/)
})

test('상태 파일: 없거나 깨져도 빈 상태, 아는 필드만, 원자적 쓰기', () => {
  const dir = tmp()
  const f = join(dir, 'packs-state.json')
  assert.deepEqual(Object.keys(readState(f).packs), [])
  writeFileSync(f, '{ broken')
  assert.deepEqual(Object.keys(readState(f).packs), [])
  writeFileSync(f, JSON.stringify({ packs: { ok: { enabled: true, approvedHash: 'c'.repeat(64), approvedVersion: '1.0.0', evil: 1 }, 'BAD ID': { enabled: true }, __proto__: { enabled: true }, x: 5, y: { enabled: 'yes', approvedHash: 'short' } } }))
  const s = readState(f)
  assert.deepEqual(Object.keys(s.packs).sort(), ['ok', 'y'])
  assert.deepEqual({ ...s.packs.ok }, { enabled: true, approvedHash: 'c'.repeat(64), approvedVersion: '1.0.0' })
  assert.deepEqual(s.packs.y, { enabled: false })
  writeState(f, forgetPack(s, 'ok'))
  assert.deepEqual(Object.keys(readState(f).packs), ['y'])
  assert.ok(!existsSync(f + '.tmp'))
  rmSync(dir, { recursive: true })
})

test('폴더 훑기: *.jdpack.json 일반 파일만, 링크·하위 폴더·큰 파일·다른 이름 제외', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'a.jdpack.json'), JSON.stringify(mk('a-pack')))
  writeFileSync(join(dir, 'notes.txt'), 'x')
  writeFileSync(join(dir, 'b.jdpack.json.tmp'), 'x')
  mkdirSync(join(dir, 'sub.jdpack.json'))
  writeFileSync(join(dir, 'big.jdpack.json'), 'x'.repeat(513 * 1024))
  try {
    symlinkSync(join(dir, 'a.jdpack.json'), join(dir, 'link.jdpack.json'))
  } catch {
    /* 권한이 없으면 링크 시험은 건너뜀 */
  }
  const files = readUserDir(dir)
  assert.deepEqual(files.map((f) => f.fileName), ['a.jdpack.json', 'big.jdpack.json'])
  assert.ok(files[0].bytes && !files[1].bytes)
  assert.equal(readUserDir(join(dir, 'none')).length, 0)
  rmSync(dir, { recursive: true })
})

test('명령 비교: 추가·바뀜·삭제', () => {
  assert.deepEqual(diffCommands({ 'p/a': 'ls', 'p/b': 'df' }, { 'p/a': 'ls -l', 'p/c': 'id' }), { added: ['p/c'], changed: ['p/a'], removed: ['p/b'] })
  assert.deepEqual(diffCommands(undefined, { 'p/a': 'ls' }), { added: ['p/a'], changed: [], removed: [] })
})

test('설치 전 확인: 팩 정보·버전 비교·바뀐 명령, 공식 id는 거부', () => {
  const cur = cat([raw('a.jdpack.json', mk('my-pack', 'ls', { version: '1.0.0' }))])
  const up = inspectPackBytes(bytes(mk('my-pack', 'ls -la', { version: '1.1.0' })), '5.0.0', cur)
  assert.equal(up.ok, true)
  assert.deepEqual([up.existing?.relation, up.existing?.version, up.existing?.diff.changed], ['upgrade', '1.0.0', ['p/a']])
  assert.equal(inspectPackBytes(bytes(mk('my-pack', 'ls', { version: '0.9.0' })), '5.0.0', cur).existing?.relation, 'downgrade')
  assert.equal(inspectPackBytes(bytes(mk('my-pack')), '5.0.0', cur).existing?.relation, 'same')
  assert.equal(inspectPackBytes(bytes(mk('other')), '5.0.0', cur).existing, undefined)
  assert.equal(inspectPackBytes(bytes(mk('device')), '5.0.0', cur).ok, false)
  assert.equal(inspectPackBytes(new TextEncoder().encode('nope'), '5.0.0', cur).ok, false)
  assert.equal(inspectPackBytes(new Uint8Array(513 * 1024), '5.0.0', cur).ok, false)
  assert.equal(inspectPackBytes(bytes(mk('other')), '5.0.0', cur).hash, sha256(bytes(mk('other'))))
})

test('설치: 파일 이름은 팩 id로, 같은 id면 그 파일을 덮어씀, 꺼진 채 들어옴, 이상한 팩은 거부', () => {
  const dir = tmp()
  const r = installPackBytes(dir, bytes(mk('my-pack')), '5.0.0', cat([]))
  assert.equal(r.file, join(dir, 'my-pack' + PACK_EXT))
  assert.deepEqual(readdirSync(dir), ['my-pack.jdpack.json'])
  assert.equal(r.hash, sha256(readFileSync(r.file)))
  // 설치만 한 팩은 허용 전까지 꺼짐
  const es = buildCatalog({ official: officialIn, user: readUserDir(dir), state: empty(), appVersion: '5.0.0' })
  assert.deepEqual([byId(es, 'my-pack').enabled, byId(es, 'my-pack').approval], [false, 'new'])
  // 다른 이름으로 이미 깔린 같은 id → 그 파일을 덮어씀
  writeFileSync(join(dir, 'custom-name.jdpack.json'), JSON.stringify(mk('other')))
  const cur = buildCatalog({ official: officialIn, user: readUserDir(dir), state: empty(), appVersion: '5.0.0' })
  const r2 = installPackBytes(dir, bytes(mk('other', 'ls -l')), '5.0.0', cur)
  assert.equal(r2.file, join(dir, 'custom-name.jdpack.json'))
  assert.throws(() => installPackBytes(dir, bytes({ id: '../../evil', format: 1 }), '5.0.0', cur))
  assert.throws(() => installPackBytes(dir, bytes(mk('device')), '5.0.0', cur), /공식/)
  assert.ok(!readdirSync(dir).some((f) => f.includes('evil') || f.endsWith('.tmp')))
  rmSync(dir, { recursive: true })
})

test('안전 모드: 사용자 팩을 읽지 않으면 공식 팩만', () => {
  const es = buildCatalog({ official: officialIn, user: [], state: empty(), appVersion: '5.0.0' })
  assert.deepEqual(es.map((e) => e.source), ['official'])
})

test('예제 팩(examples)은 공식이어도 기본 꺼짐', () => {
  const ex = { fileName: 'examples.json', raw: { id: 'examples', format: 1, version: '1.0.0', name: L('e'), plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd: 'ls', risk: 'read' }] }] } }
  const es = buildCatalog({ official: [...officialIn, ex], user: [], state: empty(), appVersion: '5.0.0' })
  assert.deepEqual([byId(es, 'examples').enabled, byId(es, 'device').enabled], [false, true])
  const on = buildCatalog({ official: [...officialIn, ex], user: [], state: { version: 1, packs: { examples: { enabled: true } } }, appVersion: '5.0.0' })
  assert.equal(byId(on, 'examples').enabled, true)
})
