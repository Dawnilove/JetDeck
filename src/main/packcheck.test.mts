import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { checkSubmission, dangerNote, distance, permNote, renderSummary } from './packcheck.mts'

const L = (s: string) => ({ ko: s, en: s })
const act = (cmd: string, risk = 'read', extra: Record<string, unknown> = {}) => ({ id: 'a', label: L('a'), cmd, risk, ...extra })
const pack = (over: Record<string, unknown> = {}, actions: unknown[] = [act('uname -a')]) => ({ id: 'my-check', format: 1, version: '1.0.0', name: L('My check'), desc: L('desc'), author: 'someone', license: 'MIT', plugins: [{ id: 'p', title: L('p'), actions }], ...over })
const pathOf = (id = 'my-check', v = '1.0.0') => `docs/packs/files/${id}/${v}/${id}.jdpack.json`
const bytes = (o: unknown) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o))
function run(o: unknown, opt: { path?: string; status?: 'A' | 'M' | 'D'; body?: string; existing?: string[]; extra?: { status: 'A' | 'M' | 'D'; path: string }[] } = {}) {
  const path = opt.path ?? pathOf()
  const files = new Map<string, Uint8Array>([[path, bytes(o)]])
  return checkSubmission({ changed: [{ status: opt.status ?? 'A', path }, ...(opt.extra ?? [])], read: (p) => files.get(p) ?? null, existingIds: opt.existing ?? ['usb-camera-check', 'network-check', 'storage-check'], prBody: opt.body ?? '' })
}
const fails = (r: ReturnType<typeof run>, re: RegExp) => {
  assert.equal(r.ok, false, '실패해야 함')
  assert.ok(r.problems.some((p) => re.test(p)), `문제 목록에 ${re} 없음: ${r.problems.join(' | ')}`)
}

test('좋은 팩은 통과하고 요약에 명령 전문이 나옴', () => {
  const r = run(pack())
  assert.equal(r.ok, true, r.problems.join(' | '))
  assert.equal(r.reports[0].read, 1)
  assert.match(renderSummary(r), /uname -a/)
})

test('실제 모음 팩 3개가 통과함 (검사기와 공개 팩이 어긋나지 않음)', () => {
  for (const id of ['usb-camera-check', 'network-check', 'storage-check']) {
    const path = pathOf(id, '1.0.0')
    const r = checkSubmission({ changed: [{ status: 'A', path }], read: (p) => readFileSync(p), existingIds: [], prBody: '' })
    assert.equal(r.ok, true, `${id}: ${r.problems.join(' | ')}`)
  }
})

