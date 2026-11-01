import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeDevice } from './fakedevice.mts'
import { badSaveName, deniedPath, portProblem, resolveTarget, rootProblem, safeName, splitRel, toTilde } from './permpath.mts'
import type { Permission } from './packschema.mts'

const L = (s: string) => ({ ko: s, en: s })
const read = (o: Partial<Permission> = {}): Permission => ({ id: 'logs', kind: 'sftp.read', why: L('x'), root: '~/logs', maxBytes: 1000, ...o })
const write = (o: Partial<Permission> = {}): Permission => ({ id: 'up', kind: 'sftp.write', why: L('x'), root: '~/upload', maxBytes: 1000, overwrite: 'ask', ...o })
const HOME = '/home/u'
const dev = () => new FakeDevice(HOME).mkdir(`${HOME}/logs`).file(`${HOME}/logs/a.log`, 'hi').mkdir(`${HOME}/upload`).file('/etc/passwd', 'root').file(`${HOME}/.ssh/id_rsa`, 'KEY')
const rej = (p: Promise<unknown>, re: RegExp, _why?: string) => assert.rejects(p, re)

test('T1 상대 경로: .. 절대 경로 인코딩 역슬래시 NUL BiDi 길이 초과는 거부', () => {
  for (const rel of ['../x', 'a/../../x', '/etc/shadow', '%2e%2e/x', '%2E%2F', 'a\\..\\x', 'a\u0000b', 'a‮b', 'a​b', 'a/./b', 'a//b', 'a/', '.', '..', `${'a'.repeat(512)}/${'b'.repeat(512)}`, 'c'.repeat(256), 'a\nb']) assert.throws(() => splitRel(rel), /경로가 올바르지 않아요/, JSON.stringify(rel).slice(0, 30))
  assert.deepEqual(splitRel(''), [])
  assert.deepEqual(splitRel('a/b.txt'), ['a', 'b.txt'])
  assert.deepEqual(splitRel('한글 이름.txt'), ['한글 이름.txt'])
  assert.deepEqual(splitRel('c'.repeat(255)), ['c'.repeat(255)])
})

test('root·포트 글자 검사', () => {
  for (const r of ['~', '~/', '/', '~/..', '~/.ssh', '~/a/.env', '/home/x', '', `~/${'a'.repeat(199)}`, '~/a/../b']) assert.ok(rootProblem(r), r)
  for (const r of ['~/logs', '~/a/b', '~/한글']) assert.equal(rootProblem(r), null, r)
  for (const p of [0, 22, 80, 1023, 2375, 5901, 65536, 3389, 6379, 9200, 11211, 27017, 1.5, '8888', null]) assert.ok(portProblem(p), String(p))
  for (const p of [2376, 2379, 4243, 5037, 5555, 5678, 6000, 6063, 6443, 8265, 9222, 9229, 10250, 11311, 11434]) assert.ok(portProblem(p), String(p)) // 코드 실행까지 가는 서비스
  for (const p of [1024, 8888, 5910, 6064, 65535]) assert.equal(portProblem(p), null, String(p))
})

test('올리기 root: 점으로 시작하는 폴더는 거부 (읽기 root는 허용)', () => {
  for (const r of ['~/.local', '~/.config', '~/up/.cache', '~/.ipython/profile_default/startup']) {
    assert.ok(rootProblem(r, true), `write ${r}`)
    if (/^~\/\.(local|config)$/.test(r)) assert.ok(rootProblem(r), `read ${r}`) // 6.1.2: 통째 root는 읽기도 거부
    else assert.equal(rootProblem(r), null, `read ${r}`)
  }
  assert.equal(rootProblem('~/upload', true), null)
})

test('6.1.2 #5 읽기 root: ~/.config·~/.cache·~/.local 하나뿐이면 거부, 하위·다른 숨김 폴더는 허용', () => {
  for (const r of ['~/.config', '~/.cache', '~/.local']) assert.ok(rootProblem(r), r)
  for (const r of ['~/.ros/log', '~/.config/app', '~/.local/share/x']) assert.equal(rootProblem(r), null, r)
  for (const r of ['/x/.envrc', '/.local/share/fish/fish_history', '/x/.git/config']) assert.equal(deniedPath(r, 'read'), true, r)
  assert.equal(deniedPath('/x/.git/HEAD', 'read'), false)
})

test('6.1.2 #6 U+2028·2029·00AD·180E·FFF9~FFFB는 경로 조각·표시 이름에서 거부·제거', () => {
  for (const c of [' ', ' ', '­', '᠎', '￹', '￻']) {
    assert.throws(() => splitRel(`a${c}b`), /경로가 올바르지 않아요/, c.charCodeAt(0).toString(16))
    assert.equal(safeName(`a${c}b`), 'ab')
  }
})

