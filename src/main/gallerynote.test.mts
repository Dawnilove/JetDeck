import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildView, type Listing, type ListError } from './galleryflow.mts'
import { errorText, galleryNotes } from './gallerynote.mts'

const fmt = (s: string) => s.slice(0, 10)
const o = { consent: true, safeMode: false, dev: false, appVersion: '5.5.0', installed: [] }
const list = (p: Partial<Listing>): Listing => ({ status: 'ok', expired: false, fromCache: false, packs: [], revoked: [], ...p })
const kinds = (l: Listing | null, extra: Partial<typeof o> = {}) => galleryNotes(buildView(l, { ...o, ...extra }), fmt)

test('모든 오류 코드에 쉬운 말이 있다', () => {
  const codes: ListError[] = ['too-big', 'bad-signature', 'bad-json', 'bad-format', 'rollback', 'no-keys', 'bad-url', 'redirect', 'http-status', 'timeout', 'network', 'aborted']
  for (const c of codes) assert.ok(errorText(c).length > 5, c)
  assert.equal(new Set(codes.map(errorText)).size, codes.length)
})

test('받기 전(idle)에는 안내가 없다', () => {
  assert.deepEqual(kinds(null), [])
})

test('오프라인: 저장본이 없으면 오류, 있으면 오프라인 목록 안내', () => {
  assert.equal(kinds(list({ status: 'offline', error: 'network' }))[0].kind, 'err')
  const pack = { id: 'abc' } as never
  const n = kinds(list({ status: 'offline', error: 'timeout', fromCache: true, fetchedAt: '2026-10-29T01:00:00Z', packs: [pack] }))
  assert.equal(n[0].kind, 'warn')
  assert.match(n[0].text, /2026-10-29/)
  assert.equal(n[1].text, errorText('timeout'))
})

test('서명 틀림·옛 목록·열쇠 없음은 믿을 수 없다는 오류와 이유', () => {
  for (const e of ['bad-signature', 'rollback', 'no-keys'] as const) {
    const n = kinds(list({ status: 'untrusted', error: e }))
    assert.equal(n[0].kind, 'err')
    assert.ok(n[0].text.includes(errorText(e)))
  }
})

test('만료는 경고, 안전 모드는 따로 경고, 정상은 서명 확인됨', () => {
  assert.equal(kinds(list({ expired: true }))[0].kind, 'warn')
  assert.ok(kinds(list({ fetchedAt: '2026-10-29T01:00:00Z' }))[0].text.includes('✔'))
  assert.ok(kinds(list({}), { safeMode: true }).some((n) => n.kind === 'warn' && n.text.includes('안전 모드')))
})
