import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareSemver, LIMITS, OFFICIAL_UNPROVEN_READS, regexProblem, summarizePack, validatePack } from './packschema.mts'

const L = (s: string) => ({ ko: s, en: s })
const pack = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), actions }], ...extra })
const act = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', ...o })
const errs = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).errors.join('|')
const get = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).pack?.plugins[0].actions[0]
const ok = (o: Record<string, unknown>, official = false) => assert.ok(get(o, official), errs(o, official))
const param = (values: string[]) => ({ name: 'x', label: L('x'), choices: values.map((v) => ({ value: v, label: L(v) })) })

test('올바른 항목은 통과', () => {
  ok({})
  ok({ cmd: 'apt list --upgradable 2>/dev/null', display: { type: 'table', match: '^(\\S+)/(\\S+)$', columns: [L('a'), L('b')] } })
  ok({ risk: 'danger', sudo: true, cmd: 'apt-get -y upgrade', confirm: L('x'), preview: 'apt-get -s upgrade | grep ^Inst' })
  ok({ risk: 'change', sudo: true, cmd: 'shutdown -r +{min}', confirm: L('x'), params: [{ ...param(['5']), name: 'min' }] })
  ok({ cmd: 'systemctl get-default; ls /var/run/reboot-required 2>/dev/null' })
  assert.equal(get({})!.risk, 'read')
  assert.equal(get({ cmd: 'df -h' })!.understated, false)
})

test('읽기 항목: sudo는 거부, 읽기가 아닌 명령은 위험도가 올라가고 ⚠ 표시', () => {
  assert.match(errs({ sudo: true }), /sudo/)
  assert.match(errs({ cmd: 'sudo ls' }), /sudo를 쓰지/)
  for (const [c, want] of [['echo a > f', 'danger'], ['systemctl restart ssh', 'change'], ['apt-get update', 'change'], ['reboot', 'danger'], ['ls; sudo ls', 'danger'], ['kill 1', 'change'], ['curl x', 'danger']] as const) {
    const a = get({ cmd: c, auto: true })!
    assert.ok(a, c)
    assert.equal(a.risk, want, c)
    assert.equal(a.declared, 'read')
    assert.ok(a.understated, c)
    assert.equal(a.auto, undefined, c) // 자동 실행 해제
  }
  const r = validatePack(pack([act({ cmd: 'kill 1' })]))
  assert.equal(r.warnings.length, 1)
  for (const c of ['rm -rf x', 'r""m x', 'journalctl --vacuum-size=1M']) assert.match(errs({ cmd: c }), /preview가 필요/, c) // 삭제 성격인데 읽기라고 적으면 미리보기 요구로 걸러짐
  assert.equal(get({ risk: 'danger', cmd: 'ls', confirm: L('x') })!.risk, 'danger') // 선언이 높으면 그대로
  assert.equal(get({ risk: 'danger', cmd: 'ls', confirm: L('x') })!.understated, false)
})

test('바꾸는 항목: confirm 필수, sudo는 단일 명령만, auto 불가', () => {
  assert.match(errs({ risk: 'change', cmd: 'shutdown -c' }), /confirm/)
  assert.match(errs({ risk: 'change', sudo: true, cmd: 'a | b', confirm: L('x') }), /단일 명령/)
  assert.match(errs({ risk: 'change', sudo: true, cmd: 'sudo reboot', confirm: L('x') }), /sudo를 쓰지/)
  assert.match(errs({ risk: 'change', cmd: 'ls', confirm: L('x'), auto: true }), /auto/)
  assert.equal(get({ risk: 'change', cmd: 'shutdown -c', sudo: true, confirm: L('x') })!.risk, 'change')
})

