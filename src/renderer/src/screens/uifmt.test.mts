import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fmtSize, fuzzy, sshCommand } from './uifmt.mts'
import { DANGER } from './snippets.mts'

test('fuzzy: 글자가 순서대로 있으면 일치, 연속으로 맞을수록 점수가 높음', () => {
  assert.notEqual(fuzzy('nvq', 'nvpmodel -q'), null)
  assert.equal(fuzzy('xyz', 'nvpmodel'), null)
  assert.ok(fuzzy('전원', '전원 모드: 25W로 전환')! > fuzzy('전원', '전기 원격')!)
})

test('fmtSize: 단위', () => {
  assert.equal(fmtSize(412), '412 B')
  assert.equal(fmtSize(12.2 * 1024 * 1024), '12.2 MB')
})

test('sshCommand: 포워딩 규칙과 같은 ssh 명령', () => {
  assert.equal(sshCommand('L', '8888', '8888', 'u@h'), 'ssh -L 8888:localhost:8888 u@h')
  assert.equal(sshCommand('D', '1080', '', 'u@h'), 'ssh -D 1080 u@h')
})

test('DANGER: 실행 전에 확인할 스니펫', () => {
  assert.ok(DANGER.test('sudo reboot') && DANGER.test('rm -rf x'))
  assert.ok(!DANGER.test('df -h') && !DANGER.test('nvpmodel -q'))
})