// ── 나쁜 팩 샘플 (모두 실패해야 함) ──
test('나쁨 1: 읽기라고 적었지만 앱 계산은 위험', () => fails(run(pack({}, [act('rm -rf /tmp/x', 'read')])), /위험도|낮게/))
test('나쁨 2: 공식 id 사칭', () => fails(run(pack({ id: 'device' }), { path: pathOf('device') }), /공식 팩 전용/))
test('나쁨 3: jetdeck- 접두', () => fails(run(pack({ id: 'jetdeck-tools' }), { path: pathOf('jetdeck-tools') }), /공식 팩 전용/))
test('나쁨 4: 공식 id와 한 글자 차이', () => fails(run(pack({ id: 'devicee' }), { path: pathOf('devicee') }), /한 글자 차이/))
test('나쁨 5: 기존 모음 팩과 한 글자 차이', () => fails(run(pack({ id: 'storage-chek' }), { path: pathOf('storage-chek') }), /한 글자 차이/))
test('나쁨 6: 128KB 초과', () => fails(run(pack({ desc: L('x'.repeat(200 * 1024)) })), /KB보다 커요/))
test('나쁨 7: 이미 올린 파일 수정', () => fails(run(pack(), { status: 'M' }), /고치거나 지울 수 없어요/))
test('나쁨 8: 이미 올린 파일 삭제', () => fails(run(pack(), { status: 'D' }), /고치거나 지울 수 없어요/))
test('나쁨 9: 제어 문자·BiDi', () => {
  fails(run(pack({ desc: L('hello\u0007') })), /제어 문자/)
  fails(run(pack({ desc: L('abc‮def') })), /제어 문자/)
})
test('나쁨 10: license 없음 / author 없음', () => {
  fails(run(pack({ license: undefined })), /license/)
  fails(run(pack({ author: undefined })), /author/)
})
test('나쁨 11: 폴더 이름과 팩 안의 id·버전이 다름', () => {
  fails(run(pack({ id: 'other-check' })), /폴더 이름과 달라요/)
  fails(run(pack({ version: '2.0.0' })), /폴더 이름과 달라요/)
})
test('나쁨 12: 경로 모양이 틀림 (파일 이름 ≠ id, 대문자, 2자 id)', () => {
  fails(run(pack(), { path: 'docs/packs/files/my-check/1.0.0/other.jdpack.json' }), /경로는/)
  fails(run(pack({ id: 'My-Check' }), { path: pathOf('My-Check') }), /경로는/)
  fails(run(pack({ id: 'ab' }), { path: pathOf('ab') }), /경로는/)
})
test('나쁨 13: JSON 아님', () => fails(run('{ not json'), /JSON/))
test('나쁨 14: PR 하나에 팩 둘', () => fails(run(pack(), { extra: [{ status: 'A', path: pathOf('other-pack') }] }), /팩 하나만/))

test('위험 항목은 PR 설명의 Danger 절 이유가 있어야 통과', () => {
  const p = pack({}, [act('pkill -f train.py', 'danger', { confirm: L('Delete the cache?') })])
  const bad = run(p)
  assert.equal(bad.ok, false, bad.problems.join(' | '))
  assert.ok(bad.problems.some((x) => /Danger/.test(x)))
  assert.equal(run(p, { body: '## What\nx\n## Danger items\n<!-- explain -->\n' }).ok, false)
  const good = run(p, { body: '## What\nx\n## Danger items\nStops only the training job of this pack on purpose; the button asks for confirmation first.\n## Checks\n- ok' })
  assert.equal(good.ok, true, good.problems.join(' | '))
})

test('목록 파일만 바뀐 PR은 검사할 팩이 없다고 알림 (관리자 몫)', () => {
  const r = checkSubmission({ changed: [{ status: 'M', path: 'docs/packs/index.json' }], read: () => null, existingIds: [], prBody: '' })
  assert.equal(r.ok, true)
  assert.ok(r.notes.length > 0)
})

test('요약: 명령 안의 백틱·물결 줄로 코드 블록을 깰 수 없음', () => {
  const r = run(pack({}, [act('echo hi\n~~~~~~\n# injected')]))
  const md = renderSummary(r)
  assert.ok(!/^~{4,}$/m.test(md.split('~~~~text')[1].split('\n').slice(2, -3).join('\n')))
})

test('글자 차이·Danger 절 읽기', () => {
  assert.equal(distance('abc', 'abd'), 1)
  assert.equal(distance('abc', 'abcd'), 1)
  assert.equal(distance('abc', 'xyz'), 3)
  assert.equal(dangerNote('# Danger\nlong enough reason here, yes'), 'long enough reason here, yes'.length)
  assert.equal(dangerNote('no section'), 0)
})

// ── 6.0.0 권한 (T9) ──
const perm = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'sftp.read', root: `~/${id}`, why: L('Reads the folder'), ...extra })
const appAct = (id: string, p: string, extra: Record<string, unknown> = {}) => ({ id, label: L(id), mode: 'app', perm: p, op: 'list', ...extra })
const permPack = (perms: unknown[], over: Record<string, unknown> = {}) => pack({ minApp: '6.0.0', permissions: perms, ...over }, (perms as { id: string; kind: string }[]).map((p) => appAct(`l-${p.id}`, p.id, p.kind === 'tunnel' ? { op: 'open' } : {})))
const PERM_BODY = '## What\nx\n## Permissions\nReads only the log folder so the user can see their logs here.\n'