test('T3 거부 목록: 읽기·쓰기 구분', () => {
  for (const r of ['/.ssh/id_rsa', '/x/.env', '/x/k.pem', '/x/id_rsa', '/.aws/credentials', '/.bash_history', '/.config/gcloud/a']) assert.equal(deniedPath(r, 'read'), true, `read ${r}`)
  for (const r of ['/logs/a.log', '/up/.bashrc', '/up/.profile', '/up/.git/hooks/x', '/x/.config/autostart/a.desktop', '/x/.config/systemd/user/a', '/up/crontab']) assert.equal(deniedPath(r, 'read'), r === '/logs/a.log' ? false : r === '/up/crontab' ? false : false, `read ${r}`)
  for (const r of ['/up/.bashrc', '/up/.profile', '/up/.zshrc', '/up/.git/hooks/x', '/x/.config/autostart/a.desktop', '/x/.config/systemd/user/a', '/up/crontab', '/up/.ssh/authorized_keys', '/up/.gitconfig', '/up/x.pem']) assert.equal(deniedPath(r, 'write'), true, `write ${r}`)
  assert.equal(deniedPath('/up/data.bin', 'write'), false)
  // 쓰기: 점으로 시작하는 조각은 이름 목록에 없어도 거부 (.pth·fish·pip·ipython·vim·desktop 등)
  for (const r of ['/.local/lib/python3.10/site-packages/x.pth', '/.config/fish/config.fish', '/.config/pip/pip.conf', '/.ipython/profile_default/startup/a.py', '/.vim/plugin/a.vim', '/up/.hidden']) assert.equal(deniedPath(r, 'write'), true, `write ${r}`)
  assert.equal(deniedPath('/.local/lib/x.pth', 'read'), false) // 읽기는 그대로
})

test('올리기: root 아래 숨김 폴더·숨김 파일로는 쓸 수 없다', async () => {
  const d = dev().mkdir(`${HOME}/upload/.hid`)
  await rej(resolveTarget(d, HOME, write(), '.hid/x.pth', 'write'), /막힌 경로/)
  await rej(resolveTarget(d, HOME, write({ root: '~/.local' }), 'x', 'write'), /경로가 올바르지 않아요/) // 스키마를 거치지 않은 root도 실행 때 거부
  assert.equal((await resolveTarget(d, HOME, write(), 'ok.pth', 'write')).path, `${HOME}/upload/ok.pth`)
})

test('정상 경로: 폴더 보기·받기·올리기', async () => {
  const d = dev()
  assert.deepEqual(await resolveTarget(d, HOME, read(), '', 'dir'), { path: `${HOME}/logs`, exists: true, stat: { kind: 'dir', size: 0 } })
  assert.equal((await resolveTarget(d, HOME, read(), 'a.log', 'file')).path, `${HOME}/logs/a.log`)
  const w = await resolveTarget(d, HOME, write(), 'new.bin', 'write')
  assert.deepEqual([w.path, w.exists], [`${HOME}/upload/new.bin`, false])
  d.file(`${HOME}/upload/old.bin`, 'x')
  assert.equal((await resolveTarget(d, HOME, write(), 'old.bin', 'write')).exists, true)
  assert.equal(toTilde(`${HOME}/upload/old.bin`, HOME), '~/upload/old.bin')
})

test('T12 root 안의 링크가 root 밖(/etc)을 가리키면 거부', async () => {
  const d = dev().link(`${HOME}/logs/link`, '/etc')
  await rej(resolveTarget(d, HOME, read(), 'link/passwd', 'file'), /허용된 폴더 밖/)
  await rej(resolveTarget(d, HOME, read(), 'link', 'dir'), /허용된 폴더 밖/)
  d.link(`${HOME}/logs/sshlink`, `${HOME}/.ssh`)
  await rej(resolveTarget(d, HOME, read(), 'sshlink/id_rsa', 'file'), /허용된 폴더 밖|막힌 경로/) // 같은 홈 안이어도 root 밖
  d.link(`${HOME}/logs/up`, `${HOME}/upload`)
  await rej(resolveTarget(d, HOME, read(), 'up', 'dir'), /허용된 폴더 밖/)
  d.mkdir(`${HOME}/logs/deep`).link(`${HOME}/logs/deep/back`, `${HOME}/logs`)
  assert.equal((await resolveTarget(d, HOME, read(), 'deep/back/a.log', 'file')).path, `${HOME}/logs/a.log`) // root 안으로 돌아오는 링크는 실제 경로로 정리됨
})

test('T13 root 자체가 링크로 바뀌면 모든 동작 거부', async () => {
  for (const target of ['/etc', HOME, '/']) {
    const d = new FakeDevice(HOME).file('/etc/passwd', 'x').link(`${HOME}/logs`, target)
    for (const [rel, want] of [['', 'dir'], ['passwd', 'file'], ['x', 'write']] as const) await rej(resolveTarget(d, HOME, read(), rel, want), /허용된 폴더 밖|막힌 경로|없어요/, `${target} ${rel}`)
  }
  const d = new FakeDevice(HOME).link(`${HOME}/logs`, `${HOME}/.ssh`).file(`${HOME}/.ssh/id_rsa`, 'K')
  await rej(resolveTarget(d, HOME, read(), 'id_rsa', 'file'), /막힌 경로/) // 홈 안의 민감 폴더로 바뀐 root
  await rej(resolveTarget(new FakeDevice(HOME), HOME, read(), '', 'dir'), /허용된 폴더를 찾을 수 없어요/) // root가 없음
})

