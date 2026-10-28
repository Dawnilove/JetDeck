// 실행: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkInitialAutopilot, isAutopilot, requiresApproval, setAutopilot } from './autopilot.mts'

test('오토파일럿 기본값은 꺼짐(false)', () => {
  setAutopilot(false)
  assert.equal(isAutopilot(), false)
})

test('오토파일럿 모드 토글', () => {
  setAutopilot(true)
  assert.equal(isAutopilot(), true)
  setAutopilot(false)
  assert.equal(isAutopilot(), false)
})

test('환경 변수(JETDECK_AUTOPILOT) 감지', () => {
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: '1' }), true)
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: 'true' }), true)
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: 'TRUE' }), true)
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: '0' }), false)
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: 'false' }), false)
  assert.equal(checkInitialAutopilot({}), false)
})

test('오토파일럿 꺼짐 시 위험한 명령은 승인 필요', () => {
  setAutopilot(false)
  const dangerCommands = [
    'sudo reboot',
    'rm -rf /tmp/test',
    'kill -9 1234',
    'pkill python',
    'echo hello > /etc/config',
    'apt update',
    'git push --force'
  ]
  for (const cmd of dangerCommands) {
    assert.equal(requiresApproval(cmd, false), true, `명령이 승인을 요구해야 함: ${cmd}`)
  }
})

test('오토파일럿 켜짐 시 위험한 명령도 승인 없이 통과', () => {
  setAutopilot(true)
  const dangerCommands = [
    'sudo reboot',
    'rm -rf /tmp/test',
    'kill -9 1234',
    'pkill python',
    'echo hello > /etc/config',
    'apt update',
    'git push --force'
  ]
  for (const cmd of dangerCommands) {
    assert.equal(requiresApproval(cmd, true), false, `오토파일럿 모드에서는 승인이 생략되어야 함: ${cmd}`)
  }
  setAutopilot(false)
})

test('일반 명령은 오토파일럿 여부와 무관하게 승인 불필요', () => {
  const safeCommands = [
    'ls -la',
    'pwd',
    'nvidia-smi',
    'tegrastats',
    'cat /proc/cpuinfo',
    'echo test >> test.log'
  ]
  for (const cmd of safeCommands) {
    assert.equal(requiresApproval(cmd, false), false, `일반 명령은 승인 불필요: ${cmd}`)
    assert.equal(requiresApproval(cmd, true), false, `일반 명령은 승인 불필요: ${cmd}`)
  }
})
