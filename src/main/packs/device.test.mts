import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { validatePack } from '../packschema.mts'

// 동봉 팩이 검증을 모두 통과해야 함 (통과 못 한 항목은 앱에서 조용히 빠지므로 여기서 잡음)
test('device.json: 모든 항목이 검증을 통과', () => {
  const r = validatePack(JSON.parse(readFileSync(new URL('./device.json', import.meta.url), 'utf8')))
  assert.deepEqual(r.errors, [])
  assert.ok(r.pack && r.pack.pages.length >= 2)
  const all = r.pack!.pages.flatMap((p) => p.actions)
  for (const a of all) if (a.sudo) assert.ok(a.confirm, a.id)
})