test('거부 목록: root 안이어도 민감한 이름은 읽을 수 없다', async () => {
  const d = dev().file(`${HOME}/logs/.env`, 'S').file(`${HOME}/logs/k.pem`, 'S').file(`${HOME}/logs/.bash_history`, 'S').link(`${HOME}/logs/innocent.log`, `${HOME}/logs/.env`)
  for (const rel of ['.env', 'k.pem', '.bash_history', 'innocent.log']) await rej(resolveTarget(d, HOME, read(), rel, 'file'), /막힌 경로/, rel)
})

test('T14 일반 파일만: FIFO·장치·폴더 거부 / 크기 상한', async () => {
  const d = dev().other(`${HOME}/logs/fifo`).link(`${HOME}/logs/zero`, `${HOME}/logs/fifo`).mkdir(`${HOME}/logs/sub`).file(`${HOME}/logs/big`, 1001).file(`${HOME}/logs/edge`, 1000)
  await rej(resolveTarget(d, HOME, read(), 'fifo', 'file'), /일반 파일만/)
  await rej(resolveTarget(d, HOME, read(), 'zero', 'file'), /일반 파일만/)
  await rej(resolveTarget(d, HOME, read(), 'sub', 'file'), /일반 파일만/)
  await rej(resolveTarget(d, HOME, read(), 'a.log', 'dir'), /폴더가 아니에요/)
  await rej(resolveTarget(d, HOME, read(), 'big', 'file'), /너무 커요/)
  assert.equal((await resolveTarget(d, HOME, read(), 'edge', 'file')).stat?.size, 1000)
  await rej(resolveTarget(d, HOME, read(), 'none', 'file'), /없어요/)
})

test('T16 올리기: 링크 대상·읽기 전용 위치·쓰기 거부 목록', async () => {
  const d = dev().file(`${HOME}/upload/real`, 'x').link(`${HOME}/upload/lnk`, `${HOME}/upload/real`).link(`${HOME}/upload/evil`, `${HOME}/.bashrc`).file(`${HOME}/.bashrc`, 'rc').mkdir(`${HOME}/upload/dir`)
  await rej(resolveTarget(d, HOME, write(), 'lnk', 'write'), /링크 파일은 덮어쓸 수 없어요/)
  await rej(resolveTarget(d, HOME, write(), 'evil', 'write'), /허용된 폴더 밖/) // 링크가 root 밖을 가리킴
  await rej(resolveTarget(d, HOME, write(), 'dir', 'write'), /일반 파일만/)
  await rej(resolveTarget(d, HOME, write(), '', 'write'), /경로가 올바르지 않아요/)
  await rej(resolveTarget(d, HOME, write(), 'nodir/x', 'write'), /올릴 폴더가 없어요/)
  for (const rel of ['.bashrc', '.profile', '.git/hooks/x', '.config/autostart/a.desktop', 'authorized_keys', 'k.pem', '.ssh/x']) {
    d.mkdir(`${HOME}/upload/${rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''}`)
    await rej(resolveTarget(d, HOME, write(), rel, 'write'), /막힌 경로/, rel)
  }
  // 올리는 쪽 root가 읽기 거부 목록과 겹쳐도 거부
  await rej(resolveTarget(d, HOME, write({ root: '~/.config/systemd' }), 'a.service', 'write'), /경로가 올바르지 않아요|허용된 폴더를 찾을 수 없어요|막힌 경로/)
})

test('받기 이름: 실행 파일 확장자·Windows 끝 점/공백·대체 스트림 거부', () => {
  for (const n of ['a.exe', 'A.EXE', 'a.bat', 'a.cmd', 'a.ps1', 'a.lnk', 'a.scr', 'a.msi', 'a.vbs', 'a.js', 'a.jar', 'a.com', 'a.exe.', 'a.exe ', 'a.exe. .', 'a.txt:evil.exe', 'x:y', 'a.hta', 'a.PIF', 'a.cpl', 'a.msc', 'a.scf', 'a.url', 'a.wsf', 'a.jse', 'a.vbe', 'a.reg', 'a.psm1', 'a.appref-ms']) assert.equal(badSaveName(n), true, n)
  for (const n of ['a.log', 'a.txt', 'js', 'exe', 'archive.tar.gz', 'a.json', 'readme']) assert.equal(badSaveName(n), false, n)
})

test('Device가 준 이름은 표시 전에 정리', () => {
  assert.equal(safeName('a‮b\u0007c​d'), 'abcd')
  assert.equal(safeName('x'.repeat(400)).length, 255)
})
