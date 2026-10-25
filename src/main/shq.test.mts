import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shq } from './shq.mts'

test('shq: 작은따옴표로 감싸고 안의 작은따옴표는 이스케이프', () => {
  assert.equal(shq("it's"), "'it'\\''s'")
  assert.equal(shq('a b $HOME'), "'a b $HOME'")
})
