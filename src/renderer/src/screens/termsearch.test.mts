import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findAll, toLog } from './termsearch.mts'

test('findAll: 대소문자 무시, 한 줄에 여러 개, 빈 검색어는 없음', () => {
  assert.deepEqual(findAll(['Error: error', 'ok'], 'ERROR'), [{ row: 0, col: 0, len: 5 }, { row: 0, col: 7, len: 5 }])
  assert.equal(findAll(['Error'], 'ERROR', true).length, 0)
  assert.equal(findAll(['abc'], '').length, 0)
  assert.equal(findAll(['aaaa'], 'aa').length, 2)
})

test('toLog: 줄 끝 공백·끝 빈 줄 제거, 이어진 줄 합침', () => {
  assert.equal(toLog([{ text: 'a  ', wrapped: false }, { text: 'b', wrapped: true }, { text: 'c', wrapped: false }, { text: '  ', wrapped: false }]), 'a  b\nc\n')
})
