import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LiveSet } from './liveset.mts'

const chan = () => {
  const c = { closed: 0, close: () => void c.closed++ }
  return c
}

test('LiveSet: 열린 뒤 정지하면 닫음', () => {
  const s = new LiveSet<ReturnType<typeof chan>>()
  const c = chan()
  s.begin('a')
  assert.equal(s.attach('a', c), true)
  s.stop('a')
  assert.equal(c.closed, 1)
  s.remove('a', c)
  assert.equal(s.size, 0)
})

test('LiveSet: 여는 중에 정지하면 열리자마자 닫음', () => {
  const s = new LiveSet<ReturnType<typeof chan>>()
  const c = chan()
  s.begin('a')
  s.stop('a')
  assert.equal(s.attach('a', c), false)
  assert.equal(c.closed, 1)
  assert.equal(s.size, 0)
})

test('LiveSet: 모르는 id 정지는 무시, 실패하면 정리', () => {
  const s = new LiveSet<ReturnType<typeof chan>>()
  s.stop('x')
  assert.equal(s.size, 0)
  s.begin('b')
  s.fail('b')
  assert.equal(s.size, 0)
})
