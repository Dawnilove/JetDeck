import assert from 'node:assert/strict'
import { test } from 'node:test'
import { grepCommand, MAX_HITS, parseGrep, replaceText } from './searchparse.mts'

test('parseGrep: 경로\\0줄:내용 (경로·내용에 콜론이 있어도), 개수 제한', () => {
  const r = parseGrep('/a/b:c.py\x0012:x = 1:2\r\n/a/d.txt\x003:hi\nnoise\n')
  assert.deepEqual(r.hits, [{ path: '/a/b:c.py', line: 12, text: 'x = 1:2' }, { path: '/a/d.txt', line: 3, text: 'hi' }])
  assert.equal(r.truncated, false)
  const big = Array.from({ length: MAX_HITS + 1 }, (_, i) => `/f\x00${i + 1}:x`).join('\n')
  assert.deepEqual([parseGrep(big).hits.length, parseGrep(big).truncated], [MAX_HITS, true])
})
test('grepCommand: 옵션 조합', () => {
  assert.match(grepCommand("'/d'", "'q'", { regex: false, matchCase: false }), /grep -rnIZFi .* -e 'q' -- '\/d'/)
  assert.match(grepCommand("'/d'", "'q'", { regex: true, matchCase: true }), /grep -rnIZE /)
})
test('replaceText: 문자 그대로(특수문자·$ 포함)와 정규식, 대소문자', () => {
  assert.deepEqual(replaceText('a.b A.B ab', 'a.b', '$&x', { regex: false, matchCase: false }), { text: '$&x $&x ab', count: 2 })
  assert.deepEqual(replaceText('a.b A.B', 'a.b', 'z', { regex: false, matchCase: true }), { text: 'z A.B', count: 1 })
  assert.deepEqual(replaceText('v1 v22', 'v(\\d+)', '<$1>', { regex: true, matchCase: true }), { text: '<1> <22>', count: 2 })
  assert.deepEqual(replaceText('none', 'x', 'y', { regex: false, matchCase: true }), { text: 'none', count: 0 })
  assert.throws(() => replaceText('a', '', 'b', { regex: false, matchCase: true }))
})
