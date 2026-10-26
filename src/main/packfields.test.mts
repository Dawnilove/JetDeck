import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLang } from './i18n.mts'
import { charsetProblem, checkValue, parseFromOutput, renderValue, resolveFields, sampleCombos, type Field } from './packfields.mts'

const L = (s: string) => ({ ko: s, en: s })
const base = { label: L('x'), required: true }
const text = (o: Partial<Extract<Field, { type: 'text' }>> = {}): Field => ({ ...base, name: 't', type: 'text', charset: 'word', maxLen: 60, ...o })
const int = (min = 1, max = 100): Field => ({ ...base, name: 'n', type: 'int', min, max })
const path = (): Field => ({ ...base, name: 'p', type: 'path', maxLen: 300 })
const sel = (): Field => ({ ...base, name: 's', type: 'select', choices: [{ value: 'ssh', label: L('ssh') }, { value: 'docker', label: L('docker') }] })
const from = (charset: 'word' | 'ros' | 'path' = 'ros'): Field => ({ ...base, name: 'f', type: 'select', from: { cmd: 'ros2 topic list', shell: 'bash-i', timeout: 15, charset, max: 200 } })
const flag = (): Field => ({ ...base, name: 'g', type: 'flag', on: '--once', required: false })

test('글자 종류 검사: 맨 앞 -·제어 문자·길이·형식', () => {
  assert.equal(charsetProblem('word', 'abc_1.2-x', 60), null)
  for (const v of ['-rf', '--x', 'a b', 'a;b', 'a\nb', 'a$b', "a'b", 'a/b', '', '한글', 'a‮b']) assert.notEqual(charsetProblem('word', v, 60), null, JSON.stringify(v))
  assert.equal(charsetProblem('ros', '/camera/image_raw', 60), null)
  assert.equal(charsetProblem('ros', '~/x', 60), null)
  for (const v of ['-x', '/a b', '/a;b', '/a$(x)']) assert.notEqual(charsetProblem('ros', v, 60), null, v)
  assert.equal(charsetProblem('free', 'hello world; $(x) "q"', 60), null) // 자유 글자는 따옴표로 감싸서 넣음
  for (const v of ['-x', 'a\nb', 'a\rb', 'a\u0000b', '‮', 'x'.repeat(61)]) assert.notEqual(charsetProblem('free', v, 60), null, JSON.stringify(v))
  assert.equal(charsetProblem('path', '/home/u/a b', 300), null)
  for (const v of ['relative', '~/x', '/a/../etc', '/a\nb', '-x']) assert.notEqual(charsetProblem('path', v, 300), null, v)
})

test('값 검사와 끼워 넣을 글자', () => {
  assert.equal(checkValue(int(), '5'), null)
  for (const v of ['0', '101', '-1', '1.5', 'a', '', '١']) assert.notEqual(checkValue(int(), v), null, v)
  assert.equal(renderValue(int(), '007'), '7')
  assert.equal(checkValue(sel(), 'ssh'), null)
  assert.notEqual(checkValue(sel(), 'x; reboot'), null)
  assert.equal(renderValue(sel(), 'ssh'), 'ssh') // 고정 선택지는 팩이 쓴 값이라 그대로
  assert.equal(checkValue(from(), '/scan'), null)
  assert.notEqual(checkValue(from(), '/scan; reboot'), null)
  assert.equal(renderValue(from(), '/scan'), "'/scan'") // 기기가 준 값은 따옴표로
  assert.equal(renderValue(text({ charset: 'free' }), "it's"), "'it'\\''s'")
  assert.equal(renderValue(path(), '/tmp/a b'), "'/tmp/a b'")
  assert.equal(renderValue(flag(), 'true'), '--once')
  assert.equal(renderValue(flag(), 'false'), '')
  assert.notEqual(checkValue(flag(), 'yes'), null)
})

test('resolveFields: 기본값·선택 필드·틀린 값 거부', () => {
  const fs = [sel(), int(10, 500), flag(), text({ required: false })]
  assert.deepEqual(resolveFields(fs, {}), { s: 'ssh', n: '10', g: '', t: '' })
  assert.deepEqual(resolveFields(fs, { s: 'docker', n: '50', g: 'true', t: 'abc' }), { s: 'docker', n: '50', g: '--once', t: "'abc'" })
  assert.throws(() => resolveFields(fs, { n: '9999' }))
  assert.throws(() => resolveFields(fs, { s: 'x; reboot' }))
  assert.throws(() => resolveFields([text()], {}), /필요/) // 필수인데 빔
  assert.throws(() => resolveFields([text()], { t: '-rf' }))
  assert.throws(() => resolveFields([text({ charset: 'free' })], { t: 'a\nreboot' }))
  assert.equal(resolveFields([text({ default: 'abc' })], {}).t, "'abc'")
  assert.equal(resolveFields(undefined, { a: 'b' }) && Object.keys(resolveFields(undefined, { a: 'b' })).length, 0)
  // 화면이 보낸 값에 모르는 필드·객체·배열이 와도 무시/거부
  assert.throws(() => resolveFields([text()], { t: ['a'] as unknown as string }))
})

test('영어 화면에서도 값 검사 문장에 한글이 남지 않음', () => {
  setLang('en')
  try {
    for (const f of [int(), text(), sel(), path()]) for (const v of ['', '-x', 'a'.repeat(400), 'relative', '999999']) {
      const m = checkValue(f, v)
      if (m) assert.ok(!/[가-힣]/.test(m), m)
    }
  } finally {
    setLang('ko')
  }
})

test('위험도 계산용 대표 값 조합', () => {
  const c = sampleCombos([sel(), flag()], 500)!
  assert.equal(c.length, 4) // 선택지 2 × 플래그 2
  assert.ok(c.every((x) => /^(ssh|docker)$/.test(x.s)))
  assert.deepEqual(sampleCombos([text({ charset: 'ros' })], 500), [{ t: "'/sample'" }])
  assert.deepEqual(sampleCombos([path()], 500), [{ p: "'/tmp/sample'" }])
  assert.equal(sampleCombos(undefined, 10)!.length, 1)
  const big = Array.from({ length: 3 }, (_, i) => ({ ...base, name: `b${i}`, type: 'select', choices: Array.from({ length: 30 }, (_, k) => ({ value: `v${k}`, label: L('v') })) }) as Field)
  assert.equal(sampleCombos(big, 500), null)
})

test('from 목록 출력: 줄마다 검사, 중복 제거, 최대 개수', () => {
  const spec = { cmd: 'x', shell: 'sh' as const, timeout: 15, charset: 'ros' as const, max: 3 }
  assert.deepEqual(parseFromOutput(spec, '/a\n/b\r\n/a\n bad name \n/x;reboot\n-y\n\n/c\n/d\n'), ['/a', '/b', '/c'])
  assert.deepEqual(parseFromOutput({ ...spec, charset: 'word' }, 'ssh\ndocker\n/x\n'), ['ssh', 'docker'])
})
