import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approveAndEnable, buildCatalog, commandMap, diffPerms, type RawFile, type StateFile } from './packstore.mts'
import { PERM_MIN_APP, permStrings, summarizePack, validatePack } from './packschema.mts'

// 6.0.0 권한 스키마 시험 (설계안 §6 T2·T4~T8·T11)
const L = (s: string) => ({ ko: s, en: s })
const perm = (o: Record<string, unknown> = {}) => ({ id: 'logs', kind: 'sftp.read', root: '~/logs', why: L('로그 받기'), ...o })
const tun = (o: Record<string, unknown> = {}) => ({ id: 'web', kind: 'tunnel', remotePort: 8888, why: L('웹'), ...o })
const app = (o: Record<string, unknown> = {}) => ({ id: 'get', label: L('받기'), mode: 'app', perm: 'logs', op: 'get', path: '{file}', fields: [{ name: 'file', label: L('파일'), type: 'text', charset: 'word' }], ...o })
const pack = (permissions: unknown[] | undefined, actions: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'tp', format: 1, version: '1.0.0', minApp: PERM_MIN_APP, name: L('t'), ...(permissions ? { permissions } : {}), plugins: [{ id: 'p', title: L('p'), actions }], ...extra
})
const run = (permissions: unknown[] | undefined, actions: unknown[], extra: Record<string, unknown> = {}, official = false) => validatePack(pack(permissions, actions, extra), { official })
const errs = (r: ReturnType<typeof run>) => [...r.errors, ...r.warnings].join('|')

