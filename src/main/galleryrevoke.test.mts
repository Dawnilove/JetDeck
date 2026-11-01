import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyRevocations, CHECK_GAP_MS, shouldCheck } from './galleryrevoke.mts'
import { approveAndEnable, buildCatalog, readState, setEnabled, sha256, writeState, type PackEntry, type StateFile } from './packstore.mts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const L = (s: string) => ({ ko: s, en: s })
const pk = (id: string, version = '1.0.0') => ({ id, format: 1, version, name: L(id), license: 'MIT', plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd: 'ls', risk: 'read' }] }] })
const raw = (name: string, o: unknown) => ({ fileName: name + '.jdpack.json', file: '/x/' + name, bytes: new TextEncoder().encode(JSON.stringify(o)) })
const NOW = new Date('2026-11-02T00:00:00Z')
const REV = { id: 'bad-pack', reason: { ko: '나쁨', en: 'bad' }, at: '2026-11-01' }

// 모음에서 받아 켠 팩 하나(bad-pack)와 직접 설치한 팩 하나(mine-pack)가 있는 상태
function setup(origin = true) {
  const files = [raw('bad-pack', pk('bad-pack')), raw('mine-pack', pk('mine-pack'))]
  const hash = sha256(files[0].bytes)
  let st: StateFile = { version: 1, packs: { 'bad-pack': { enabled: false, ...(origin ? { origin: { kind: 'gallery' as const, serial: 1, sha256: hash } } : {}) } } }
  let es = buildCatalog({ official: [], user: files, state: st, appVersion: '5.6.0' })
  st = approveAndEnable(st, es.find((e) => e.id === 'bad-pack')!, hash)
  const mine = buildCatalog({ official: [], user: files, state: st, appVersion: '5.6.0' }).find((e) => e.id === 'mine-pack')!
  st = approveAndEnable(st, mine, mine.hash)
  es = buildCatalog({ official: [], user: files, state: st, appVersion: '5.6.0' })
  return { files, st, es, hash }
}

test('철회: 모음에서 받아 켜진 팩은 자동으로 꺼지고, 직접 설치한 팩은 그대로', () => {
  const { st, es, files, hash } = setup()
  assert.ok(es.every((e) => e.enabled))
  const r = applyRevocations(st, es, { revoked: [REV, { ...REV, id: 'mine-pack' }] }, NOW)
  assert.deepEqual(r.turnedOff.map((t) => t.id), ['bad-pack'])
  assert.equal(r.state.packs['bad-pack'].enabled, false)
  assert.equal(r.state.packs['bad-pack'].revoked?.hash, hash)
  assert.equal(r.state.packs['mine-pack'].enabled, true)
  const after = buildCatalog({ official: [], user: files, state: r.state, appVersion: '5.6.0' })
  const bad = after.find((e) => e.id === 'bad-pack')!
  assert.equal(bad.enabled, false)
  assert.equal(bad.revoked?.reason.en, 'bad')
  assert.equal(bad.approval, 'approved') // 파일은 지우지 않고 허용 기록도 그대로
  assert.equal(after.find((e) => e.id === 'mine-pack')!.enabled, true)
})

test('철회: 두 번째 실행은 바꾸지 않고 알림도 다시 만들지 않음', () => {
  const { st, es } = setup()
  const a = applyRevocations(st, es, { revoked: [REV] }, NOW)
  const b = applyRevocations(a.state, es, { revoked: [REV] }, new Date(NOW.getTime() + 1000))
  assert.equal(b.state, a.state)
  assert.equal(b.turnedOff.length, 0)
})

