import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { GALLERY_LIMITS } from './gallerycore.mts'
import { buildView, cachedListing, fetchPackFile, refreshListing, type FlowDeps } from './galleryflow.mts'
import { GALLERY_BASES, type FetchResult } from './gallerynet.mts'
import { emptyGalleryState, readGalleryState, writeGalleryState, type GalleryState } from './gallerystore.mts'
import { indexBytes, makeIndex, newKeyPair, packEntry, signBytes } from './gallerykit.mts'

const K = newKeyPair()
const OTHER = newKeyPair()
const PACK = Buffer.from('{"format":1,"id":"sensor-check"}')
const NOW = new Date('2026-11-01T00:00:00Z')
const [B1, B2] = GALLERY_BASES

type Served = Record<string, FetchResult>
const ok = (b: string | Uint8Array, etag?: string): FetchResult => ({ ok: true, status: 200, bytes: Buffer.from(b), etag })
const net = (code: 'network' | 'timeout' | 'redirect' = 'network'): FetchResult => ({ ok: false, code })
const status = (s: number): FetchResult => ({ ok: false, code: 'http-status', status: s })
function served(base: string, idx: unknown, key = K, over: Served = {}): Served {
  const bytes = indexBytes(idx)
  return { [base + 'index.json']: ok(bytes, '"e1"'), [base + 'index.json.sig']: ok(signBytes(bytes, key.secret) + '\n'), ...over }
}
function mk(map: Served, st: GalleryState = emptyGalleryState(), keys = [K.publicB64]) {
  const calls: { url: string; etag?: string }[] = []
  let state = st
  const d: FlowDeps = {
    source: { bases: GALLERY_BASES, keys, allowLoopbackHttp: false, dev: false },
    now: () => NOW,
    fetch: async (url, o) => {
      calls.push({ url, etag: o.etag })
      return map[url] ?? status(404)
    },
    load: () => state,
    save: (s) => void (state = s)
  }
  return { d, calls, state: () => state }
}
const idx = (over = {}) => makeIndex([packEntry('sensor-check', '1.2.0', PACK)], { serial: 4, ...over })

