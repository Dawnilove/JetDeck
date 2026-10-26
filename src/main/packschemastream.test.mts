import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLang } from './i18n.mts'
import { trErr } from './packerr.mts'
import { buildStream, resolveParams } from './packrun.mts'
import { LIMITS, summarizePack, validatePack } from './packschema.mts'
import { commandMap, diffCommands } from './packstore.mts'

// 5.1.0: 입력 폼(fields)·흐르는 출력(mode:'stream')·log 표시의 형식 검사
const L = (s: string) => ({ ko: s, en: s })
const pack = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), actions }], ...extra })
const act = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', ...o })
const errs = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).errors.join('|')
const get = (o: Record<string, unknown>, official = false) => validatePack(pack([act(o)]), { official }).pack?.plugins[0].actions[0]
const ok = (o: Record<string, unknown>, official = false) => assert.ok(get(o, official), errs(o, official))
const sel = { name: 'unit', label: L('unit'), type: 'select', choices: [{ value: 'ssh', label: L('ssh') }, { value: 'docker', label: L('docker') }] }
const lines = { name: 'lines', label: L('lines'), type: 'int', min: 10, max: 500, default: '50' }
const topic = { name: 'topic', label: L('topic'), type: 'select', from: { cmd: 'ros2 topic list', shell: 'bash-i', charset: 'ros' } }
const follow = { mode: 'stream', cmd: 'journalctl -u {unit} -n {lines} -f --no-pager', fields: [sel, lines] }
const BS = String.fromCharCode(92)

test('흐르는 출력: journalctl -f 는 읽기로 증명, 기본 표시 log·기본 timeout 600', () => {
  const a = get(follow)!
  assert.equal(a.mode, 'stream')
  assert.equal(a.risk, 'read')
  assert.equal(a.understated, false)
  assert.equal(a.timeout, 600)
  assert.deepEqual(a.display, { type: 'log', maxLines: 1000, wrap: true })
  assert.equal(a.hidden, undefined)
  assert.equal(get({ ...follow, display: { type: 'log', maxLines: 200, wrap: false }, timeout: 900 })!.timeout, 900)
  // 같은 명령이 exec 모드면 읽기가 아님 (끝나지 않는 명령)
  assert.equal(get({ cmd: 'journalctl -f', risk: 'change', confirm: L('x') })!.risk, 'change')
})

test('흐르는 출력: 읽기가 아닌 스트림은 위험도가 올라가고 확인이 필요', () => {
  const a = get({ mode: 'stream', cmd: 'ros2 launch pkg x.py', risk: 'change', confirm: L('x') })!
  assert.equal(a.risk, 'change')
  assert.equal(get({ mode: 'stream', cmd: 'tail -f /etc/shadow' })!.risk, 'danger')
  assert.equal(get({ mode: 'stream', cmd: 'ros2 topic echo --filter "1" /x' })!.understated, true)
  assert.match(errs({ mode: 'stream', cmd: 'ros2 launch pkg x.py', risk: 'change' }), /confirm/)
})

test('흐르는 출력: 금지 조합', () => {
  assert.match(errs({ ...follow, sudo: true, risk: 'change', confirm: L('x') }), /stream 항목은 sudo/)
  assert.match(errs({ ...follow, auto: true }), /stream 항목은 auto/)
  assert.match(errs({ ...follow, preview: 'ls', risk: 'change', confirm: L('x') }), /preview/)
  assert.match(errs({ ...follow, display: { type: 'text' } }), /display가 log/)
  assert.match(errs({ cmd: 'ls', display: { type: 'log' } }), /stream인 항목에서만/)
  assert.match(errs({ ...follow, display: { type: 'log', maxLines: 5 } }), /maxLines/)
  assert.match(errs({ ...follow, display: { type: 'log', wrap: 1 } }), /wrap/)
  assert.match(errs({ ...follow, timeout: 99999 }), /timeout/)
  assert.ok(get({ ...follow, timeout: LIMITS.timeoutStreamExternal }))
  assert.match(errs({ ...follow, timeout: LIMITS.timeoutStreamExternal + 1 }), /timeout/)
  assert.ok(get({ ...follow, timeout: LIMITS.timeoutStreamOfficial }, true))
  assert.match(errs({ mode: 'stream', cmd: 'rm -rf /tmp/x', risk: 'danger', confirm: L('x') }), /삭제·설치·디스크/)
  assert.equal(get({ ...follow, mode: 'stream2' })!.hidden, 'mode') // 모르는 방식은 숨김
})