test('설치·정리·삭제는 preview 필수, preview는 읽기로 증명되어야 함', () => {
  for (const c of ['apt-get -y upgrade', 'apt-get -y autoremove', 'apt-get clean', 'journalctl --vacuum-size=200M', 'apt-get install -y x', 'rm -rf /var/cache/x']) assert.match(errs({ risk: 'danger', sudo: c.startsWith('rm') ? undefined : true, cmd: c, confirm: L('x') }), /preview가 필요/, c)
  assert.match(errs({ risk: 'danger', sudo: true, cmd: 'apt-get clean', confirm: L('x'), preview: 'apt-get clean' }), /preview는 읽기 전용/)
  assert.match(errs({ risk: 'danger', sudo: true, cmd: 'apt-get clean', confirm: L('x'), preview: 'ls > f' }), /preview는 읽기 전용/)
  assert.match(errs({ risk: 'danger', sudo: true, cmd: 'apt-get clean', confirm: L('x'), preview: 'r""m x' }), /preview는 읽기 전용/)
  ok({ risk: 'danger', sudo: true, cmd: 'apt-get clean', confirm: L('x'), preview: 'du -sh /var/cache/apt 2>&1' })
})

test('막힌 경로를 지우는 항목은 거부 (선택지 조합 포함)', () => {
  for (const c of ['rm -rf /', 'rm -rf /etc', 'rm -r /usr/lib/x', 'rm -rf ~', 'rm -rf /var', 'rm -rf /opt/nvidia/x', 'dd if=/dev/zero of=/dev/sda', 'rm -rf $X'])
    assert.match(errs({ risk: 'danger', cmd: c, confirm: L('x'), preview: 'ls' }), /막힌 경로/, c)
  ok({ risk: 'danger', cmd: 'rm -rf /var/cache/apt/archives/partial', confirm: L('x'), preview: 'ls /var/cache/apt/archives/partial' })
  assert.match(errs({ risk: 'danger', cmd: 'rm -rf {d}', params: [param(['/tmp/x', '/etc'])].map((p) => ({ ...p, name: 'd' })), confirm: L('x'), preview: 'ls' }), /막힌 경로/) // 두 번째 선택지가 걸림
})

