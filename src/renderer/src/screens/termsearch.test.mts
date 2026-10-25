import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRow, findAll, toCells, toLog } from './termsearch.mts'

test('findAll: 대소문자 무시, 한 줄에 여러 개, 빈 검색어는 없음', () => {
  assert.deepEqual(findAll(['Error: error', 'ok'], 'ERROR'), [{ row: 0, col: 0, len: 5 }, { row: 0, col: 7, len: 5 }])
  assert.equal(findAll(['Error'], 'ERROR', true).length, 0)
  assert.equal(findAll(['abc'], '').length, 0)
  assert.equal(findAll(['aaaa'], 'aa').length, 2)
})

test('toLog: 줄 끝 공백·끝 빈 줄 제거, 이어진 줄 합침', () => {
  assert.equal(toLog([{ text: 'a  ', wrapped: false }, { text: 'b', wrapped: true }, { text: 'c', wrapped: false }, { text: '  ', wrapped: false }]), 'a  b\nc\n')
})

test('buildRow·toCells: 한글(2칸)·이모지 뒤 일치도 셀 열로 맞춤', () => {
  const cells = [{ chars: '한', width: 2 }, { chars: '', width: 0 }, { chars: '글', width: 2 }, { chars: '', width: 0 }, { chars: ' ', width: 1 }, { chars: 'a', width: 1 }, { chars: 'b', width: 1 }, { chars: '', width: 1 }, { chars: '', width: 1 }]
  const r = buildRow(cells, false)
  assert.equal(r.text, '한글 ab')
  assert.deepEqual(findAll([r.text], 'ab').map((h) => toCells(r, h)), [{ row: 0, col: 5, len: 2 }])
  assert.deepEqual(toCells(r, { row: 0, col: 0, len: 2 }), { row: 0, col: 0, len: 4 })
  const e = buildRow([{ chars: '😀', width: 2 }, { chars: '', width: 0 }, { chars: 'x', width: 1 }], true)
  assert.deepEqual(toCells(e, { row: 0, col: 2, len: 1 }), { row: 0, col: 2, len: 1 })
  assert.equal(e.wrapped, true)
})
