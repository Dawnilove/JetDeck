import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BADGE_TONES, LIMITS, PERM_KINDS, PERM_MIN_APP, PERM_OPS, RESERVED_IDS, validatePack } from './packschema.mts'
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
  assert.equal(D.action.properties.stopGrace.minimum, LIMITS.stopGraceMin)
  assert.equal(D.action.properties.stopGrace.maximum, LIMITS.stopGraceOfficial) // 외부 팩의 10초 상한은 설명 글로만 표현
  assert.match(D.action.properties.stopGrace.description, new RegExp(`max ${LIMITS.stopGraceExternal}`))
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

test('schema: 배지 상수가 검사기(LIMITS)와 같음', () => {
  const B = D.badge.properties
  assert.equal(schema.properties.badges.maxItems, LIMITS.badges)
  assert.equal(B.cmd.maxLength, LIMITS.cmd)
  assert.equal(B.match.maxLength, LIMITS.matchLen)
  assert.equal(B.codes.maxProperties, LIMITS.badgeCodes)
  assert.equal(B.codes.additionalProperties.properties.show.maxLength, LIMITS.badgeShow)
  assert.equal(B.ttl.minimum, LIMITS.badgeTtlMin)
  assert.equal(B.ttl.maximum, LIMITS.badgeTtlMax)
  assert.equal(B.ttl.default, LIMITS.badgeTtlDefault)
  assert.equal(B.timeout.maximum, LIMITS.badgeTimeoutMax)
  assert.equal(B.timeout.default, LIMITS.badgeTimeoutDefault)
  assert.deepEqual(B.codes.additionalProperties.properties.tone.enum, BADGE_TONES)
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
  for (const f of ['../../docs/plugins/examples/examples.jdpack.json', './packs/ros2.json', './packs/ros2live.json', './packs/perf.json', './packs/devtools.json']) {
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

test('schema: 권한 상수가 검사기(LIMITS)와 같음', () => {
  const P = D.permission.properties
  assert.equal(schema.properties.permissions.maxItems, LIMITS.permsOfficial) // 외부 팩의 3개 상한은 설명 글로만 표현
  assert.deepEqual(P.kind.enum, PERM_KINDS)
  assert.equal(P.root.maxLength, LIMITS.permRoot)
  assert.equal(P.maxBytes.maximum, LIMITS.permBytesMax)
  assert.equal(P.maxBytes.default, LIMITS.permBytesDefault)
  assert.equal(P.maxMinutes.maximum, LIMITS.tunnelMinutesMax)
  assert.equal(P.maxMinutes.default, LIMITS.tunnelMinutesDefault)
  assert.equal(P.remotePort.minimum, 1024)
  assert.equal(D.action.properties.path.maxLength, LIMITS.permPath)
  assert.deepEqual(D.action.properties.op.enum.sort(), [...new Set(Object.values(PERM_OPS).flat())].sort())
  assert.ok(D.action.properties.mode.enum.includes('app'))
  assert.match(schema.then.properties.minApp.pattern, /\[6-9\]/)
  assert.equal(new RegExp(schema.then.properties.minApp.pattern).test(PERM_MIN_APP), true)
  assert.equal(new RegExp(schema.then.properties.minApp.pattern).test('5.9.9'), false)
  assert.equal(new RegExp(P.id.pattern).test('ab'), true)
  assert.equal(new RegExp(P.root.pattern).test('~/logs/a'), true)
  for (const r of ['~', '~/', '/x', '~/a//b']) assert.equal(new RegExp(P.root.pattern).test(r), false, r)
})

test('schema: 권한 팩이 스키마와 검사기에서 같은 결과 (ajv가 있을 때)', async () => {
  let Ajv: any
  try {
    Ajv = (await import('ajv')).default
  } catch {
    return
  }
  const validate = new Ajv({ strict: false }).compile(schema)
  const L = (s: string) => ({ ko: s, en: s })
  const base = (over: Record<string, unknown> = {}, perm: Record<string, unknown> = {}, action: Record<string, unknown> = {}) => ({
    id: 'copy', format: 1, version: '1.0.0', minApp: '6.0.0', name: 'x',
    permissions: [{ id: 'logs', kind: 'sftp.read', root: '~/logs', why: 'x', ...perm }],
    plugins: [{ id: 'p', title: 't', actions: [{ id: 'a', label: 'l', mode: 'app', perm: 'logs', op: 'list', ...action }] }], ...over
  })
  assert.ok(validate(base()), JSON.stringify(validate.errors))
  assert.ok(validate({ ...base(), permissions: [{ id: 'web', kind: 'tunnel', remotePort: 8888, why: L('x') }], plugins: [{ id: 'p', title: 't', actions: [{ id: 'a', label: 'l', mode: 'app', perm: 'web', op: 'open' }] }] }), JSON.stringify(validate.errors))
  const agree = (o: unknown, want: boolean, why: string) => {
    assert.equal(!!validate(o), want, `schema: ${why} ${JSON.stringify(validate.errors)}`)
    assert.equal(validatePack(o).errors.length === 0 && validatePack(o).pack !== null, want, `app: ${why}`)
  }
  agree(base(), true, 'ok')
  agree(base({ minApp: '5.9.0' }), false, 'minApp 낮음')
  agree(base({ minApp: undefined }), false, 'minApp 없음')
  agree(base({}, { root: '~' }), false, 'root ~')
  agree(base({}, { root: '/etc' }), false, 'root 절대')
  agree(base({}, { kind: 'serial.read' }), false, '모르는 kind')
  agree(base({}, { why: undefined }), false, 'why 없음')
  agree(base({}, { remotePort: 8888 }), false, 'sftp에 remotePort')
  agree(base({}, { maxBytes: 21 * 1024 * 1024 }), false, 'maxBytes 초과')
  agree(base({}, {}, { cmd: 'ls' }), false, 'app 항목에 cmd')
  agree(base({}, {}, { auto: true }), false, 'app 항목에 auto')
  agree(base({}, {}, { op: undefined }), false, 'op 없음')
  agree(base({}, {}, { perm: undefined }), false, 'perm 없음')
})
