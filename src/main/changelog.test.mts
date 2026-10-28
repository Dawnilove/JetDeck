import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releasesSince, releaseUrl, RELEASES } from './changelog.mts'

test('5.0.0 이후 항목: 버전당 최대 5개, 한 줄 짧게 (2026-10-28 규칙)', () => {
  for (const r of RELEASES.filter((x) => parseInt(x.version, 10) >= 5)) {
    assert.ok(r.ko.length <= 5, r.version)
    for (const l of r.ko) assert.ok(l.length <= 50, `${r.version} ko: ${l}`)
    for (const l of r.en) assert.ok(l.length <= 100, `${r.version} en: ${l}`)
  }
})
test('releaseUrl: 숫자.숫자.숫자만 릴리스 노트 주소가 됨', () => {
  assert.equal(releaseUrl('5.5.0'), 'https://github.com/Dawnilove/JetDeck/releases/tag/v5.5.0')
  for (const bad of ['', '5.5', '5.5.0/../x', 'v5.5.0', '5.5.0-beta', '5.5.0\n', 'javascript:1']) assert.equal(releaseUrl(bad), null, bad)
})

test('releasesSince: 건너뛴 버전을 모두, 최신순으로', () => {
  assert.deepEqual(releasesSince('2.2.2', '4.0.1').map((r) => r.version), ['4.0.1', '4.0.0'])
  assert.deepEqual(releasesSince('4.0.0', '4.0.1').map((r) => r.version), ['4.0.1'])
})
test('releasesSince: 같은 버전·지금보다 새 항목은 제외', () => {
  assert.deepEqual(releasesSince('4.0.1', '4.0.1'), [])
  assert.deepEqual(releasesSince('4.0.0', '4.0.0'), [])
  assert.deepEqual(releasesSince('1.0.0', '4.0.0').map((r) => r.version), ['4.0.0'])
})
test('releasesSince: 기록 없으면 지금 버전만 (10 > 9 숫자 비교)', () => {
  assert.deepEqual(releasesSince(null, '4.0.1').map((r) => r.version), ['4.0.1'])
  assert.deepEqual(releasesSince(null, '9.9.9'), [])
})
test('항목마다 한·영 개수가 같음', () => {
  for (const r of RELEASES) assert.equal(r.ko.length, r.en.length, r.version)
})
