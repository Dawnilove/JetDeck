import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readOnlyProblem, validatePack } from './packschema.mts'

const L = (s: string) => ({ ko: s, en: s })
const pack = (actions: unknown[]) => ({ id: 't', format: 1, name: L('t'), pages: [{ id: 'p', title: L('p'), actions }] })
const act = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', ...o })
const errs = (o: Record<string, unknown>) => validatePack(pack([act(o)])).errors.join('|')
const ok = (o: Record<string, unknown>) => assert.equal(validatePack(pack([act(o)])).pack?.pages[0].actions.length, 1, errs(o))

test('올바른 항목은 통과', () => {
  ok({})
  ok({ cmd: 'apt list --upgradable 2>/dev/null', display: { type: 'table', match: '^(\\S+)/(\\S+)$', columns: [L('a'), L('b')] } })
  ok({ risk: 'danger', sudo: true, cmd: 'apt-get -y upgrade', confirm: L('x'), preview: 'apt-get -s upgrade | grep ^Inst' })
  ok({ risk: 'change', sudo: true, cmd: 'shutdown -r +{min}', confirm: L('x'), params: [{ name: 'min', label: L('m'), choices: [{ value: '5', label: L('5') }] }] })
  ok({ cmd: 'systemctl get-default; ls /var/run/reboot-required 2>/dev/null' })
})

test('읽기 항목: sudo·쓰기·삭제 명령은 거부', () => {
  assert.match(errs({ sudo: true }), /sudo/)
  for (const c of ['rm -rf x', 'echo a > f', 'systemctl restart ssh', 'apt-get update', 'apt install x', 'journalctl --vacuum-size=1M', 'reboot', 'ls; sudo ls', 'kill 1']) assert.match(errs({ cmd: c }), /읽기 항목인데/, c)
  assert.equal(readOnlyProblem('apt-get -s upgrade'), null)
  assert.equal(readOnlyProblem('apt list --upgradable'), null)
  assert.equal(readOnlyProblem('du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -15'), null)
})

test('바꾸는 항목: confirm 필수, sudo는 단일 명령만', () => {
  assert.match(errs({ risk: 'change', cmd: 'shutdown -c' }), /confirm/)
  assert.match(errs({ risk: 'change', sudo: true, cmd: 'a | b', confirm: L('x') }), /단일 명령/)
  assert.match(errs({ risk: 'change', sudo: true, cmd: 'sudo reboot', confirm: L('x') }), /sudo를 쓰지/)
  assert.match(errs({ risk: 'change', cmd: 'ls', confirm: L('x'), auto: true }), /auto/)
})

test('설치·정리·삭제는 preview 필수, preview는 읽기 전용', () => {
  for (const c of ['apt-get -y upgrade', 'apt-get -y autoremove', 'apt-get clean', 'journalctl --vacuum-size=200M']) assert.match(errs({ risk: 'danger', sudo: true, cmd: c, confirm: L('x') }), /preview가 필요/, c)
  assert.match(errs({ risk: 'danger', sudo: true, cmd: 'apt-get clean', confirm: L('x'), preview: 'apt-get clean' }), /preview는 읽기 전용/)
})

test('막힌 경로를 지우는 항목은 거부', () => {
  for (const c of ['rm -rf /', 'rm -rf /etc', 'rm -r /usr/lib/x', 'rm -rf ~', 'rm -rf /var', 'rm -rf /opt/nvidia/x', 'dd if=/dev/zero of=/dev/sda'])
    assert.match(errs({ risk: 'danger', sudo: true, cmd: c, confirm: L('x'), preview: 'ls' }), /막힌 경로|단일|막힌/, c)
  ok({ risk: 'danger', sudo: true, cmd: 'rm -rf /var/cache/apt/archives/partial', confirm: L('x'), preview: 'ls /var/cache/apt/archives/partial' })
})

test('params: 자리표시자에 맞는 선택지 필요, 값에 셸 특수문자 금지', () => {
  assert.match(errs({ cmd: 'ls {dir}' }), /params가 없어요/)
  assert.match(errs({ cmd: 'ls {dir}', params: [{ name: 'dir', label: L('d'), choices: [{ value: '/x; rm -rf /', label: L('x') }] }] }), /선택지가 올바르지/)
  ok({ cmd: 'du {dir}', params: [{ name: 'dir', label: L('d'), choices: [{ value: '~', label: L('h') }, { value: '/var', label: L('v') }] }] })
})

test('표시 방식 검사: 묶음 개수·잘못된 정규식·글자쌍', () => {
  assert.match(errs({ display: { type: 'table', match: '^(a)(b)$', columns: [L('a')] } }), /묶음 개수/)
  assert.match(errs({ display: { type: 'table', match: '(', columns: [L('a')] } }), /정규식/)
  assert.match(errs({ display: { type: 'table', columns: [L('a')] } }), /match 또는 split/)
  assert.match(errs({ label: { ko: '가' } }), /label/)
  ok({ display: { type: 'table', split: 'ws', skip: 1, columns: [L('a'), L('b')] } })
})

test('잘못된 항목만 빼고 나머지는 남김, id는 팩 전체에서 하나', () => {
  const r = validatePack(pack([act({ id: 'good' }), act({ id: 'bad', cmd: 'rm x' }), act({ id: 'good' })]))
  assert.deepEqual(r.pack?.pages[0].actions.map((a) => a.id), ['good'])
  assert.equal(r.errors.length, 2)
  assert.equal(validatePack({ id: 'x' }).pack, null)
})

test('표의 labels: {값: {ko, en}}만 허용', () => {
  ok({ display: { type: 'table', match: '^(a)=(b)$', columns: [L('a'), L('b')], labels: { a: L('에이') } } })
  assert.match(errs({ display: { type: 'table', match: '^(a)=(b)$', columns: [L('a'), L('b')], labels: { a: '에이' } } }), /labels/)
})
