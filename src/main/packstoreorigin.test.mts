import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { approveAndEnable, buildCatalog, forgetPack, readState, setEnabled, setOrigin, sha256, writeState, type PackEntry, type StateFile } from './packstore.mts'

const L = (s: string) => ({ ko: s, en: s })
const pack = (cmd = 'ls') => ({ id: 'my-pack', format: 1, version: '1.0.0', name: L('x'), plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd, risk: 'read' }] }] })
const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))
const empty = (): StateFile => ({ version: 1, packs: {} })
const cat = (b: Uint8Array, st: StateFile) => buildCatalog({ official: [], user: [{ fileName: 'my-pack.jdpack.json', file: '/x/my-pack.jdpack.json', bytes: b }], state: st, appVersion: '5.5.0' })[0] as PackEntry

test('origin: 받은 파일 그대로일 때만 "모음" 출처, 파일이 바뀌면 직접 설치로', () => {
  const b = bytes(pack())
  const hash = sha256(b)
  const st = setOrigin(empty(), 'my-pack', { kind: 'gallery', serial: 4, sha256: hash })
  assert.deepEqual(cat(b, st).origin, { kind: 'gallery', serial: 4, sha256: hash })
  assert.equal(cat(bytes(pack('ls -la')), st).origin, undefined)
  assert.equal(cat(b, empty()).origin, undefined)
})
test('origin: 허용·켜기·끄기를 해도 유지, 제거하면 사라짐', () => {
  const b = bytes(pack())
  const o = { kind: 'gallery' as const, serial: 4, sha256: sha256(b) }
  let st = setOrigin(empty(), 'my-pack', o)
  const e = cat(b, st)
  st = approveAndEnable(st, e, e.hash)
  assert.deepEqual(st.packs['my-pack'].origin, o)
  assert.equal(st.packs['my-pack'].enabled, true)
  st = setEnabled(st, cat(b, st), false)
  assert.deepEqual(st.packs['my-pack'].origin, o)
  assert.equal(forgetPack(st, 'my-pack').packs['my-pack'], undefined)
  assert.equal(setOrigin(st, 'my-pack', undefined).packs['my-pack'].origin, undefined)
})
test('origin: 상태 파일에 저장·읽기, 이상한 값은 버림', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jdorg-'))
  try {
    const f = join(dir, 'state.json')
    const o = { kind: 'gallery' as const, serial: 2, sha256: 'a'.repeat(64) }
    writeState(f, setOrigin(empty(), 'my-pack', o))
    assert.deepEqual(readState(f).packs['my-pack'].origin, o)
    for (const bad of [{ kind: 'x', serial: 1, sha256: 'a'.repeat(64) }, { kind: 'gallery', serial: -1, sha256: 'a'.repeat(64) }, { kind: 'gallery', serial: 1.5, sha256: 'a'.repeat(64) }, { kind: 'gallery', serial: 1, sha256: 'zz' }, 'str']) {
      writeState(f, { version: 1, packs: { 'my-pack': { enabled: true, origin: bad as never } } })
      assert.equal(readState(f).packs['my-pack'].origin, undefined, JSON.stringify(bad))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
