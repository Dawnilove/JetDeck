import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BADGE_GIT_GUARD, buildFrom, buildPoll, buildPreview, buildRun, buildStream, buildTerminal, fill, parseResult, resolveParams, toRows } from './packrun.mts'
import type { PackAction } from './packschema.mts'

const L = (s: string) => ({ ko: s, en: s })
const A = (o: Partial<PackAction>): PackAction => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', declared: 'read', computed: 'read', reasons: [], understated: false, mode: 'exec', shell: 'sh', ...o })

test('명령 만들기: sudo -n, 선택값 채우기, 종료 코드 붙이기', () => {
  const a = A({ risk: 'change', sudo: true, cmd: 'shutdown -r +{min}', confirm: L('x'), params: [{ name: 'min', label: L('m'), choices: [{ value: '5', label: L('5') }, { value: '30', label: L('30') }] }] })
  const v = resolveParams(a, { min: '30' })
  const r = buildRun(a, v)
  assert.ok(r.command.startsWith('timeout 60 sh -c '))
  assert.ok(r.command.includes('sudo -n shutdown -r +30') && r.command.includes('__EXIT__$?'))
  assert.equal(r.termCmd, 'sudo shutdown -r +30')
  assert.deepEqual(resolveParams(a), { min: '5' }) // 안 보내면 첫 선택지
  assert.throws(() => resolveParams(a, { min: '1; reboot' }))
  assert.equal(fill('a {x} {x}', { x: '1' }), 'a 1 1')
})

test('읽기 명령은 sudo 없이, 미리보기는 preview 명령, 시간 제한', () => {
  assert.ok(!buildRun(A({ cmd: 'df -hP' }), {}).command.includes('sudo'))
  assert.ok(buildPreview(A({ cmd: 'apt-get clean', preview: 'du -sh /var/cache/apt' }), {}).includes('du -sh /var/cache/apt'))
  assert.ok(buildRun(A({ timeout: 900 }), {}).command.startsWith('timeout 900 '))
  assert.ok(buildPreview(A({ preview: 'ls', timeout: 900 }), {}).startsWith('timeout 120 '))
})

test('표 해석: 정규식 묶음 · 공백 분리(머리말 건너뜀, 마지막 열은 나머지 전부)', () => {
  const apt = toRows({ type: 'table', match: '^(\\S+)/(\\S+) (\\S+) (\\S+) \\[upgradable from: (.+)\\]$', columns: [L('a'), L('b'), L('c'), L('d'), L('e')] }, 'Listing...\nlibfoo/noble-updates 1.2 arm64 [upgradable from: 1.1]\nbar/noble 2 all [upgradable from: 1]\n')
  assert.deepEqual(apt, [['libfoo', 'noble-updates', '1.2', 'arm64', '1.1'], ['bar', 'noble', '2', 'all', '1']])
  const df = toRows({ type: 'table', split: 'ws', skip: 1, columns: [L('a'), L('b'), L('c'), L('d'), L('e'), L('f')] }, 'Filesystem Size Used Avail Use% Mounted on\n/dev/mmcblk0p1 58G 40G 15G 73% /\n/dev/sda1 1T 1G 1T 1% /mnt/my disk\n')
  assert.deepEqual(df, [['/dev/mmcblk0p1', '58G', '40G', '15G', '73%', '/'], ['/dev/sda1', '1T', '1G', '1T', '1%', '/mnt/my disk']])
  assert.equal(toRows({ type: 'text' }, 'x'), undefined)
})

test('결과 해석: 성공 · 비밀번호 필요 · 실패 · 연결 끊김', () => {
  const table = A({ display: { type: 'table', split: 'ws', columns: [L('a'), L('b')] } })
  assert.deepEqual(parseResult(table, 'x 1\n__EXIT__0\n', 't').rows, [['x', '1']])
  const pw = parseResult(A({ risk: 'change', sudo: true, confirm: L('x') }), 'sudo: a password is required\n__EXIT__1\n', 'sudo apt-get update')
  assert.ok(pw.needPassword && pw.termCmd === 'sudo apt-get update' && !pw.ok)
  const fail = parseResult(A({}), 'E: Could not get lock\n__EXIT__100\n', 't')
  assert.ok(!fail.ok && !fail.needPassword && fail.text === 'E: Could not get lock')
  assert.ok(parseResult(A({ disconnects: true }), '', 't').ok) // 재부팅: 종료 코드 없이 끊김은 정상
  assert.ok(!parseResult(A({}), 'partial', 't').ok) // 시간 초과·끊김
})

test('bash-i 셸 · 터미널 입력 · 탭 분리 · 표 상한', () => {
  assert.ok(buildRun(A({ shell: 'bash-i', cmd: 'ros2 topic list' }), {}).command.startsWith('timeout 60 bash -ic '))
  assert.ok(buildPreview(A({ shell: 'bash-i', preview: 'ls' }), {}).includes('bash -ic'))
  assert.deepEqual(buildTerminal(A({ mode: 'terminal', cmd: 'cd {d}' }), { d: '~/x' }), { text: 'cd ~/x', enter: true })
  assert.equal(buildTerminal(A({ mode: 'terminal', enter: false }), {}).enter, false)
  const du = toRows({ type: 'table', split: 'tab', columns: [L('a'), L('b')] }, '1.2G\t/home/a b\n4K\t/tmp\nbad line\n')
  assert.deepEqual(du, [['1.2G', '/home/a b'], ['4K', '/tmp']])
  const many = Array.from({ length: 800 }, (_, i) => `r${i} x`).join('\n')
  assert.equal(toRows({ type: 'table', split: 'ws', columns: [L('a'), L('b')] }, many)!.length, 500)
  assert.equal(toRows({ type: 'table', match: '^(.*)$', columns: [L('a')] }, many)!.length, 500)
  assert.equal(toRows({ type: 'table', match: '^(.*)$', columns: [L('a')] }, 'x'.repeat(5000))![0][0].length, 1000)
})