test('권한 팩: 올바른 선언은 통과하고 기본값이 채워진다', () => {
  const r = run([perm(), perm({ id: 'inbox', kind: 'sftp.write', root: '~/upload' }), tun()], [app(), app({ id: 'put', perm: 'inbox', op: 'put', path: '{file}' }), { id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open' }])
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  const [a, b, c] = r.pack!.permissions!
  assert.deepEqual([a.maxBytes, b.overwrite, c.maxMinutes], [5 * 1024 * 1024, 'ask', 10])
  const acts = r.pack!.plugins[0].actions
  assert.deepEqual(acts.map((x) => [x.mode, x.risk, x.cmd, x.understated]), [['app', 'read', '', false], ['app', 'change', '', false], ['app', 'change', '', false]])
  assert.deepEqual(summarizePack(r.pack!), { total: 3, read: 1, change: 2, danger: 0, understated: 0, hidden: 0, terminal: 0, stream: 0, form: 2, chart: 0, badge: 0, autoRun: 0, perm: 3, app: 3 })
  assert.deepEqual(permStrings(r.pack!), ['sftp.read', 'sftp.write', 'tunnel:8888'])
})

test('T2 root: ~, /, ~/.., ~/.ssh, 절대 경로, 빈 값, 201자는 오류', () => {
  for (const root of ['~', '~/', '/', '~/..', '~/a/../b', '~/.ssh', '~/.aws/x', '/home/x', '', undefined, `~/${'a'.repeat(199)}`, '~/a//b', '~/a\\b', '~/a‮b', '~/x/', 5]) {
    const r = run([perm({ root })], [app()])
    assert.match(errs(r), /logs:/, String(root))
    assert.equal(r.pack?.permissions, undefined, String(root)) // 권한이 빠지면 쓰는 항목도 오류 → 팩이 열리지 않음
  }
  assert.deepEqual(run([perm({ root: `~/${'a'.repeat(198)}` })], [app()]).errors, [])
})

test('T4 remotePort: 0, 22, 80, 1023, 2375, 5901, 65536, 문자열은 오류 / 8888·1024 통과', () => {
  for (const remotePort of [0, 22, 80, 1023, 2375, 3389, 5900, 5901, 5909, 6379, 9200, 11211, 27017, 65536, '8888', 8888.5, undefined]) {
    assert.match(errs(run([tun({ remotePort })], [{ id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open' }])), /web:/, String(remotePort))
  }
  for (const remotePort of [1024, 8888, 5910, 65535]) assert.deepEqual(run([tun({ remotePort })], [{ id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open' }]).errors, [], String(remotePort))
})

test('범위 한도: maxBytes·maxMinutes·overwrite·종류별 금지 필드', () => {
  for (const o of [{ maxBytes: 0 }, { maxBytes: 20 * 1024 * 1024 + 1 }, { maxBytes: '5' }, { remotePort: 8888 }, { overwrite: 'ask' }, { maxMinutes: 5 }]) assert.match(errs(run([perm(o)], [app()])), /logs:/, JSON.stringify(o))
  for (const o of [{ overwrite: 'always' }, { overwrite: true }, { maxBytes: 99 * 1024 * 1024 }]) assert.match(errs(run([perm({ kind: 'sftp.write', ...o })], [app({ op: 'put' })])), /logs:/, JSON.stringify(o))
  for (const o of [{ maxMinutes: 0 }, { maxMinutes: 61 }, { maxMinutes: 1.5 }, { root: '~/x' }, { maxBytes: 5 }, { overwrite: 'ask' }]) assert.match(errs(run([tun(o)], [{ id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open' }])), /web:/, JSON.stringify(o))
  assert.deepEqual(run([perm({ kind: 'sftp.write', overwrite: 'never', maxBytes: 20 * 1024 * 1024 })], [app({ op: 'put' })]).errors, [])
  assert.deepEqual(run([tun({ maxMinutes: 60 })], [{ id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open' }]).errors, [])
})

test('T5 권한 id 중복·모르는 kind·없는 perm·kind와 op 불일치', () => {
  assert.match(errs(run([perm(), perm()], [app()])), /logs: id가 겹쳐요/)
  assert.match(errs(run([perm({ kind: 'serial.read' })], [app()])), /kind는/)
  assert.match(errs(run([perm({ why: undefined })], [app()])), /why/)
  assert.match(errs(run([perm({ id: 'X' })], [app()])), /권한 id/)
  const noPerm = run([perm()], [app({ perm: 'nope' })])
  assert.match(errs(noPerm), /맞는 권한이 없어요/)
  assert.equal(noPerm.pack, null) // 쓸 수 있는 항목이 하나도 없음
  for (const op of ['put', 'open', 'x', undefined]) assert.match(errs(run([perm()], [app(), app({ id: 'b', op })])), /b: op는/, String(op))
  assert.match(errs(run([perm({ kind: 'sftp.write' })], [app({ op: 'get' })])), /op는/)
  assert.match(errs(run([tun()], [app({ perm: 'web', op: 'list' })])), /op는/)
})

test('권한 개수: 외부 3개·공식 5개', () => {
  const four = ['a1', 'a2', 'a3', 'a4'].map((id) => perm({ id }))
  const acts = four.map((p) => app({ id: p.id, perm: p.id }))
  const r = run(four, acts)
  assert.match(errs(r), /권한은 3개까지/)
  assert.equal(r.pack!.permissions!.length, 3)
  const five = [...four, perm({ id: 'a5' })]
  assert.deepEqual(run(five, five.map((p) => app({ id: p.id, perm: p.id })), {}, true).errors, [])
})

test('T6 app 항목에 cmd·auto·from·display·sudo 등을 쓰면 오류', () => {
  for (const o of [{ cmd: 'ls' }, { auto: true }, { sudo: true }, { preview: 'ls' }, { display: { type: 'chart' } }, { display: { type: 'text' } }, { confirm: L('x') }, { params: [] }, { timeout: 5 }, { shell: 'sh' }]) {
    assert.match(errs(run([perm()], [app(), app({ id: 'b', ...o })])), /b: app 항목은/, JSON.stringify(o))
  }
  const from = { name: 'file', label: L('f'), type: 'select', from: { cmd: 'ls', charset: 'word' } }
  assert.match(errs(run([perm()], [app(), app({ id: 'b', fields: [from] })])), /b: app 항목의 fields/)
  for (const type of ['path', 'flag']) assert.match(errs(run([perm()], [app(), app({ id: 'b', fields: [{ name: 'file', label: L('f'), type, ...(type === 'flag' ? { on: '-x' } : {}) }] })])), /b: /, type)
})

test('path 템플릿: 슬롯은 fields만 / 모든 필드를 써야 함 / 절대 경로·.. 거부 / open은 path 금지', () => {
  assert.match(errs(run([perm()], [app(), app({ id: 'b', path: '{nope}' })])), /\{nope\}에 맞는 fields/)
  assert.match(errs(run([perm()], [app(), app({ id: 'b', path: 'x' })])), /필드 file를 path에서 쓰지 않아요/)
  for (const path of ['/etc/shadow', '../x', 'a/../x', '{file}/..', 'a\\b', '', 'a//b', `a${'b'.repeat(300)}`]) assert.match(errs(run([perm()], [app(), app({ id: 'b', path, fields: undefined })])), /b: /, path.slice(0, 20))
  assert.deepEqual(run([perm()], [app({ id: 'l', op: 'list', path: undefined, fields: undefined })]).errors, [])
  assert.deepEqual(run([perm()], [app({ id: 'l', op: 'list', path: 'sub/{file}' })]).errors, [])
  assert.match(errs(run([tun()], [{ id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open', path: 'x' }])), /open 항목은 path/)
})

test('T7 minApp: 없음·5.9.0이면 팩을 열지 않고, 6.0.0은 통과', () => {
  for (const minApp of [undefined, '5.9.0', '5.6.0']) {
    const r = run([perm()], [app()], { minApp })
    assert.equal(r.pack, null, String(minApp))
    assert.match(errs(r), /minApp을 "6\.0\.0" 이상/)
  }
  assert.equal(run([perm()], [app()], { minApp: '6.0.0' }).pack !== null, true)
  // 선언만 있어도, app 항목만 있어도 같은 규칙
  assert.equal(run([perm()], [{ id: 'x', label: L('x'), cmd: 'ls', risk: 'read' }], { minApp: '5.9.0' }).pack, null)
  assert.equal(run(undefined, [app()], { minApp: '5.9.0' }).pack, null)
  // 권한이 없는 팩은 minApp이 없어도 그대로
  assert.equal(run(undefined, [{ id: 'x', label: L('x'), cmd: 'ls', risk: 'read' }], { minApp: undefined }).pack !== null, true)
  // 앱 버전이 낮으면 기존 minApp 규칙이 거부
  assert.equal(validatePack(pack([perm()], [app()]), { appVersion: '5.6.0' }).pack, null)
})

test('T8 risk를 낮게 적으면 understated (앱 계산이 이김)', () => {
  const r = run([perm({ kind: 'sftp.write', root: '~/up' }), tun()], [app({ id: 'put', perm: 'logs', op: 'put', risk: 'read' }), { id: 'web', label: L('웹'), mode: 'app', perm: 'web', op: 'open', risk: 'read' }])
  const [a, b] = r.pack!.plugins[0].actions
  assert.deepEqual([a.understated, a.risk, a.declared, a.computed, b.understated, b.risk], [true, 'change', 'read', 'change', true, 'change'])
  assert.equal(r.warnings.length, 2)
  assert.equal(summarizePack(r.pack!).understated, 2)
  // 읽기 권한에 danger를 적는 것은 더 높게 적은 것이라 허용 (understated 아님)
  assert.equal(run([perm()], [app({ risk: 'danger' })]).pack!.plugins[0].actions[0].risk, 'danger')
})

test('쓰지 않는 권한은 경고', () => {
  assert.match(errs(run([perm(), perm({ id: 'spare' })], [app()])), /permissions\/spare: 쓰는 항목이 없어요/)
})

test('권한과 exec 항목이 한 팩에 같이 있어도 된다', () => {
  const r = run([perm()], [app(), { id: 'x', label: L('x'), cmd: 'ls', risk: 'read' }])
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.pack!.plugins[0].actions.map((a) => a.mode), ['app', 'exec'])
})

test('T11 허용 뒤 파일에 권한이 늘면 changed + diffPerms에 added, 범위가 바뀌면 changed', () => {
  const file = (permissions: unknown[]): RawFile => ({ fileName: 'tp.jdpack.json', file: '/x/tp.jdpack.json', bytes: new TextEncoder().encode(JSON.stringify(pack(permissions, [app(), app({ id: 'put', perm: 'inbox', op: 'put' })]))) })
  const base = [perm(), perm({ id: 'inbox', kind: 'sftp.write', root: '~/up' })]
  const catalog = (f: RawFile, state: StateFile) => buildCatalog({ official: [], user: [f], state, appVersion: '6.0.0' }).find((e) => e.id === 'tp')!
  const empty: StateFile = { version: 1, packs: {} }
  const e0 = catalog(file(base), empty)
  assert.deepEqual([e0.status, e0.approval], ['ok', 'new'])
  const st = approveAndEnable(empty, e0, e0.hash)
  assert.deepEqual(catalog(file(base), st).approval, 'approved')
  assert.deepEqual(Object.keys(st.packs.tp.approvedCmds!).filter((k) => k.startsWith('perm:')), ['perm:logs', 'perm:inbox'])
  // 권한 하나 추가
  const more = catalog(file([...base, tun()]), st)
  assert.deepEqual([more.enabled, more.wantEnabled, more.approval], [false, true, 'changed'])
  assert.deepEqual(more.permChanges, { added: ['perm:web'], changed: [], removed: [] })
  // 범위(root) 변경
  const wider = catalog(file([perm({ root: '~' }), base[1]]), st) // 잘못된 root → 권한이 빠져 removed
  assert.deepEqual(wider.permChanges?.removed, ['perm:logs'])
  const moved = catalog(file([perm({ root: '~/other' }), base[1]]), st)
  assert.deepEqual(moved.permChanges, { added: [], changed: ['perm:logs'], removed: [] })
  // 설명(why)만 바뀌면 지문은 달라지지만 권한 범위 변화는 없음
  const why = catalog(file([perm({ why: L('다른 설명') }), base[1]]), st)
  assert.deepEqual([why.approval, why.permChanges], ['changed', { added: [], changed: [], removed: [] }])
  assert.deepEqual(diffPerms(undefined, { 'perm:a': '{}', 'p/x': 'ls' }), { added: ['perm:a'], changed: [], removed: [] })
})

test('commandMap: app 항목의 perm·op·path가 바뀌면 바뀐 항목으로 보인다', () => {
  const m = (path: string) => commandMap(run([perm()], [app({ path, fields: [{ name: 'file', label: L('f'), type: 'text', charset: 'word' }] })]).pack!)['p/get']
  assert.notEqual(m('{file}'), m('x/{file}'))
})
