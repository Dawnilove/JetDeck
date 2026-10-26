import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { approveAndEnable, buildCatalog, readState, setBadgesOff, setEnabled, writeState, type RawFile, type StateFile } from './packstore.mts'

// 5.3.0: badgesOff 상태 (팩은 켠 채 탐색기 배지만 끄기)
const L = (s: string) => ({ ko: s, en: s })
const badge = (id: string) => ({ id, label: L(id), cmd: 'ls -A {dir}', separator: 'line', root: 'dir', match: '^(.)\s(.+)$', code: 1, path: 2, codes: { M: { show: 'M', text: L('x'), tone: 'ok' } } })
const mk = (id: string, badges: unknown[]) => ({ id, format: 1, version: '1.0.0', name: L(id), minApp: '5.3.0', plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd: 'ls', risk: 'read' }] }], badges })
const raw = (fileName: string, o: unknown): RawFile => ({ fileName, file: '/x/' + fileName, bytes: new TextEncoder().encode(JSON.stringify(o)) })
const empty = (): StateFile => ({ version: 1, packs: {} })
const cat = (user: RawFile[], state = empty()) => buildCatalog({ official: [], user, state, appVersion: '5.3.0' })

test('badgesOff: 상태 파일에 저장되고 읽을 때 id 형식·개수·중복을 검사함', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jdbadge-'))
  try {
    const f = join(dir, 'state.json')
    writeState(f, { version: 1, packs: { x: { enabled: true, badgesOff: ['git', 'b2'] } } })
    assert.deepEqual(readState(f).packs.x.badgesOff, ['git', 'b2'])
    const many = Array.from({ length: 30 }, (_, i) => `b${i}`)
    writeFileSync(f, JSON.stringify({ version: 1, packs: { x: { enabled: true, badgesOff: ['git', 'git', 'BAD ID', 5, null, ...many] }, y: { enabled: true, badgesOff: 'git' }, z: { enabled: true, badgesOff: [] } } }))
    const st = readState(f)
    assert.equal(st.packs.x.badgesOff!.length, 20)
    assert.deepEqual(st.packs.x.badgesOff!.slice(0, 3), ['git', 'b0', 'b1'])
    assert.equal(st.packs.y.badgesOff, undefined)
    assert.equal(st.packs.z.badgesOff, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('setBadgesOff: 이 팩에 있는 배지 id만 받고, 팩의 켜짐·허용은 그대로', () => {
  const f = raw('a.jdpack.json', mk('my-pack', [badge('git'), badge('other')]))
  let e = cat([f])[0]
  let st = approveAndEnable(empty(), e, e.hash)
  e = cat([f], st)[0]
  assert.deepEqual([e.enabled, e.badgesOff], [true, []])
  st = setBadgesOff(st, e, ['git', 'nope', 'git', 5 as unknown as string])
  e = cat([f], st)[0]
  assert.deepEqual([e.enabled, e.approval, e.badgesOff], [true, 'approved', ['git']]) // 팩은 켜진 채
  assert.equal(st.packs['my-pack'].approvedHash, e.hash)
  st = setEnabled(st, e, false) // 팩을 껐다 켜도 배지 설정은 남음
  st = setEnabled(st, cat([f], st)[0], true)
  assert.deepEqual(cat([f], st)[0].badgesOff, ['git'])
  st = setBadgesOff(st, cat([f], st)[0], []) // 다시 켜기
  assert.deepEqual(cat([f], st)[0].badgesOff, [])
  assert.equal(st.packs['my-pack'].badgesOff, undefined)
})

test('setBadgesOff: 허용 전 팩·공식 팩에도 상태가 생기지만 켜짐 여부는 바뀌지 않음, 문제 있는 팩은 거부', () => {
  const f = raw('a.jdpack.json', mk('my-pack', [badge('git')]))
  const e = cat([f])[0]
  const st = setBadgesOff(empty(), e, ['git'])
  const e2 = cat([f], st)[0]
  assert.deepEqual([e2.enabled, e2.approval, e2.badgesOff], [false, 'new', ['git']])
  const bad = cat([raw('bad.jdpack.json', { nope: 1 })])[0]
  assert.throws(() => setBadgesOff(empty(), bad, ['git']))
  // 허용을 다시 받아도(파일이 바뀐 뒤) 꺼 둔 배지는 그대로
  const f2 = raw('a.jdpack.json', { ...mk('my-pack', [badge('git')]), version: '1.1.0' })
  const approved = approveAndEnable(st, cat([f2], st)[0], cat([f2], st)[0].hash)
  assert.deepEqual(cat([f2], approved)[0].badgesOff, ['git'])
})
