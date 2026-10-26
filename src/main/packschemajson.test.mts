import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LIMITS, RESERVED_IDS, validatePack } from './packschema.mts'

// docs/plugins/jdpack.schema.json (편집기용)과 검사기(packschema.mts)의 규칙이 어긋나지 않는지 대조
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = JSON.parse(rd('../../docs/plugins/jdpack.schema.json'))
const D = schema.definitions

test('schema: 제한 값이 검사기와 같음', () => {
  assert.equal(schema.properties.plugins.maxItems, LIMITS.plugins)
  assert.equal(D.plugin.properties.actions.maxItems, LIMITS.actionsPerPlugin)
  assert.equal(D.action.properties.cmd.maxLength, LIMITS.cmd)
  assert.equal(D.action.properties.timeout.maximum, LIMITS.timeoutExternal)
  assert.equal(D.param.properties.choices.maxItems, LIMITS.choices)
  assert.equal(D.display.properties.columns.maxItems, LIMITS.columns)
  assert.equal(D.display.properties.match.maxLength, LIMITS.matchLen)
  assert.deepEqual([...schema.properties.id.not.enum].sort(), [...RESERVED_IDS].sort())
})

test('schema: 예약어·id·선택지 값 패턴이 검사기 결과와 같음', () => {
  const idRe = new RegExp(schema.properties.id.pattern)
  const valRe = new RegExp(D.param.properties.choices.items.properties.value.pattern)
  const base = (id: string, value = 'a') => ({ id, format: 1, version: '1.0.0', name: 'x', plugins: [{ id: 'p', title: 't', actions: [{ id: 'a', label: 'l', cmd: 'echo {v}', risk: 'change', confirm: 'c', params: [{ name: 'v', label: 'v', choices: [{ value, label: 'x' }] }] }] }] })
  for (const id of ['abc', 'a-1', 'A', '1a', 'a_b', 'a'.repeat(41), 'x'.repeat(40)]) assert.equal(validatePack(base(id)).pack !== null, idRe.test(id), `id ${id}`)
  for (const v of ['a', '-a', 'a b', 'a;b', '~', '/var/log', 'a$b', 'a-b']) assert.equal(validatePack(base('abc', v)).errors.length === 0, valRe.test(v), `value ${v}`)
})

test('schema: 예제·공식 팩이 스키마를 통과함 (ajv가 있을 때; 예약 id는 바꿔서)', async () => {
  let Ajv: any
  try {
    Ajv = (await import('ajv')).default
  } catch {
    return // ajv는 직접 의존성이 아니라서 없으면 건너뜀
  }
  const validate = new Ajv({ strict: false }).compile(schema)
  for (const f of ['../../docs/plugins/examples/examples.jdpack.json', './packs/ros2.json', './packs/perf.json']) {
    assert.ok(validate({ ...JSON.parse(rd(f)), id: 'copy' }), `${f}: ${JSON.stringify(validate.errors)}`)
  }
})