test('입력 폼: 필드 모양 검사', () => {
  ok({ cmd: 'ros2 topic echo {topic}', mode: 'stream', shell: 'bash-i', fields: [topic] })
  assert.equal(get({ cmd: 'ls {p}', fields: [{ name: 'p', label: L('p'), type: 'path' }] })!.fields![0].type, 'path')
  ok({ cmd: 'grep -e {q} /var/log/syslog', fields: [{ name: 'q', label: L('q'), type: 'text', charset: 'free', maxLen: 80 }] })
  ok({ cmd: 'ls {a}', fields: [{ name: 'a', label: 'a', type: 'flag', on: '-l' }] })
  const cases: [unknown, RegExp][] = [
    [{ ...sel, type: 'nope' }, /type/],
    [{ ...sel, name: 'a-b' }, /name/],
    [{ ...sel, label: 5 }, /label/],
    [{ ...sel, choices: [] }, /choices/],
    [{ ...sel, from: topic.from }, /choices 또는 from/],
    [{ name: 'unit', label: L('u'), type: 'select' }, /choices 또는 from/],
    [{ ...sel, choices: [{ value: '-rf', label: L('x') }] }, /선택지/],
    [{ ...sel, choices: [{ value: 'a b', label: L('x') }] }, /선택지/],
    [{ ...topic, from: { cmd: '', charset: 'ros' } }, /from/],
    [{ ...topic, from: { cmd: 'x', charset: 'any' } }, /from/],
    [{ ...topic, from: { cmd: 'x', timeout: 99 } }, /from/],
    [{ ...topic, from: { cmd: 'x', max: 9999 } }, /from/],
    [{ name: 'unit', label: L('u'), type: 'text', charset: 'weird' }, /charset/],
    [{ name: 'unit', label: L('u'), type: 'text', maxLen: 999 }, /maxLen/],
    [{ name: 'unit', label: L('u'), type: 'int', min: -1, max: 5 }, /int/],
    [{ name: 'unit', label: L('u'), type: 'int', min: 5, max: 1 }, /int/],
    [{ name: 'unit', label: L('u'), type: 'path', maxLen: 9999 }, /maxLen/],
    [{ name: 'unit', label: L('u'), type: 'flag', on: 'a b' }, /flag/],
    [{ name: 'unit', label: L('u'), type: 'flag' }, /flag/],
    [{ ...lines, name: 'unit', default: '9999' }, /default/],
    [{ ...sel, default: 'x' }, /default/],
    [{ ...sel, required: 'yes' }, /required/],
    [5, /fields 항목/]
  ]
  for (const [f, re] of cases) assert.match(errs({ cmd: 'echo {unit}', fields: [f] }), re, JSON.stringify(f))
  assert.match(errs({ cmd: 'echo {unit}', fields: 'x' }), /배열/)
  assert.match(errs({ cmd: 'echo {unit}', fields: [] }), /fields는 1~/)
  assert.match(errs({ cmd: 'echo {unit}', fields: [sel, sel] }), /겹쳐/)
  assert.match(errs({ cmd: 'echo {unit}', fields: [sel], params: [{ name: 'x', label: L('x'), choices: [{ value: 'a', label: L('a') }] }] }), /같이 쓸 수 없/)
  assert.match(errs({ cmd: 'echo {unit}', fields: Array.from({ length: 7 }, (_, i) => ({ ...sel, name: `u${i}` })) }), /fields는 1~6/)
  assert.match(errs({ cmd: 'echo {nope}', fields: [sel] }), /nope/)
  assert.match(errs({ cmd: 'echo', fields: [sel] }), /쓰지 않아요/) // 안 쓰는 필드
})

test('입력 폼: 슬롯 위치 규칙과 sudo 제한', () => {
  for (const cmd of ["echo '{unit}'", 'echo "{unit}"', '{unit} -l', 'sh -c {unit}', 'echo $({unit})', 'ls > {unit}']) assert.match(errs({ cmd, fields: [sel] }), /입력 자리/, cmd)
  // 옛 params 는 5.0.0 규칙 그대로 (따옴표 안 슬롯도 통과)
  ok({ cmd: "echo '{x}'", params: [{ name: 'x', label: L('x'), choices: [{ value: 'a', label: L('a') }] }] })
  const txt = { name: 'q', label: L('q'), type: 'text' }
  assert.match(errs({ cmd: 'ufw allow {q}', risk: 'change', sudo: true, confirm: L('x'), fields: [txt] }), /sudo 항목은 text/)
  ok({ cmd: 'systemctl restart {unit}', risk: 'change', sudo: true, confirm: L('x'), fields: [sel] })
})