test('params: 자리표시자에 맞는 선택지 필요, 값 모양 제한, 조합 수 제한', () => {
  assert.match(errs({ cmd: 'ls {dir}' }), /params가 없어요/)
  assert.match(errs({ cmd: 'ls {x}', params: [param(['/x; rm -rf /'])] }), /선택지가 올바르지/)
  assert.match(errs({ cmd: 'ls {x}', params: [param(['-rf'])] }), /선택지가 올바르지/) // 맨 앞 - 금지 (옵션 주입)
  assert.match(errs({ cmd: 'ls {x}', params: [param(['$(id)'])] }), /선택지가 올바르지/)
  assert.match(errs({ cmd: 'ls {x}', params: [param(['a b'])] }), /선택지가 올바르지/)
  ok({ cmd: 'du {x}', params: [param(['~', '/var'])] })
  ok({ cmd: 'ls {x}', params: [param(['a-b', 'a.b', '~/x', 'a@b:c+d'])] })
  const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`)
  assert.match(errs({ cmd: 'ls {x} {y} {z}', params: ['x', 'y', 'z'].map((name) => ({ ...param(many(LIMITS.choices)), name })) }), /조합/)
  assert.match(errs({ cmd: 'ls {x}', params: [param(many(LIMITS.choices + 1))] }), /params 항목/)
  assert.match(errs({ cmd: 'ls {x}', params: [param(['a']), param(['b'])] }), /겹쳐요/)
  // 선택지 조합 중 하나라도 위험하면 올라감
  assert.equal(get({ cmd: 'systemctl {x} ssh', params: [param(['status', 'restart'])] })!.risk, 'change')
})

test('표시 방식: 묶음 개수·정규식·split·글자쌍', () => {
  assert.match(errs({ display: { type: 'table', match: '^(a)(b)$', columns: [L('a')] } }), /묶음 개수/)
  assert.match(errs({ display: { type: 'table', match: '(', columns: [L('a')] } }), /정규식/)
  assert.match(errs({ display: { type: 'table', columns: [L('a')] } }), /match 또는 split/)
  assert.match(errs({ display: { type: 'table', split: 'ws', match: 'x', columns: [L('a')] } }), /match 또는 split/)
  assert.match(errs({ display: { type: 'table', split: 'csv', columns: [L('a')] } }), /split/)
  assert.match(errs({ display: { type: 'table', split: 'ws', skip: -1, columns: [L('a')] } }), /skip/)
  ok({ display: { type: 'table', split: 'ws', skip: 1, columns: [L('a'), L('b')] } })
  ok({ display: { type: 'table', split: 'tab', columns: [L('a'), L('b')] } })
  assert.equal((get({ display: { type: 'table', split: 'tab', columns: [L('a')] } })!.display as { split: string }).split, 'tab')
  ok({ display: { type: 'table', match: '^(a)=(b)$', columns: [L('a'), L('b')], labels: { a: L('에이') } } })
  assert.match(errs({ display: { type: 'table', match: '^(a)=(b)$', columns: [L('a'), L('b')], labels: { a: 5 } } }), /labels/)
})

test('외부 팩 정규식 제한 (공식은 제한 없음)', () => {
  for (const re of ['^(a+)+$', '(x*)*', '^(\\w+\\s?)*$', '(a|b)\\1', '(?<=a)b', '(?<!a)b', '^(\\d+){2,}$']) {
    assert.ok(regexProblem(re), re)
    const groups = new RegExp(re + '|').exec('')!.length - 1
    assert.match(errs({ display: { type: 'table', match: re, columns: Array.from({ length: groups || 1 }, () => L('a')) } }), /정규식/, re)
  }
  assert.ok(regexProblem('^' + 'a'.repeat(LIMITS.matchLen)))
  assert.equal(regexProblem('^(\\S+)/(\\S+) (\\S+) \\[upgradable from: (.+)\\]$'), null)
  assert.equal(regexProblem('^(\\w+)=(.*)$'), null)
  const nested = { display: { type: 'table', match: '^(a+)+$', columns: [L('a')] } }
  assert.ok(get(nested, true)) // 공식 팩은 제한 없음 (시험으로 보호)
})

test('모르는 display.type·mode는 항목을 숨기고 남김 (조용히 깨지지 않게)', () => {
  assert.equal(get({ display: { type: 'gauge', foo: 1 } })!.hidden, 'display')
  assert.equal(get({ mode: 'future' })!.hidden, 'mode')
  assert.equal(get({})!.hidden, undefined)
  assert.equal(get({ display: { type: 'text' } })!.hidden, undefined)
  assert.match(errs({ display: { type: 5 } }), /display/)
  assert.equal(summarizePack(validatePack(pack([act({ display: { type: 'gauge' } }), act({ id: 'b' })])).pack!).hidden, 1)
})

test('terminal 모드: 터미널에 입력, 위험도는 앱이 계산', () => {
  const a = get({ mode: 'terminal', cmd: 'cd ~/proj', risk: 'change', confirm: L('x'), display: { type: 'text' } })!
  assert.equal(a.mode, 'terminal')
  assert.equal(a.enter, true)
  assert.equal(a.display, undefined)
  assert.equal(get({ mode: 'terminal', cmd: 'git status', auto: true })!.auto, undefined) // 터미널 입력은 자동 실행 없음
  assert.equal(get({ mode: 'terminal', cmd: 'git status', enter: false })!.enter, false)
  assert.equal(get({ mode: 'terminal', cmd: 'git status' })!.risk, 'read') // 읽기로 증명되면 읽기
  assert.equal(get({ mode: 'terminal', cmd: 'python train.py', risk: 'change', confirm: L('x') })!.risk, 'change')
  assert.equal(get({ mode: 'terminal', cmd: 'pkill -f train.py', risk: 'danger', confirm: L('x') })!.risk, 'danger')
  assert.equal(get({ mode: 'terminal', cmd: 'python train.py' })!.understated, true) // 읽기라고 적었지만 읽기 아님
  assert.match(errs({ mode: 'terminal', sudo: true, risk: 'change', cmd: 'ls', confirm: L('x') }), /terminal/)
  assert.match(errs({ mode: 'terminal', cmd: Array(LIMITS.terminalLines + 1).fill('ls').join('\n') }), /줄 이내/)
  ok({ mode: 'terminal', risk: 'change', cmd: Array(LIMITS.terminalLines).fill('ls').join('\n'), confirm: L('x') })
  assert.equal(get({ mode: 'terminal', cmd: 'ls\nls' })!.risk, 'change') // 여러 줄은 읽기가 아님
  assert.match(errs({ mode: 'terminal', cmd: 'rm -rf /etc', risk: 'danger', confirm: L('x') }), /막힌 경로/)
})

test('shell·when·enter·timeout 값 검사', () => {
  assert.equal(get({ shell: 'bash-i' })!.shell, 'bash-i')
  assert.equal(get({})!.shell, 'sh')
  assert.match(errs({ shell: 'zsh' }), /shell/)
  assert.equal(get({ when: 'jetson' })!.when, 'jetson')
  assert.match(errs({ when: 'pi' }), /when/)
  assert.match(errs({ enter: 'yes' }), /enter/)
  assert.match(errs({ timeout: 601 }), /timeout/)
  assert.match(errs({ timeout: 0 }), /timeout/)
  ok({ timeout: 600 })
  ok({ timeout: 1800 }, true) // 공식 팩은 1800초까지
  assert.match(errs({ timeout: 1801 }, true), /timeout/)
  assert.match(errs({ auto: 'yes' }), /auto/)
})

test('글자쌍: 외부 팩은 글자 하나·한 언어만 가능, 공식은 둘 다 필수, 제어 문자 제거·길이 제한', () => {
  assert.deepEqual(get({ label: 'Check' })!.label, { ko: 'Check', en: 'Check' })
  assert.deepEqual(get({ label: { ko: '확인' } })!.label, { ko: '확인', en: '확인' })
  assert.deepEqual(get({ label: { en: 'Check', ja: '確認' } })!.label, { ko: 'Check', en: 'Check' }) // 모르는 언어 키는 무시
  assert.deepEqual(get({ label: { ko: '가', en: 'a' } })!.label, { ko: '가', en: 'a' })
  assert.match(errs({ label: { ko: '가' } }, true), /label/)
  assert.match(errs({ label: 'x' }, true), /label/)
  assert.match(errs({ label: { ko: '', en: '' } }), /label/)
  assert.match(errs({ label: 5 }), /label/)
  assert.match(errs({ label: 'a'.repeat(LIMITS.name + 1) }), /label/)
  assert.equal(get({ label: 'a‮b\u0000c\nd' })!.label.ko, 'abc d') // BiDi·제어 문자 제거, 개행은 공백
  assert.equal(get({ desc: 'a\r\nb​' })!.desc!.ko, 'a\nb') // 설명은 줄바꿈 유지
  assert.match(errs({ desc: 'a'.repeat(LIMITS.desc + 1) }), /desc/)
  assert.match(errs({ risk: 'change', confirm: 'x'.repeat(LIMITS.confirm + 1), cmd: 'touch x' }), /confirm/)
  assert.match(errs({ params: [{ name: 'x', label: L('x'), choices: [{ value: 'a', label: { ko: '가' } }] }], cmd: 'ls {x}' }, true), /선택지/)
})

test('팩 최상위: 필수 필드·예약 id·버전·minApp·무시되는 필드', () => {
  const v = (extra: Record<string, unknown>, opts = {}) => validatePack(pack([act({})], extra), opts)
  assert.ok(v({}).pack)
  assert.equal(v({ $comment: 'memo', $schema: 'x', unknownKey: 1 }).pack!.id, 't')
  assert.ok(!v({ version: undefined }).pack)
  assert.ok(!v({ version: '1.0' }).pack)
  assert.ok(!v({ id: 'Bad Id' }).pack)
  assert.ok(!v({ id: 'a'.repeat(41) }).pack)
  assert.ok(!v({ format: 2 }).pack)
  assert.ok(!v({ name: undefined }).pack)
  assert.ok(!v({ plugins: 'x' }).pack)
  assert.ok(!validatePack({ id: 'x' }).pack)
  assert.ok(!validatePack(null).pack)
  assert.ok(!validatePack([]).pack)
  for (const id of ['device', 'ros2', 'monitor', 'perf', 'examples', 'jetdeck', 'jetdeck-tools']) {
    assert.ok(!v({ id }).pack, id) // 공식 id를 쓴 외부 팩은 거부 (사칭 방지)
    assert.match(v({ id }).errors[0], /공식 팩 전용/)
    assert.ok(v({ id }, { official: true }).pack, id)
  }
  assert.ok(!v({ minApp: '99.0.0' }, { appVersion: '5.0.0' }).pack)
  assert.match(v({ minApp: '99.0.0' }, { appVersion: '5.0.0' }).errors[0], /99\.0\.0/)
  assert.ok(v({ minApp: '5.0.0' }, { appVersion: '5.0.0' }).pack)
  assert.ok(v({ minApp: '9.9.9' }).pack) // appVersion을 안 주면 검사 안 함
  assert.ok(!v({ minApp: 'x' }).pack)
  const p = v({ author: 'me', license: 'Apache-2.0', homepage: 'https://example.com', desc: '설명' }).pack!
  assert.deepEqual([p.author, p.license, p.homepage, p.desc?.ko, p.official, p.version], ['me', 'Apache-2.0', 'https://example.com', '설명', false, '1.0.0'])
  assert.equal(v({ author: 'x'.repeat(101) }).pack!.author, undefined)
  assert.equal(compareSemver('1.2.3', '1.10.0'), -1)
  assert.equal(compareSemver('5.0.0', '5.0.0'), 0)
  assert.equal(compareSemver('5.0.1', '5.0.0-beta'), 1)
})

test('잘못된 항목만 빼고 나머지는 남김, 항목 id는 플러그인 안에서만 유일', () => {
  const r = validatePack(pack([act({ id: 'good' }), act({ id: 'bad', cmd: '' }), act({ id: 'good' })]))
  assert.deepEqual(r.pack?.plugins[0].actions.map((a) => a.id), ['good'])
  assert.equal(r.errors.length, 2)
  const two = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p1', title: L('p'), actions: [act({ id: 'same' })] }, { id: 'p2', title: L('p'), actions: [act({ id: 'same' })] }] })
  assert.equal(two.errors.length, 0) // 다른 플러그인이면 같은 항목 id 가능
  const dup = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p1', title: L('p'), actions: [act({})] }, { id: 'p1', title: L('p'), actions: [act({})] }] })
  assert.equal(dup.pack!.plugins.length, 1)
  assert.match(dup.errors[0], /겹쳐요/)
  assert.ok(!validatePack(pack([act({ cmd: '' })])).pack) // 쓸 수 있는 플러그인 없음 → 팩 제외
})

test('상한: 플러그인 20 · 플러그인당 항목 50 · 팩 전체 200 · cmd 2000자 · auto 5개', () => {
  const many = (n: number, o: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => act({ id: `a${i}`, ...o }))
  assert.equal(validatePack(pack(many(LIMITS.actionsPerPlugin))).errors.length, 0)
  assert.equal(validatePack(pack(many(LIMITS.actionsPerPlugin + 1))).pack!.plugins[0].actions.length, LIMITS.actionsPerPlugin)
  assert.match(validatePack(pack(many(LIMITS.actionsPerPlugin + 1))).errors[0], /50개/)
  const plugins = (n: number, per: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: L('p'), actions: many(per) }))
  const big = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: plugins(5, 50) })
  assert.equal(big.pack!.plugins.flatMap((p) => p.actions).length, LIMITS.actionsPerPack)
  assert.equal(validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: plugins(LIMITS.plugins + 1, 1) }).pack!.plugins.length, LIMITS.plugins)
  assert.match(errs({ cmd: 'echo ' + 'a'.repeat(LIMITS.cmd) }), /2000자/)
  const autos = validatePack(pack(many(8, { auto: true }))).pack!.plugins[0].actions
  assert.equal(autos.filter((a) => a.auto).length, LIMITS.auto)
})

test('아이콘·막대 묶음(group)은 공식 팩만, 외부 팩의 group은 무시', () => {
  const raw = (g: unknown, icon: unknown) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), group: g, icon, actions: [act({})] }] })
  assert.equal(validatePack(raw('manage', 'disk'), { official: true }).pack!.plugins[0].group, 'manage')
  assert.equal(validatePack(raw('manage', 'disk')).pack!.plugins[0].group, undefined)
  assert.equal(validatePack(raw('weird', 'disk'), { official: true }).pack!.plugins[0].group, undefined)
  assert.equal(validatePack(raw(undefined, 'Disk Icon!')).pack!.plugins[0].icon, undefined)
  assert.equal(validatePack(raw(undefined, 'disk')).pack!.plugins[0].icon, 'disk')
})

test('공식 팩 신뢰 경로: 목록에 고정된 명령만 읽기로 인정, 외부 팩에는 적용 안 됨', () => {
  const [key, cmd] = [...OFFICIAL_UNPROVEN_READS][0]
  const [packId, id] = key.split('/')
  const mk = (c: string, pid = packId) => ({ id: pid, format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), actions: [act({ id, cmd: c, auto: true })] }] })
  const trusted = validatePack(mk(cmd), { official: true }).pack!.plugins[0].actions[0]
  assert.equal(trusted.risk, 'read')
  assert.equal(trusted.understated, false)
  assert.notEqual(trusted.computed, 'read') // 앱 계산으로는 증명 안 됨
  assert.equal(trusted.auto, true)
  const changed = validatePack(mk(cmd + '; echo x'), { official: true }).pack!.plugins[0].actions[0]
  assert.equal(changed.understated, true) // 명령이 한 글자라도 바뀌면 예외가 풀림
  assert.ok(changed.risk !== 'read')
  const ext = validatePack(mk(cmd, 'my-pack')).pack!.plugins[0].actions[0]
  assert.equal(ext.understated, true)
  assert.notEqual(ext.risk, 'read')
})

test('요약: 위험도별 개수·부정확 항목', () => {
  const p = validatePack(pack([act({ id: 'r' }), act({ id: 'c', risk: 'change', cmd: 'touch x', confirm: L('x') }), act({ id: 'd', risk: 'danger', cmd: 'reboot', confirm: L('x') }), act({ id: 'u', cmd: 'kill 1' }), act({ id: 't', mode: 'terminal', cmd: 'git status' })])).pack!
  assert.deepEqual(summarizePack(p), { total: 5, read: 2, change: 2, danger: 1, understated: 1, hidden: 0, terminal: 1, stream: 0, form: 0, chart: 0, badge: 0, autoRun: 0 })
})

test('cmd·preview에 제어 문자(CR·ESC·BiDi)가 있으면 항목이 빠짐: 확인창에 보인 글자와 실제 입력이 달라지는 것 방지', () => {
  for (const c of ['ls\rrm -rf x', 'ls \x1b[2J', 'ls ‮', 'ls \x07']) {
    assert.match(errs({ cmd: c }), /제어 문자/, JSON.stringify(c))
    assert.match(errs({ mode: 'terminal', cmd: c }), /제어 문자/, JSON.stringify(c))
  }
  assert.match(errs({ risk: 'change', confirm: L('x'), cmd: 'touch a', preview: 'ls\rrm x' }), /preview/)
  ok({ mode: 'terminal', cmd: 'ls\n\tpwd' }) // 줄바꿈·탭은 허용
})
