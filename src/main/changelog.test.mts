import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releasesSince, RELEASES } from './changelog.mts'

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
