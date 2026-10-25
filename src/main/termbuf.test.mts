import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanTerm, dropTerm, pushTerm, rawTerm, tailLines } from './termbuf.mts'

test('제어 문자 제거·덮어쓰기·백스페이스', () => {
  assert.equal(cleanTerm('\x1b[32mok\x1b[0m done\r\n'), 'ok done\n')
  assert.equal(cleanTerm('50%\r100%\r\nend'), '100%\nend')
  assert.equal(cleanTerm('ab\x08c'), 'ac')
  assert.equal(cleanTerm('\x1b]0;title\x07$ ls'), '$ ls')
})

test('마지막 n줄', () => {
  assert.equal(tailLines('a\nb\nc\n\n', 2), 'b\nc')
  assert.equal(tailLines('a', 100), 'a')
})

test('버퍼는 최근 것만 남기고 닫으면 지움', () => {
  pushTerm('t', 'x'.repeat(250_000))
  assert.equal(rawTerm('t').length, 200_000)
  dropTerm('t')
  assert.equal(rawTerm('t'), '')
})
