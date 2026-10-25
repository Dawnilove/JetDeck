import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionCommand, isSshUnit, isSvcAction, isUnit, parseAction, parseServices } from './svcparse.mts'

test('서비스 목록 해석 (설명에 공백, ● 없는 --plain 출력)', () => {
  const r = parseServices('ssh.service loaded active running OpenBSD Secure Shell server\nfoo.service not-found inactive dead foo.service\nbad.service loaded failed failed Bad thing\n')
  assert.equal(r.state, 'ok')
  if (r.state !== 'ok') return
  assert.deepEqual(r.services.map((s) => [s.unit, s.active, s.sub]), [['ssh.service', 'active', 'running'], ['foo.service', 'inactive', 'dead'], ['bad.service', 'failed', 'failed']])
  assert.equal(r.services[0].desc, 'OpenBSD Secure Shell server')
})

test('systemd 없음 · 오류', () => {
  assert.deepEqual(parseServices('__NOSYSTEMD__\n'), { state: 'nosystemd' })
  assert.deepEqual(parseServices('System has not been booted with systemd\n'), { state: 'error', text: 'System has not been booted with systemd' })
})

test('서비스 이름·동작 검사', () => {
  assert.ok(isUnit('ssh.service') && isUnit('getty@tty1.service') && isUnit('systemd-resolved.service'))
  for (const bad of ['ssh', 'a b.service', 'x;rm.service', '$(id).service', '', 5]) assert.ok(!isUnit(bad), String(bad))
  assert.ok(isSvcAction('stop') && !isSvcAction('disable') && !isSvcAction('mask'))
  assert.equal(actionCommand('start', 'a.service'), 'sudo -n systemctl start a.service 2>&1; echo __EXIT__$?')
  assert.ok(isSshUnit('ssh.service') && isSshUnit('sshd.service') && !isSshUnit('sshfs.service'))
})

test('동작 결과: 성공 · 비밀번호 필요 · 실패', () => {
  assert.deepEqual(parseAction('__EXIT__0\n'), { ok: true, needPassword: false, text: '' })
  assert.equal(parseAction('sudo: a password is required\n__EXIT__1\n').needPassword, true)
  const f = parseAction('Failed to start x.service: Unit x.service not found.\n__EXIT__5\n')
  assert.equal(f.ok, false)
  assert.equal(f.needPassword, false)
})