test('입력 폼: from 목록 명령은 읽기 전용이어야 하고 자동 실행 한도에 듦', () => {
  assert.match(errs({ cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: 'rm -rf x', charset: 'ros' } }] }), /from 목록 명령은 읽기/)
  assert.match(errs({ cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: 'ls {x}', charset: 'ros' } }] }), /입력 자리/)
  assert.match(errs({ cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: 'ros2 launch a b', charset: 'ros' } }] }), /읽기/)
  const six = Array.from({ length: LIMITS.auto + 1 }, (_, i) => act({ id: `a${i}`, cmd: 'echo {topic}', fields: [topic] }))
  const r = validatePack(pack(six))
  assert.equal(r.pack!.plugins[0].actions.length, LIMITS.auto) // 6번째부터 거부
  assert.match(r.errors.join('|'), /자동으로 돌아가는 것/)
})

test('입력 폼: 위험도는 대표 값으로 계산하고 5.0.0 항목은 그대로', () => {
  assert.equal(get({ cmd: 'tail -n {n} {p}', fields: [{ name: 'n', label: L('n'), type: 'int', min: 1, max: 100 }, { name: 'p', label: L('p'), type: 'path' }] })!.risk, 'read')
  assert.equal(get({ cmd: 'awk {prog} /proc/loadavg', fields: [{ name: 'prog', label: L('p'), type: 'text', charset: 'free' }] })!.risk, 'read') // 대표 값 sample 은 읽기 → 실행 직전 재분석이 맡음
  assert.equal(get({ cmd: 'rm {p}', risk: 'danger', confirm: L('x'), preview: 'ls {p}', fields: [{ name: 'p', label: L('p'), type: 'path' }] })!.risk, 'danger')
  assert.equal(get({ cmd: 'ls' })!.fields, undefined)
})

test('resolveParams: 입력 필드 값을 검사해 명령 글자로', () => {
  const a = get({ cmd: 'journalctl -u {unit} -n {lines} --no-pager', fields: [sel, lines] })!
  assert.deepEqual(resolveParams(a, {}), { unit: 'ssh', lines: '50' })
  assert.deepEqual(resolveParams(a, { unit: 'docker', lines: '200' }), { unit: 'docker', lines: '200' })
  assert.throws(() => resolveParams(a, { unit: 'ssh; reboot' }))
  assert.throws(() => resolveParams(a, { lines: '5000' }))
  const t = get({ cmd: 'grep -e {q} /var/log/syslog', fields: [{ name: 'q', label: L('q'), type: 'text', charset: 'free' }] })!
  assert.deepEqual(resolveParams(t, { q: "a'b; reboot" }), { q: `'a'${BS}''b; reboot'` })
  assert.throws(() => resolveParams(t, { q: '-v' }))
})

test('buildStream: pty에서 그대로 실행할 명령 (timeout 으로 감싸지 않음)', () => {
  const a = get(follow)!
  assert.equal(buildStream(a, resolveParams(a, { unit: 'docker', lines: '20' })), "sh -c 'journalctl -u docker -n 20 -f --no-pager'")
  const r = get({ mode: 'stream', shell: 'bash-i', cmd: 'ros2 topic echo {topic}', fields: [topic] })!
  assert.equal(buildStream(r, { topic: "'/scan'" }), `bash -ic 'ros2 topic echo '${BS}''/scan'${BS}'''`)
  assert.ok(buildStream(get({ mode: 'stream', cmd: 'git -C /tmp log -f' })!, {}).includes('git()')) // git 보호 함수
})

test('요약: 실시간·입력·자동으로 돌아가는 것 개수', () => {
  const p = validatePack(pack([act({ id: 'a', ...follow }), act({ id: 'b', cmd: 'echo {topic}', fields: [topic] }), act({ id: 'c', auto: true }), act({ id: 'd' })])).pack!
  const s = summarizePack(p)
  assert.equal(s.stream, 1)
  assert.equal(s.form, 2)
  assert.equal(s.autoRun, 2) // from 목록 1 + auto 1
  assert.equal(s.total, 4)
})

