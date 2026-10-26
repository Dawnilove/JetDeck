import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { LIMITS, RESERVED_IDS, validatePack } from './packschema.mts'
import { FIELD_LIMITS } from './packfields.mts'

// docs/plugins/jdpack.schema.json (편집기용)과 검사기(packschema.mts)의 규칙이 어긋나지 않는지 대조
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = JSON.parse(rd('../../docs/plugins/jdpack.schema.json'))
const D = schema.definitions

test('schema: 제한 값이 검사기와 같음', () => {
  assert.equal(schema.properties.plugins.maxItems, LIMITS.plugins)
  assert.equal(D.plugin.properties.actions.maxItems, LIMITS.actionsPerPlugin)
  assert.equal(D.action.properties.cmd.maxLength, LIMITS.cmd)
  assert.equal(D.action.properties.timeout.maximum, LIMITS.timeoutStreamExternal)
  assert.equal(D.field.properties.choices.maxItems, LIMITS.choices)
  assert.equal(D.action.properties.fields.maxItems, FIELD_LIMITS.fields)
  assert.equal(D.display.properties.maxLines.maximum, LIMITS.logMax)
  assert.equal(D.display.properties.maxLines.minimum, LIMITS.logMin)
  assert.equal(D.param.properties.choices.maxItems, LIMITS.choices)
  assert.equal(D.display.properties.columns.maxItems, LIMITS.columns)
  assert.equal(D.display.properties.match.maxLength, LIMITS.matchLen)
  assert.deepEqual([...schema.properties.id.not.enum].sort(), [...RESERVED_IDS].sort())
})

test('schema: 그래프 상수가 검사기(LIMITS)와 같음', () => {
  const P = D.display.properties
  assert.equal(P.every.minimum, LIMITS.chartEveryOfficial) // 외부 팩의 1초 하한은 설명 글로만 표현
  assert.equal(P.every.maximum, LIMITS.chartEveryMax)
  assert.equal(P.every.default, LIMITS.chartEveryDefault)
  assert.equal(P.points.minimum, LIMITS.chartPointsMin)
  assert.equal(P.points.maximum, LIMITS.chartPointsMax)
  assert.equal(P.points.default, LIMITS.chartPointsDefault)
  assert.equal(P.unit.maxLength, LIMITS.chartUnit)
  assert.equal(P.series.maxItems, LIMITS.chartLines)
  assert.equal(P.series.items.properties.col.maximum, LIMITS.chartCols)
  for (const x of [P.min, P.max, P.perLine.properties.scale, P.series.items.properties.scale]) assert.equal(x.maximum, LIMITS.chartValueMax)
  assert.match(P.every.description, /at least 1/)
  assert.deepEqual(P.split.enum, ['ws', 'tab', 'csv'])
  assert.ok(P.type.enum.includes('chart'))
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
  for (const f of ['../../docs/plugins/examples/examples.jdpack.json', './packs/ros2.json', './packs/ros2live.json', './packs/perf.json']) {
    assert.ok(validate({ ...JSON.parse(rd(f)), id: 'copy' }), `${f}: ${JSON.stringify(validate.errors)}`)
  }
  // 그래프: match/split, perLine/series는 정확히 하나
  const pack = (display: unknown) => ({ id: 'copy', format: 1, version: '1.0.0', name: 'x', plugins: [{ id: 'p', title: 't', actions: [{ id: 'a', label: 'l', cmd: 'cat /proc/loadavg', risk: 'read', display }] }] })
  const ok = { type: 'chart', split: 'ws', series: [{ label: 'a', col: 1 }] }
  assert.ok(validate(pack(ok)), JSON.stringify(validate.errors))
  assert.ok(!validate(pack({ ...ok, match: '^(.*)$' })), 'match+split')
  assert.ok(!validate(pack({ type: 'chart', split: 'ws' })), 'perLine/series 없음')
  assert.ok(!validate(pack({ ...ok, perLine: { label: 'a', value: 1 } })), 'perLine+series')
  assert.ok(!validate(pack({ ...ok, points: 5 })), 'points 한도')
})
