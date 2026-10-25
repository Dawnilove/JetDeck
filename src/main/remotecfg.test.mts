import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLaunch, cleanRemote } from './remotecfg.mts'

test('cleanRemote: 종류 없음 = 사용 안 함, 포트 비우면 기본값, 터널 기본 켬', () => {
  assert.deepEqual(cleanRemote('', '', true), {})
  assert.deepEqual(cleanRemote('telnet', 23, true), {})
  assert.deepEqual(cleanRemote('vnc', '', undefined), { remote: 'vnc', remotePort: 5900, remoteTunnel: true })
  assert.deepEqual(cleanRemote('rdp', 3390, false), { remote: 'rdp', remotePort: 3390, remoteTunnel: false })
})

test('cleanRemote: 잘못된 포트는 거부', () => {
  for (const p of [0, 70000, 1.5, 'abc']) assert.throws(() => cleanRemote('vnc', p, true), /1~65535/)
})

test('buildLaunch: RDP는 Windows에서 mstsc, VNC는 vnc:// 주소', () => {
  assert.deepEqual(buildLaunch('rdp', '127.0.0.1', 50123, 'win32'), { cmd: 'mstsc', args: ['/v:127.0.0.1:50123'] })
  assert.deepEqual(buildLaunch('rdp', 'h.local', 3389, 'linux'), { url: 'rdp://full%20address=s:h.local:3389' })
  assert.deepEqual(buildLaunch('vnc', '127.0.0.1', 50124, 'win32'), { url: 'vnc://127.0.0.1:50124' })
  assert.deepEqual(buildLaunch('vnc', 'fe80::1', 5900, 'win32'), { url: 'vnc://[fe80::1]:5900' })
})