test('받기: 서명 확인 뒤 저장하고 serial을 올림', async () => {
  const t = mk(served(B1, idx()))
  const l = await refreshListing(t.d)
  assert.equal(l.status, 'ok')
  assert.equal(l.fromCache, false)
  assert.equal(l.packs[0].id, 'sensor-check')
  assert.equal(l.base, B1)
  assert.equal(t.state().lastSerial, 4)
  assert.ok(t.state().index && t.state().sig)
  assert.equal(t.calls.length, 2)
})
test('같은 주소의 etag로 다시 물으면 304를 저장본으로 처리', async () => {
  const t = mk(served(B1, idx()))
  await refreshListing(t.d)
  const m: Served = { [B1 + 'index.json']: { ok: true, status: 304 } }
  const t2 = mk(m, t.state())
  const l = await refreshListing(t2.d)
  assert.equal(l.status, 'ok')
  assert.equal(t2.calls[0].etag, '"e1"')
  assert.equal(t2.calls.length, 1)
})
test('첫 주소가 404면 대체 주소로', async () => {
  const t = mk(served(B2, idx()))
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'ok' && l.base === B2)
})
test('첫 주소의 서명이 틀려도 대체 주소가 정상이면 통과 (배포 지연 대비)', async () => {
  const t = mk({ ...served(B1, idx(), OTHER), ...served(B2, idx()) })
  assert.equal((await refreshListing(t.d)).status, 'ok')
})
test('서명이 틀림: 새 목록을 버리고 마지막 정상 목록만 보임 (untrusted)', async () => {
  const good = mk(served(B1, idx()))
  await refreshListing(good.d)
  const t = mk({ ...served(B1, idx({ serial: 9 }), OTHER), ...served(B2, idx({ serial: 9 }), OTHER) }, good.state())
  const l = await refreshListing(t.d)
  assert.equal(l.status, 'untrusted')
  assert.equal(l.error, 'bad-signature')
  assert.equal(l.fromCache, true)
  assert.equal(l.serial, 4) // 버려진 9가 아니라 저장본
  assert.equal(t.state().lastSerial, 4)
})
test('서명이 틀리고 저장본도 없음: 빈 목록, 설치할 것 없음', async () => {
  const t = mk(served(B1, idx(), OTHER))
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'untrusted' && l.packs.length === 0)
})
test('옛 목록(serial 하락): 거부하고 저장본', async () => {
  const good = mk(served(B1, idx({ serial: 9 })))
  await refreshListing(good.d)
  const t = mk({ ...served(B1, idx({ serial: 5 })), ...served(B2, idx({ serial: 5 })) }, good.state())
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'untrusted' && l.error === 'rollback' && l.serial === 9)
  assert.equal(t.state().lastSerial, 9)
})
test('네트워크 없음: 저장본을 오프라인 목록으로, 저장본이 없으면 빈 오프라인', async () => {
  const good = mk(served(B1, idx()))
  await refreshListing(good.d)
  const t = mk({ [B1 + 'index.json']: net('timeout'), [B2 + 'index.json']: net() }, good.state())
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'offline' && l.fromCache && l.packs.length === 1 && l.error === 'network')
  const none = await refreshListing(mk({}).d)
  assert.ok(none.status === 'offline' && none.packs.length === 0)
})
test('저장본을 바꿔 끼워도 서명이 안 맞으면 쓰지 않음', async () => {
  const good = mk(served(B1, idx()))
  await refreshListing(good.d)
  const st = good.state()
  const forged = indexBytes(idx({ serial: 4, packs: [packEntry('evil-pack', '1.0.0', PACK)] }))
  const t = mk({}, { ...st, index: Buffer.from(forged).toString('base64') })
  assert.equal(cachedListing(t.d).packs.length, 0)
  const t2 = mk({}, st, [OTHER.publicB64]) // 열쇠를 바꾼 앱: 옛 서명 목록은 쓰지 않음
  assert.equal(cachedListing(t2.d).packs.length, 0)
})
test('열쇠가 하나도 없으면(박힌 열쇠 없음) 네트워크도 쓰지 않고 untrusted', async () => {
  const t = mk(served(B1, idx()), emptyGalleryState(), [])
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'untrusted' && l.error === 'no-keys')
  assert.equal(t.calls.length, 0)
})
test('만료: 목록은 오지만 expired, 팩 파일은 막힘', async () => {
  const t = mk(served(B1, idx({ expires: '2026-10-30T00:00:00Z' })))
  const l = await refreshListing(t.d)
  assert.ok(l.status === 'ok' && l.expired)
  const r = await fetchPackFile(t.d, l, 'sensor-check', '5.5.0')
  assert.deepEqual(r, { ok: false, code: 'blocked' })
})

const fileUrl = (base: string) => base + 'files/sensor-check/1.2.0/sensor-check.jdpack.json'
test('팩 파일: 지문·크기가 맞으면 받음', async () => {
  const t = mk({ ...served(B1, idx()), [fileUrl(B1)]: ok(PACK) })
  const l = await refreshListing(t.d)
  const r = await fetchPackFile(t.d, l, 'sensor-check', '5.5.0')
  assert.ok(r.ok && r.bytes.equals(PACK))
})
test('팩 파일: 지문이 다르면 대체 주소를 시도하고, 모두 다르면 hash-mismatch', async () => {
  const bad = Buffer.from('{"format":1,"id":"evil-check"}  ').subarray(0, PACK.length)
  assert.equal(bad.length, PACK.length) // 크기는 같게
  const t = mk({ ...served(B1, idx()), [fileUrl(B1)]: ok(bad), [fileUrl(B2)]: ok(PACK) })
  const l = await refreshListing(t.d)
  assert.ok((await fetchPackFile(t.d, l, 'sensor-check', '5.5.0')).ok)
  const t2 = mk({ ...served(B1, idx()), [fileUrl(B1)]: ok(bad), [fileUrl(B2)]: ok(bad) })
  const r = await fetchPackFile(t2.d, await refreshListing(t2.d), 'sensor-check', '5.5.0')
  assert.deepEqual(r, { ok: false, code: 'hash-mismatch' })
})
test('팩 파일: 크기 초과·크기 다름·서버 오류', async () => {
  const t = mk({ ...served(B1, idx()), [fileUrl(B1)]: ok(Buffer.concat([PACK, Buffer.from(' ')])), [fileUrl(B2)]: { ok: false, code: 'too-big' } })
  const l = await refreshListing(t.d)
  const r = await fetchPackFile(t.d, l, 'sensor-check', '5.5.0')
  assert.ok(!r.ok && r.code === 'too-big') // 마지막 시도의 이유
  const t2 = mk({ ...served(B1, idx()) })
  const r2 = await fetchPackFile(t2.d, await refreshListing(t2.d), 'sensor-check', '5.5.0')
  assert.ok(!r2.ok && r2.code === 'http-status')
  assert.ok(GALLERY_LIMITS.pack === 128 * 1024)
})
test('팩 파일: 철회됨·앱 버전 낮음·목록에 없음·오프라인 목록이면 받지 않음', async () => {
  const rev = { revoked: [{ id: 'sensor-check', reason: { ko: '가', en: 'a' }, at: '2026-10-30' }] }
  const t = mk({ ...served(B1, idx(rev)), [fileUrl(B1)]: ok(PACK) })
  const l = await refreshListing(t.d)
  assert.deepEqual(await fetchPackFile(t.d, l, 'sensor-check', '5.5.0'), { ok: false, code: 'blocked' })
  const t2 = mk({ ...served(B1, makeIndex([packEntry('sensor-check', '1.2.0', PACK, { minApp: '9.0.0' })])), [fileUrl(B1)]: ok(PACK) })
  assert.deepEqual(await fetchPackFile(t2.d, await refreshListing(t2.d), 'sensor-check', '5.5.0'), { ok: false, code: 'blocked' })
  const t3 = mk({ ...served(B1, idx()), [fileUrl(B1)]: ok(PACK) })
  const l3 = await refreshListing(t3.d)
  assert.deepEqual(await fetchPackFile(t3.d, l3, 'nope-pack', '5.5.0'), { ok: false, code: 'not-listed' })
  assert.deepEqual(await fetchPackFile(t3.d, { ...l3, status: 'offline', fromCache: true }, 'sensor-check', '5.5.0'), { ok: false, code: 'blocked' })
})

