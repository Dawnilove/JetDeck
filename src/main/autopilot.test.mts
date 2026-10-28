// 실행: npm test
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  checkInitialAutopilot,
  isAutopilot,
  loadAutopilotConfig,
  requiresApproval,
  saveAutopilotConfig,
  setAutopilot
} from './autopilot.mts'

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
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: 'FALSE' }), false)
  assert.equal(checkInitialAutopilot({ JETDECK_AUTOPILOT: '' }), undefined)
  assert.equal(checkInitialAutopilot({}), undefined)
})

test('오토파일럿 설정 로드 우선순위: CLI 스위치 > 환경 변수 > 설정 파일 > 기본값', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'jetdeck-autopilot-'))
  const file = join(tmp, 'autopilot.json')
  try {
    // 1. 파일에 true가 있어도 CLI no-autopilot이 우선
    writeFileSync(file, JSON.stringify({ autopilot: true }))
    assert.equal(loadAutopilotConfig(file, { JETDECK_AUTOPILOT: '1' }, (s) => s === 'no-autopilot'), false)

    // 2. 파일에 false가 있어도 CLI autopilot이 우선
    writeFileSync(file, JSON.stringify({ autopilot: false }))
    assert.equal(loadAutopilotConfig(file, { JETDECK_AUTOPILOT: '0' }, (s) => s === 'autopilot'), true)

    // 3. 파일에 true가 있어도 환경 변수 JETDECK_AUTOPILOT=0이 우선 비활성화
    writeFileSync(file, JSON.stringify({ autopilot: true }))
    assert.equal(loadAutopilotConfig(file, { JETDECK_AUTOPILOT: '0' }), false)

    // 4. 파일에 false가 있어도 환경 변수 JETDECK_AUTOPILOT=1이 우선 활성화
    writeFileSync(file, JSON.stringify({ autopilot: false }))
    assert.equal(loadAutopilotConfig(file, { JETDECK_AUTOPILOT: '1' }), true)

    // 5. 환경 변수 미지정 시 파일 설정 사용
    writeFileSync(file, JSON.stringify({ autopilot: true }))
    assert.equal(loadAutopilotConfig(file, {}), true)
    writeFileSync(file, JSON.stringify({ autopilot: false }))
    assert.equal(loadAutopilotConfig(file, {}), false)

    // 6. 파일이 없거나 JSON이 깨진 경우 안전한 기본값(false)
    assert.equal(loadAutopilotConfig(join(tmp, 'nonexistent.json'), {}), false)
    writeFileSync(file, '{ broken json: ')
    assert.equal(loadAutopilotConfig(file, {}), false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('saveAutopilotConfig 저장 및 재로드', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'jetdeck-autopilot-save-'))
  const file = join(tmp, 'sub', 'autopilot.json')
  try {
    saveAutopilotConfig(file, true)
    assert.equal(loadAutopilotConfig(file, {}), true)

    saveAutopilotConfig(file, false)
    assert.equal(loadAutopilotConfig(file, {}), false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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