test('권한 팩: 이유가 있으면 통과하고, 요약표에 권한과 app 항목이 나옴', () => {
  const r = run(permPack([perm('logs'), perm('web', { kind: 'tunnel', remotePort: 8888, root: undefined })]), { body: PERM_BODY })
  assert.equal(r.ok, true, r.problems.join(' | '))
  assert.deepEqual(r.reports[0].perms.map((x) => x.kind), ['sftp.read', 'tunnel'])
  const md = renderSummary(r)
  assert.match(md, /\[permission sftp\.read\] logs: ~\/logs/)
  assert.match(md, /\[permission tunnel\] web: Device 127\.0\.0\.1:8888/)
  assert.match(md, /app logs list/) // cmd가 없는 항목도 나열
  assert.match(md, /permissions 2/)
})

test('T9 권한이 있는데 PR 설명에 Permissions 절이 없거나 20자 미만이면 실패', () => {
  const p = permPack([perm('logs')])
  fails(run(p), /Permissions/)
  fails(run(p, { body: '## Permissions\nshort\n' }), /Permissions/)
  fails(run(p, { body: '## Permissions\n<!-- why -->\n' }), /Permissions/)
  fails(run(p, { body: '## Danger items\nReads only the log folder so the user can see them.\n' }), /Permissions/) // 다른 절의 글은 안 셈
})

test('T9 권한 4개·minApp 낮음·거부 포트·root 위반·쓰지 않는 권한은 모두 실패', () => {
  const four = ['a1', 'a2', 'a3', 'a4'].map((id) => perm(id))
  const body = PERM_BODY
  fails(run(permPack(four), { body }), /3개까지/)
  fails(run(permPack([perm('logs')], { minApp: '5.9.0' }), { body }), /minApp/)
  fails(run(permPack([perm('logs')], { minApp: undefined }), { body }), /minApp/)
  fails(run(permPack([perm('web', { kind: 'tunnel', remotePort: 22, root: undefined })]), { body }), /web: /)
  fails(run(permPack([perm('web', { kind: 'tunnel', remotePort: 2375, root: undefined })]), { body }), /web: /)
  fails(run(permPack([perm('logs', { root: '~/.ssh' })]), { body }), /logs: /)
  fails(run(permPack([perm('logs', { root: '~' })]), { body }), /logs: /)
  fails(run(permPack([perm('logs', { why: undefined })]), { body }), /logs: /)
  fails(run(pack({ minApp: '6.0.0', permissions: [perm('logs'), perm('spare')] }, [appAct('l', 'logs')]), { body }), /쓰는 항목이 없어요/)
  fails(run(pack({ minApp: '6.0.0', permissions: [perm('logs')] }, [appAct('l', 'logs', { cmd: 'ls', auto: true })]), { body }), /app 항목은/)
  fails(run(pack({ minApp: '6.0.0', permissions: [perm('logs', { kind: 'sftp.write' })] }, [appAct('l', 'logs', { op: 'put', path: 'x', risk: 'read' })]), { body }), /위험도/) // 낮게 적음
})

test('T9 위험 항목과 권한이 같이 있으면 두 절 모두 필요', () => {
  const p = pack({ minApp: '6.0.0', permissions: [perm('logs')] }, [appAct('l', 'logs'), act('pkill -f train.py', 'danger', { id: 'k', confirm: L('Stop it?') })])
  const danger = '## Danger items\nStops only the training job of this pack on purpose, after a prompt.\n'
  fails(run(p, { body: PERM_BODY }), /Danger/)
  fails(run(p, { body: danger }), /Permissions/)
  assert.equal(run(p, { body: PERM_BODY + danger }).ok, true)
})

test('Permissions 절 읽기', () => {
  assert.equal(permNote('# Permissions\nlong enough reason here, yes'), 'long enough reason here, yes'.length)
  assert.equal(permNote('## Permission reasons\nabc def'), 7)
  assert.equal(permNote('no section'), 0)
})