test('바뀐 명령 비교: 입력 필드가 바뀌면 changed, 필드 없는 항목의 키는 5.0.0과 같음', () => {
  const plain = validatePack(pack([act({})])).pack!
  assert.equal(commandMap(plain)['p/a'], 'ls\u0000exec') // 5.0.0 과 같은 모양 (허용했던 팩이 괜히 바뀜으로 뜨지 않게)
  const v1 = validatePack(pack([act({ id: 'a', ...follow })])).pack!
  const v2 = validatePack(pack([act({ id: 'a', ...follow, fields: [{ ...sel, choices: [...sel.choices, { value: 'cron', label: L('cron') }] }, lines] })])).pack!
  assert.deepEqual(diffCommands(commandMap(v1), commandMap(v2)), { added: [], changed: ['p/a'], removed: [] })
  assert.deepEqual(diffCommands(commandMap(v1), commandMap(v1)), { added: [], changed: [], removed: [] })
})

test('영어 화면: 새 오류 문장에 한글이 남지 않음', () => {
  const bad: unknown[] = [
    { ...follow, sudo: true, risk: 'change', confirm: L('x') }, { ...follow, auto: true }, { ...follow, preview: 'ls' }, { ...follow, display: { type: 'text' } }, { cmd: 'ls', display: { type: 'log' } },
    { ...follow, display: { type: 'log', maxLines: 5 } }, { ...follow, display: { type: 'log', wrap: 1 } }, { ...follow, timeout: 99999 }, { mode: 'stream', cmd: 'rm -rf /tmp/x', risk: 'danger', confirm: L('x') },
    { cmd: 'echo {unit}', fields: 'x' }, { cmd: 'echo {unit}', fields: [] }, { cmd: 'echo {unit}', fields: [sel, sel] }, { cmd: 'echo {unit}', fields: [sel], params: [sel] }, { cmd: 'echo', fields: [sel] },
    { cmd: 'echo {unit}', fields: [{ ...sel, type: 'x' }] }, { cmd: 'echo {unit}', fields: [{ ...sel, name: 'a-b' }] }, { cmd: 'echo {unit}', fields: [{ ...sel, label: 5 }] }, { cmd: 'echo {unit}', fields: [{ ...sel, desc: 5 }] },
    { cmd: 'echo {unit}', fields: [{ ...sel, required: 1 }] }, { cmd: 'echo {unit}', fields: [{ ...sel, choices: [] }] }, { cmd: 'echo {unit}', fields: [{ ...sel, from: topic.from }] },
    { cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: '', charset: 'ros' } }] }, { cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: 'rm x', charset: 'ros' } }] }, { cmd: 'echo {topic}', fields: [{ ...topic, from: { cmd: 'ls {x}', charset: 'ros' } }] },
    { cmd: 'echo {unit}', fields: [{ name: 'unit', label: L('u'), type: 'text', charset: 'x' }] }, { cmd: 'echo {unit}', fields: [{ name: 'unit', label: L('u'), type: 'text', maxLen: 999 }] },
    { cmd: 'echo {unit}', fields: [{ name: 'unit', label: L('u'), type: 'int', min: -1 }] }, { cmd: 'echo {unit}', fields: [{ name: 'unit', label: L('u'), type: 'flag' }] }, { cmd: 'echo {unit}', fields: [{ ...lines, name: 'unit', default: '9999' }] },
    { cmd: "echo '{unit}'", fields: [sel] }, { cmd: 'sh -c {unit}', fields: [sel] }, { cmd: 'echo $({unit})', fields: [sel] }, { cmd: 'ls > {unit}', fields: [sel] }, { cmd: '{unit} -l', fields: [sel] }, { cmd: 'env {unit}', fields: [sel] }, { cmd: 'ls $X{unit}', fields: [sel] },
    { cmd: 'ufw allow {q}', risk: 'change', sudo: true, confirm: L('x'), fields: [{ name: 'q', label: L('q'), type: 'text' }] }
  ]
  setLang('en')
  try {
    const msgs: string[] = []
    for (const x of bad) {
      const r = validatePack(pack([act({ id: 'ok' }), act({ ...(x as object) })]))
      msgs.push(...r.errors, ...r.warnings)
    }
    const six = Array.from({ length: LIMITS.auto + 1 }, (_, i) => act({ id: `a${i}`, cmd: 'echo {topic}', fields: [topic] }))
    msgs.push(...validatePack(pack(six)).errors)
    assert.ok(msgs.length > 35, String(msgs.length))
    const left = msgs.map(trErr).filter((m) => /[가-힣]/.test(m))
    assert.deepEqual(left, [])
  } finally {
    setLang('ko')
  }
})