test('git 보호: git이 보일 때만 함수로 감싸고, 실제로 옵션이 붙는다', () => {
  assert.ok(buildRun(A({ cmd: 'git status' }), {}).command.includes('core.fsmonitor=false'))
  assert.ok(buildPreview(A({ cmd: 'x', preview: 'git log -n 3' }), {}).includes(BADGE_GIT_GUARD.slice(0, 20)))
  assert.ok(!buildRun(A({ cmd: 'ls' }), {}).command.includes('fsmonitor'))
  // 가짜 git(받은 인자를 그대로 찍음)으로 sh에서 실제 실행해 확인. sh·timeout이 없는 환경이면 건너뜀
  try {
    execSync('sh -c "command -v timeout"', { stdio: 'ignore' })
  } catch {
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'fakegit-'))
  writeFileSync(join(dir, 'git'), ['#!/bin/sh', '[ "$1" = config ] && exit 1', 'echo "git $*"', ''].join('\n')) // config(저장소 설정 검사)에는 "찾는 설정 없음"으로 답함
  chmodSync(join(dir, 'git'), 0o755)
  const PATH = dir + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
  const sh = (cmd: string) => execSync(buildRun(A({ cmd }), {}).command, { env: { ...process.env, PATH, GIT_EXTERNAL_DIFF: 'evil' }, shell: 'sh' }).toString()
  assert.match(sh('git status -s'), /git -c core.fsmonitor=false .*status --ignore-submodules=all -s/)
  assert.match(sh('git diff --stat'), /git -c core.fsmonitor=false .* diff --no-ext-diff --no-textconv --stat/)
  assert.match(sh('git --no-pager log -n 1'), /git -c core.fsmonitor=false .* log --no-ext-diff --no-textconv -n 1/)
  assert.match(sh('git -C /tmp show HEAD'), /git -c core.fsmonitor=false .* show --no-ext-diff --no-textconv HEAD/)
  assert.match(sh('echo $(git status) | cat'), /git -c core.fsmonitor=false .*status/)
  assert.match(sh('git status >/dev/null; env | grep -c GIT_EXTERNAL_DIFF; true'), /^0/)
})

test('결과 글자는 ANSI·제어 문자 제거와 비밀 가림을 거친 뒤 표로도 만들어짐', () => {
  const r = parseResult(A({}), '\x1b[31mred\x1b[0m\npassword=hunter2\n__EXIT__0\n', 't')
  assert.equal(r.text.includes('\x1b'), false)
  assert.equal(r.text.includes('hunter2'), false)
  const table = A({ display: { type: 'table', columns: [L('a'), L('b')], split: 'ws' } })
  assert.deepEqual(parseResult(table, 'x\x1b[1m 1‮\n__EXIT__0\n', 't').rows, [['x', '1']])
  assert.ok(parseResult(A({}), 'x'.repeat(300_000) + '\n__EXIT__0\n', 't').text.length < 262_144 + 100)
})

test('buildPoll: 매번 끝나는 모양(timeout 래퍼 + 종료 코드), 기본 10초, git 보호 함수', () => {
  assert.equal(buildPoll(A({ cmd: 'cat /proc/loadavg', timeout: 7 })).startsWith('timeout 7 sh -c '), true)
  assert.equal(buildPoll(A({ cmd: 'cat /proc/loadavg' })).startsWith('timeout 10 sh -c '), true)
  assert.ok(buildPoll(A({ cmd: 'cat /proc/loadavg' })).includes('__EXIT__$?'))
  assert.ok(buildPoll(A({ cmd: 'git -C /tmp status' })).includes('git()'))
})

test('git 보호는 팩 항목의 모든 실행 경로에 붙음: 실행·미리보기·실시간·그래프·목록(from)·bash -i', () => {
  const guard = BADGE_GIT_GUARD.slice(0, 40)
  const has = (s: string) => assert.ok(s.includes(guard) && s.includes('JETDECK_UNSAFE_REPO'), s.slice(0, 80))
  has(buildRun(A({ cmd: 'git status' }), {}).command)
  has(buildRun(A({ cmd: 'git status', shell: 'bash-i' }), {}).command)
  has(buildPreview(A({ cmd: 'x', preview: 'git log -n 3' }), {}))
  has(buildStream(A({ mode: 'stream', cmd: 'git log -f' }), {}))
  has(buildPoll(A({ cmd: 'git rev-list --count HEAD' })))
  has(buildFrom({ cmd: 'git branch --list', shell: 'sh', timeout: 5 }))
  assert.ok(!buildFrom({ cmd: 'ls', shell: 'sh', timeout: 5 }).includes('git()')) // git이 없으면 감싸지 않음
})
