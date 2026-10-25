import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDiag, scrub } from './diagbundle.mts'

test('scrub: 홈 경로·사용자·IP·.local·MAC·저장된 이름·비밀을 가림', () => {
  const o = { home: 'C:\\Users\\kim', user: 'kim', names: ['my-orin'] }
  assert.equal(scrub('open C:\\Users\\kim\\AppData\\x', o), 'open ~\\AppData\\x')
  assert.equal(scrub('open C:/Users/kim/x', o), 'open ~/x')
  assert.equal(scrub('connect 192.168.0.12 failed', o), 'connect <ip> failed')
  assert.equal(scrub('mydevice.local refused', o), '<host> refused')
  assert.equal(scrub('host my-orin down', o), 'host <name> down')
  assert.equal(scrub('aa:bb:cc:dd:ee:ff', o), '<mac>')
  assert.ok(!scrub('password=hunter2abc', o).includes('hunter2abc'))
})

test('buildDiag: 호스트는 개수만, 로그 줄은 가려서', () => {
  const t = buildDiag({
    version: '4.4.0', versions: { electron: '45' }, platform: 'win32', arch: 'x64', osRelease: '10', lang: 'ko',
    hosts: [{ kind: 'ssh', auth: 'key', port: 22 }, { kind: 'serial' }],
    acts: [{ t: 0, client: 'claude', tool: 'run_command', status: 'ok', ms: 12 }],
    logs: ['x error connect to 10.0.0.5 as kim'], scrubOpts: { user: 'kim' }, now: new Date(0)
  })
  assert.ok(t.includes('total 2') && t.includes('kind: ssh 1, serial 1'))
  assert.ok(t.includes('claude run_command ok 12ms'))
  assert.ok(!t.includes('10.0.0.5') && !t.includes('as kim'))
})
