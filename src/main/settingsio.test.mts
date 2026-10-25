import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildExport, hostKey, mergeSnippets, parseImport } from './settingsio.mts'

const host = { id: 'h1', name: 'jetson', host: 'a.local', port: 22, username: 'u', auth: 'password', keyPath: '', hasPassword: true, passwordEnc: 'SECRET', wake: { mac: 'x' } }

test('내보내기: id·비밀번호·MAC은 빠지고 스니펫 비밀은 가려짐', () => {
  const { text, masked } = buildExport({ hosts: [host], snippets: [{ name: 'a', cmd: 'export API_TOKEN=abc123', enter: true }, { name: 'b', cmd: 'ls', enter: false }], theme: 'dark', version: '4.3.0', now: new Date(0) })
  assert.ok(!/SECRET|h1|"mac"|abc123|hasPassword/.test(text))
  assert.equal(masked, 1)
  const back = parseImport(text)
  assert.deepEqual(back.hosts[0], { name: 'jetson', host: 'a.local', port: 22, username: 'u', auth: 'password', keyPath: '' })
  assert.deepEqual(back.snippets.map((s) => s.enter), [true, false])
  assert.equal(back.theme, 'dark')
})

test('가져오기: 다른 파일·깨진 파일은 거부, 이상한 항목은 건너뜀', () => {
  assert.throws(() => parseImport('not json'))
  assert.throws(() => parseImport('{"app":"x","format":1}'))
  const r = parseImport(JSON.stringify({ app: 'JetDeck', format: 1, hosts: [1, null, { name: 'x' }], snippets: [{ cmd: '  ' }, { cmd: 'ls' }, 'z'], theme: '../evil' }))
  assert.equal(r.hosts.length, 1)
  assert.deepEqual(r.snippets, [{ name: 'ls', cmd: 'ls', enter: true }])
  assert.equal(r.theme, '')
})

test('같은 기기 열쇠 · 스니펫 합치기', () => {
  assert.equal(hostKey({ host: 'A.local', port: 22, username: 'u' }), hostKey({ host: 'a.local', port: 22, username: 'u' }))
  assert.notEqual(hostKey({ host: 'a', port: 22, username: 'u' }), hostKey({ host: 'a', port: 2222, username: 'u' }))
  const m = mergeSnippets([{ name: 'a', cmd: 'ls', enter: true }], [{ name: 'a', cmd: 'ls', enter: true }, { name: 'b', cmd: 'pwd', enter: true }])
  assert.equal(m.added, 1)
  assert.equal(m.list.length, 2)
  const o = mergeSnippets([{ name: 'a', cmd: 'ls', enter: true }], [{ name: 'a', cmd: 'ls -l', enter: true }], true)
  assert.deepEqual([o.added, o.updated, o.list[0].cmd], [0, 1, 'ls -l'])
  assert.equal(mergeSnippets([{ name: 'a', cmd: 'ls', enter: true }], [{ name: 'a', cmd: 'ls -l', enter: true }]).added, 1)
})

test('mergeSnippets 덮어쓰기: 가려진 명령은 건너뛰고, 같은 이름이 여럿이어도 항목마다 하나씩', () => {
  const sn = (name: string, cmd: string) => ({ name, cmd, enter: true })
  const k = mergeSnippets([sn('dep', 'curl -H "token=real"')], [sn('dep', 'curl -H "token=••••"')], true)
  assert.deepEqual([k.kept, k.updated, k.list[0].cmd], [1, 0, 'curl -H "token=real"'])
  const d = mergeSnippets([sn('b', 'x')], [sn('b', 'make a'), sn('b', 'make b')], true)
  assert.deepEqual([d.updated, d.added, d.list.map((x) => x.cmd)], [1, 1, ['make a', 'make b']])
})