test('화면용 목록: 차단 이유·업데이트·철회된 설치본', async () => {
  const p1 = packEntry('sensor-check', '1.2.0', PACK)
  const p2 = packEntry('net-diag', '1.0.0', PACK, { minApp: '5.6.0' })
  const p3 = packEntry('old-pack', '1.0.0', PACK)
  const t = mk(served(B1, makeIndex([p1, p2, p3], { revoked: [{ id: 'old-pack', reason: { ko: '문제', en: 'bad' }, at: '2026-10-30' }] })))
  const l = await refreshListing(t.d)
  const o = { consent: true, safeMode: false, dev: false, appVersion: '5.5.0', installed: [{ id: 'sensor-check', version: '1.1.0', hash: 'a'.repeat(64), fromGallery: true }, { id: 'old-pack', version: '1.0.0', hash: p3.sha256, fromGallery: true }] }
  const v = buildView(l, o)
  assert.equal(v.status, 'ok')
  const by = Object.fromEntries(v.items.map((i) => [i.id, i]))
  assert.equal(by['sensor-check'].block, undefined)
  assert.equal(by['sensor-check'].update, true)
  assert.equal(by['net-diag'].block, 'app-version')
  assert.equal(by['old-pack'].block, 'revoked')
  assert.deepEqual(v.revokedInstalled, [{ id: 'old-pack', version: '1.0.0', reason: { ko: '문제', en: 'bad' } }])
  assert.equal(buildView(l, { ...o, safeMode: true }).items[0].block, 'safe-mode')
  assert.equal(buildView(null, o).status, 'idle')
  const off = buildView({ ...l, status: 'offline', fromCache: true }, o)
  assert.equal(off.items[0].block, 'offline')
  assert.equal(buildView({ ...l, status: 'untrusted' }, o).items[0].block, 'untrusted')
  assert.equal(buildView({ ...l, expired: true }, o).items[0].block, 'expired')
})

test('상태 파일: 저장·읽기, 깨진 파일·이상한 값은 빈 상태', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jdgal-'))
  try {
    const f = join(dir, 'gallery.json')
    assert.deepEqual(readGalleryState(f), emptyGalleryState())
    const st: GalleryState = { version: 1, consent: true, lastSerial: 7, fetchedAt: 'x', etag: '"a"', etagBase: B1, index: 'AAAA', sig: 'bbbb' }
    writeGalleryState(f, st)
    assert.deepEqual(readGalleryState(f), st)
    writeFileSync(f, '{{ not json')
    assert.deepEqual(readGalleryState(f), emptyGalleryState())
    writeFileSync(f, JSON.stringify({ consent: 'yes', lastSerial: -3, index: 123, sig: 5 }))
    assert.deepEqual(readGalleryState(f), emptyGalleryState())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
