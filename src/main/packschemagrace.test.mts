import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, STOP_GRACE_MIN_APP, validatePack } from './packschema.mts'
import { analyze } from './risk.mts'

// 5.4.0: stopGrace(스트림 정지 유예) 형식 검사와, launch·bag이 읽기가 아님을 고정
const L = (s: string) => ({ ko: s, en: s })
const pack = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: STOP_GRACE_MIN_APP, plugins: [{ id: 'p', title: L('p'), actions }], ...extra })
const act = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ros2 launch pkg x.py', risk: 'change', confirm: L('x'), mode: 'stream', ...o })
const errs = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).errors.join('|')
const get = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).pack?.plugins[0].actions[0]

test('stopGrace: 3~10초(외부), 3~30초(공식), stream 전용', () => {
  assert.equal(get({})!.stopGrace, undefined) // 없으면 앱 기본(3초)
  assert.equal(get({ stopGrace: 3 })!.stopGrace, 3)
  assert.equal(get({ stopGrace: LIMITS.stopGraceExternal })!.stopGrace, 10)
  assert.match(errs({ stopGrace: 11 }), /stopGrace는 3~10초/)
  assert.match(errs({ stopGrace: 2 }), /stopGrace는 3~10초/)
  assert.match(errs({ stopGrace: '5' }), /stopGrace/)
  assert.match(errs({ stopGrace: Infinity }), /stopGrace/)
  assert.equal(get({ stopGrace: 30 }, true)!.stopGrace, 30)
  assert.match(errs({ stopGrace: 31 }, true), /3~30초/)
  assert.match(errs({ mode: 'exec', stopGrace: 5 }), /stream인 항목에서만/)
  assert.match(errs({ mode: 'terminal', stopGrace: 5 }), /stream인 항목에서만/)
})

test('stopGrace: 쓰는데 minApp이 낮으면 경고', () => {
  const r = validatePack(pack([act({ stopGrace: 5 })], { minApp: '5.3.0' }))
  assert.ok(r.pack)
  assert.ok(r.warnings.some((w) => /stopGrace/.test(w)))
  assert.equal(validatePack(pack([act({ stopGrace: 5 })])).warnings.length, 0)
})

test('ros2 launch·bag play·bag record는 읽기가 아님 (bag info/list만 읽기)', () => {
  for (const c of ['ros2 launch pkg x.py', 'ros2 launch pkg x.py arg:=1', 'ros2 bag play /tmp/b', 'ros2 bag play -l /tmp/b', 'ros2 bag record -a', 'ros2 bag record -o /tmp/b /chatter']) assert.notEqual(analyze(c).risk, 'read', c)
  for (const c of ['ros2 launch pkg x.py', 'ros2 bag play /tmp/b']) assert.notEqual(analyze(c, { stream: true }).risk, 'read', c)
})