test('철회: 버전·지문이 다르면 해당 없음, 같으면 걸림', () => {
  const { st, es, hash } = setup()
  assert.equal(applyRevocations(st, es, { revoked: [{ ...REV, version: '2.0.0' }] }, NOW).turnedOff.length, 0)
  assert.equal(applyRevocations(st, es, { revoked: [{ ...REV, sha256: 'a'.repeat(64) }] }, NOW).turnedOff.length, 0)
  assert.equal(applyRevocations(st, es, { revoked: [{ ...REV, version: '1.0.0', sha256: hash }] }, NOW).turnedOff.length, 1)
})

test('철회: origin이 없는 팩(직접 설치하거나 파일을 바꾼 팩)은 건드리지 않음', () => {
  const { st, es } = setup(false)
  const r = applyRevocations(st, es, { revoked: [REV] }, NOW)
  assert.equal(r.state, st)
  assert.equal(r.turnedOff.length, 0)
})

test('철회: 이미 꺼진 팩도 기록은 남겨서 다시 켤 때 확인을 받음 (알림은 없음)', () => {
  const { st, es } = setup()
  const off = setEnabled(st, es.find((e) => e.id === 'bad-pack')!, false)
  const r = applyRevocations(off, buildCatalog({ official: [], user: setup().files, state: off, appVersion: '5.6.0' }), { revoked: [REV] }, NOW)
  assert.equal(r.turnedOff.length, 0)
  assert.ok(r.state.packs['bad-pack'].revoked)
})

test('철회 기록은 새 버전(다른 파일)에는 붙지 않고, 다시 허용해도 지워지지 않음', () => {
  const { st, es } = setup()
  const r = applyRevocations(st, es, { revoked: [REV] }, NOW)
  const bad = buildCatalog({ official: [], user: setup().files, state: r.state, appVersion: '5.6.0' }).find((e) => e.id === 'bad-pack')!
  const again = approveAndEnable(r.state, bad, bad.hash)
  assert.ok(again.packs['bad-pack'].revoked) // 허용 창만으로는 철회 기록이 안 사라짐 (pack:enable이 확인을 따로 요구)
  const v2 = buildCatalog({ official: [], user: [raw('bad-pack', pk('bad-pack', '1.1.0'))], state: r.state, appVersion: '5.6.0' }).find((e): e is PackEntry => e.id === 'bad-pack')!
  assert.equal(v2.revoked, undefined)
})

test('상태 파일: 철회 기록을 저장·읽기, 이상한 값은 버림', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jdrev-'))
  try {
    const { st } = setup()
    const r = applyRevocations(st, setup().es, { revoked: [REV] }, NOW)
    const f = join(dir, 's.json')
    writeState(f, r.state)
    assert.deepEqual(readState(f).packs['bad-pack'].revoked, r.state.packs['bad-pack'].revoked)
    writeState(f, { version: 1, packs: { 'bad-pack': { enabled: false, revoked: { hash: 'zz', reason: L('x'), at: 'now' } } } })
    assert.equal(readState(f).packs['bad-pack'].revoked, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('하루 1번 확인: 조건 표', () => {
  const base = { consent: true, autoCheck: true, hasGalleryPacks: true, now: NOW }
  assert.equal(shouldCheck(base), true)
  assert.equal(shouldCheck({ ...base, consent: false }), false)
  assert.equal(shouldCheck({ ...base, autoCheck: false }), false)
  assert.equal(shouldCheck({ ...base, hasGalleryPacks: false }), false) // 받은 팩이 없으면 모음에 접속하지 않음
  assert.equal(shouldCheck({ ...base, checkedAt: new Date(NOW.getTime() - CHECK_GAP_MS + 60_000).toISOString() }), false)
  assert.equal(shouldCheck({ ...base, checkedAt: new Date(NOW.getTime() - CHECK_GAP_MS - 1).toISOString() }), true)
  assert.equal(shouldCheck({ ...base, checkedAt: 'garbage' }), true)
  assert.equal(shouldCheck({ ...base, checkedAt: new Date(NOW.getTime() + 3600_000).toISOString() }), true) // 미래 시각(시계 되돌림)이면 다시 확인
})
