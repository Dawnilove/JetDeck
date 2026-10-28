import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appVersionOk, checkPackFile, checkPackIdentity, GALLERY_LIMITS, parseIndex, publicKeyOf, revokedFor, verifySignature, type GalleryIndex } from './gallerycore.mts'
import { GALLERY_KEYS } from './gallerykeys.mts'
import { indexBytes, makeIndex, newKeyPair, packEntry, signBytes } from './gallerykit.mts'

const NOW = new Date('2026-11-01T00:00:00Z')
const K1 = newKeyPair()
const K2 = newKeyPair()
const PACK = Buffer.from('{"format":1}')
const signed = (idx: unknown, k = K1) => {
  const bytes = indexBytes(idx)
  return { bytes, sig: signBytes(bytes, k.secret) }
}
const good = () => makeIndex([packEntry('sensor-check', '1.2.0', PACK)])
const opts = (over = {}) => ({ keys: [K1.publicB64], lastSerial: 0, now: NOW, ...over })

test('올바른 서명과 색인은 통과', () => {
  const { bytes, sig } = signed(good())
  const r = parseIndex(bytes, sig, opts())
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.index.packs[0].id, 'sensor-check')
    assert.equal(r.expired, false)
    assert.equal(r.keyIndex, 0)
  }
})
test('서명 뒤 줄바꿈·공백은 허용, 다음 열쇠(2번째 자리)로도 통과', () => {
  const { bytes, sig } = signed(good(), K2)
  const r = parseIndex(bytes, sig + '\r\n', opts({ keys: [K1.publicB64, K2.publicB64] }))
  assert.ok(r.ok && r.keyIndex === 1)
})
test('서명 1바이트 변조 → bad-signature (본문이든 서명이든)', () => {
  const { bytes, sig } = signed(good())
  const b = Buffer.from(bytes)
  b[b.length - 5] ^= 1
  assert.deepEqual(parseIndex(b, sig, opts()), { ok: false, code: 'bad-signature' })
  const s = Buffer.from(sig, 'base64')
  s[10] ^= 1
  assert.deepEqual(parseIndex(bytes, s.toString('base64'), opts()), { ok: false, code: 'bad-signature' })
})
test('다른 열쇠로 한 서명, 열쇠 목록이 빔 → bad-signature', () => {
  const { bytes, sig } = signed(good(), K2)
  assert.equal(parseIndex(bytes, sig, opts()).ok, false)
  assert.equal(parseIndex(bytes, signed(good()).sig, opts({ keys: [] })).ok, false) // 지금 앱처럼 열쇠가 없으면 모두 거부
})
test('서명 글자가 이상하면 거부 (길이·글자·비어 있음)', () => {
  const { bytes, sig } = signed(good())
  for (const bad of ['', 'x', sig.slice(0, -4), sig + 'AAAA', 'A'.repeat(300), sig.replace(/.$/, '!')]) assert.equal(parseIndex(bytes, bad, opts()).ok, false, bad.slice(0, 20))
})
test('serial 하락 → rollback, 같은 serial은 통과', () => {
  const { bytes, sig } = signed(makeIndex([packEntry('sensor-check', '1.2.0', PACK)], { serial: 5 }))
  const r = parseIndex(bytes, sig, opts({ lastSerial: 6 }))
  assert.ok(!r.ok && r.code === 'rollback')
  assert.ok(parseIndex(bytes, sig, opts({ lastSerial: 5 })).ok)
})
test('만료: 목록은 읽히되 expired = true', () => {
  const { bytes, sig } = signed(good())
  const r = parseIndex(bytes, sig, opts({ now: new Date('2027-03-01T00:00:00Z') }))
  assert.ok(r.ok && r.expired)
})
test('색인 1MB 초과 → too-big (서명 확인 전에)', () => {
  assert.deepEqual(parseIndex(new Uint8Array(GALLERY_LIMITS.index + 1), 'x', opts()), { ok: false, code: 'too-big' })
})
test('서명이 맞아도 JSON이 아니거나 형식이 틀리면 거부', () => {
  const raw = Buffer.from('not json')
  assert.ok(parseIndex(raw, signBytes(raw, K1.secret), opts()).ok === false)
  const r1 = parseIndex(raw, signBytes(raw, K1.secret), opts())
  assert.ok(!r1.ok && r1.code === 'bad-json')
  for (const mut of [(x: Record<string, unknown>) => (x.format = 2), (x: Record<string, unknown>) => (x.serial = -1), (x: Record<string, unknown>) => (x.serial = 1.5), (x: Record<string, unknown>) => (x.expires = x.generatedAt), (x: Record<string, unknown>) => (x.packs = 'no'), (x: Record<string, unknown>) => (x.revoked = [{}])]) {
    const idx = good() as unknown as Record<string, unknown>
    mut(idx)
    const s = signed(idx)
    const r = parseIndex(s.bytes, s.sig, opts())
    assert.ok(!r.ok && r.code === 'bad-format', JSON.stringify(mut.toString()))
  }
})
test('항목 500 초과 → bad-format, 500개는 통과', () => {
  const mk = (n: number) => makeIndex(Array.from({ length: n }, (_, i) => packEntry('pk' + i, '1.0.0', PACK)))
  const ok = signed(mk(GALLERY_LIMITS.packs))
  assert.ok(parseIndex(ok.bytes, ok.sig, opts()).ok)
  const over = signed(mk(GALLERY_LIMITS.packs + 1))
  const r = parseIndex(over.bytes, over.sig, opts())
  assert.ok(!r.ok && r.code === 'bad-format')
})
test('file이 .. · 절대 주소 · 다른 호스트 · id/버전과 다름 → bad-format', () => {
  for (const file of ['files/../index.json', '/etc/passwd', 'https://evil.example/x.jdpack.json', '//evil.example/x', 'files/other-pack/1.2.0/other-pack.jdpack.json', 'files/sensor-check/1.2.1/sensor-check.jdpack.json', 'files/sensor-check/1.2.0/sensor-check.jdpack.json?x=1', 'files\\sensor-check\\1.2.0\\sensor-check.jdpack.json']) {
    const idx = good()
    idx.packs[0].file = file
    const s = signed(idx)
    const r = parseIndex(s.bytes, s.sig, opts())
    assert.ok(!r.ok && r.code === 'bad-format', file)
  }
})
test('항목 필드 검사: 지문·크기·tier·id·글자쌍·태그·제어 문자', () => {
  const muts: ((p: GalleryIndex['packs'][number]) => void)[] = [
    (p) => (p.sha256 = 'ABC'), (p) => (p.size = 0), (p) => (p.size = GALLERY_LIMITS.pack + 1), (p) => ((p as { tier: string }).tier = 'official'), (p) => (p.id = 'ab'), (p) => (p.id = 'Bad_Id'),
    (p) => (p.name = { ko: '', en: 'x' }), (p) => (p.name = { ko: 'a‮b', en: 'x' }), (p) => (p.tags = ['a', 'b', 'c', 'd', 'e', 'f']), (p) => (p.tags = ['x'.repeat(21)]),
    (p) => (p.minApp = 'new'), (p) => (p.caps.read = -1), (p) => (p.submitter = 'bad user'), (p) => (p.reviewedAt = 'yesterday'), (p) => ((p.caps as { perms: unknown }).perms = 'x')
  ]
  for (const [i, m] of muts.entries()) {
    const idx = good()
    m(idx.packs[0])
    if (i === 4 || i === 5) idx.packs[0].file = `files/${idx.packs[0].id}/1.2.0/${idx.packs[0].id}.jdpack.json`
    const s = signed(idx)
    assert.equal(parseIndex(s.bytes, s.sig, opts()).ok, false, `변조 ${i}`)
  }
})
test('같은 id 두 항목 → bad-format', () => {
  const s = signed(makeIndex([packEntry('sensor-check', '1.2.0', PACK), packEntry('sensor-check', '1.2.1', PACK)]))
  assert.equal(parseIndex(s.bytes, s.sig, opts()).ok, false)
})
test('모르는 필드는 버림 (사칭 official 필드 등)', () => {
  const idx = good() as unknown as { packs: Record<string, unknown>[] }
  idx.packs[0].official = true
  idx.packs[0].sig = 'future'
  const s = signed(idx)
  const r = parseIndex(s.bytes, s.sig, opts())
  assert.ok(r.ok)
  if (r.ok) assert.equal('official' in r.index.packs[0], false)
})
test('철회: id 전체 / 버전 / 지문, 앱 버전, 다른 팩은 영향 없음', () => {
  const p = packEntry('sensor-check', '1.2.0', PACK)
  const idx = makeIndex([p], { revoked: [{ id: 'sensor-check', version: '1.1.0', reason: { ko: '가', en: 'a' }, at: '2026-10-30' }, { id: 'other-pack', reason: { ko: '가', en: 'a' }, at: '2026-10-30' }] })
  assert.equal(revokedFor(idx, 'sensor-check', '1.2.0', p.sha256), null)
  assert.ok(revokedFor(idx, 'sensor-check', '1.1.0', 'x'.repeat(64)))
  assert.ok(revokedFor(idx, 'other-pack', '9.9.9', 'x'.repeat(64)))
  const idx2 = makeIndex([p], { revoked: [{ id: 'sensor-check', sha256: p.sha256, reason: { ko: '가', en: 'a' }, at: '2026-10-30' }] })
  assert.ok(revokedFor(idx2, 'sensor-check', '1.2.0', p.sha256))
  assert.equal(revokedFor(idx2, 'sensor-check', '1.2.0', 'a'.repeat(64)), null)
  assert.equal(appVersionOk({ minApp: '5.6.0' }, '5.5.0'), false)
  assert.equal(appVersionOk({ minApp: '5.5.0' }, '5.5.0'), true)
  assert.equal(appVersionOk({}, '1.0.0'), true)
})
test('팩 파일: 크기 초과 / 크기 다름 / 지문 다름 / id·버전 다름', () => {
  const p = packEntry('sensor-check', '1.2.0', PACK)
  assert.equal(checkPackFile(p, PACK), null)
  assert.equal(checkPackFile(p, new Uint8Array(GALLERY_LIMITS.pack + 1)), 'too-big')
  assert.equal(checkPackFile(p, Buffer.from('{"format":2}x')), 'size-mismatch')
  assert.equal(checkPackFile(p, Buffer.from('{"format":2}')), 'hash-mismatch')
  assert.equal(checkPackIdentity(p, { id: 'sensor-check', version: '1.2.0' }), null)
  assert.equal(checkPackIdentity(p, { id: 'other-pack', version: '1.2.0' }), 'id-mismatch')
  assert.equal(checkPackIdentity(p, { id: 'sensor-check', version: '1.2.1' }), 'version-mismatch')
})
test('공개 열쇠 형식 검사, 앱에 박힌 열쇠는 최대 2자리·형식이 맞음', () => {
  assert.ok(publicKeyOf(K1.publicB64))
  for (const bad of ['', 'abc', 'A'.repeat(44), K1.publicB64.slice(1)]) assert.equal(publicKeyOf(bad), null, bad)
  assert.equal(verifySignature(Buffer.from('x'), 'A'.repeat(88), [K1.publicB64]), -1)
  assert.ok(GALLERY_KEYS.length <= 2)
  for (const k of GALLERY_KEYS) assert.ok(publicKeyOf(k), '앱에 박힌 공개 열쇠 형식')
})
