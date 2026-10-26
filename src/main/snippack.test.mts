import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePack } from './packschema.mts'
import { buildSnippetPack } from './snippack.mts'

test('snippack: 스니펫 → 터미널 항목 팩, 위험도는 앱 계산, 검증 통과', () => {
  const { text, exported, skipped } = buildSnippetPack(
    [
      { name: '상태', cmd: 'git -C ~/p status', enter: true },
      { name: '정리', cmd: 'sudo rm -rf /tmp/x', enter: false },
      { name: '비었음', cmd: '  ', enter: true }
    ],
    '5.0.0'
  )
  assert.equal(exported, 2)
  assert.equal(skipped, 1)
  const r = validatePack(JSON.parse(text), { official: false })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  const a = r.pack!.plugins[0].actions
  assert.deepEqual(a.map((x) => x.mode), ['terminal', 'terminal'])
  assert.equal(a[0].risk, 'read')
  assert.equal(a[1].risk, 'danger')
  assert.equal(a[1].enter, false)
})

test('snippack: 비밀처럼 보이는 값은 가려서 내보냄', () => {
  const { text, masked } = buildSnippetPack([{ name: 'k', cmd: 'export API_TOKEN=abc123def456', enter: true }], '5.0.0')
  assert.equal(masked, 1)
  assert.ok(!text.includes('abc123def456'))
})
