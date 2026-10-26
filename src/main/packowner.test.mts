import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { onOwnerGone, watchOwner } from './packowner.mts'

// 소유자 추적: 화면이 닫히거나·렌더러가 죽거나·메인 프레임이 새로 이동하면 등록된 정리 함수가 그 화면으로 불림
const wcOf = () => new EventEmitter() as never
const nav = (isMainFrame: boolean, isSameDocument: boolean) => ({ isMainFrame, isSameDocument })

test('destroyed · render-process-gone · 메인 프레임 새 이동에서 정리, 하위 프레임·같은 문서 이동은 무시', () => {
  const gone: object[] = []
  onOwnerGone((w) => gone.push(w))
  const a = wcOf()
  watchOwner(a)
  ;(a as EventEmitter).emit('did-start-navigation', nav(false, false)) // 하위 프레임
  ;(a as EventEmitter).emit('did-start-navigation', nav(true, true)) // #해시 이동 등
  assert.equal(gone.length, 0)
  ;(a as EventEmitter).emit('did-start-navigation', nav(true, false))
  assert.deepEqual(gone, [a])
  ;(a as EventEmitter).emit('render-process-gone')
  ;(a as EventEmitter).emit('destroyed')
  assert.equal(gone.length, 3)
  assert.ok(gone.every((w) => w === a))
})

test('같은 화면을 여러 번 감시해도 리스너는 한 번만 달리고, 정리 함수 여러 개가 모두 불림', () => {
  const calls: string[] = []
  onOwnerGone(() => calls.push('x'))
  onOwnerGone(() => calls.push('y'))
  const b = wcOf() as EventEmitter
  watchOwner(b as never)
  watchOwner(b as never)
  assert.equal(b.listenerCount('render-process-gone'), 1)
  assert.equal(b.listenerCount('did-start-navigation'), 1)
  const before = calls.length
  b.emit('render-process-gone')
  assert.deepEqual(calls.slice(before).sort(), ['x', 'y'])
})
