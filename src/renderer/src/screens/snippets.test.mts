import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keystrokes, parseSnippets, SNIPPET_DEFAULT } from './snippets.mts'

test('예전 빠른 명령(문자열 목록)이 스니펫으로 이어짐', () => {
  assert.deepEqual(parseSnippets(null, '["df -h","ls"]'), [
    { name: 'df -h', cmd: 'df -h', enter: true },
    { name: 'ls', cmd: 'ls', enter: true }
  ])
})

test('새 형식이 있으면 그것을 씀, 망가진 값은 걸러냄', () => {
  const raw = JSON.stringify([{ name: '', cmd: 'ls -la\npwd', enter: false }, { name: 'x', cmd: '  ' }, 7, null])
  assert.deepEqual(parseSnippets(raw, '["old"]'), [{ name: 'ls -la', cmd: 'ls -la\npwd', enter: false }])
  assert.deepEqual(parseSnippets('{bad', null), SNIPPET_DEFAULT)
  assert.deepEqual(parseSnippets('[]', '["old"]'), []) // 다 지운 상태는 기본값으로 되돌리지 않음
})

test('터미널에 쓸 글자', () => {
  assert.equal(keystrokes({ name: 'a', cmd: 'ls', enter: true }), 'ls\r')
  assert.equal(keystrokes({ name: 'a', cmd: 'cd /tmp\r\nls\n', enter: true }), 'cd /tmp\rls\r')
  assert.equal(keystrokes({ name: 'a', cmd: 'sudo apt install ', enter: false }), 'sudo apt install ')
})
