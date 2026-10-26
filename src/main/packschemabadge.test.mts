import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLang } from './i18n.mts'
import { trErr } from './packerr.mts'
import { BADGE_MIN_APP, LIMITS, summarizePack, validatePack } from './packschema.mts'
import { commandMap, diffCommands } from './packstore.mts'

// 5.3.0: 최상위 badges[] 형식 검사와 읽기 전용 강제
const L = (s: string) => ({ ko: s, en: s })
const gitBadge = {
  id: 'git',
  label: { ko: 'Git 상태', en: 'Git status' },
  cmd: 'git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames',
  separator: 'nul',
  root: 'line1',
  tag: { match: '^## (.+?)(?:\\.\\.\\.|$)' },
  match: '^(.{2}) (.+)$',
  code: 1,
  path: 2,
  codes: {
    ' M': { show: 'M', text: L('수정됨'), tone: 'warn' },
    '??': { show: 'U', text: L('새 파일'), tone: 'info' },
    UU: { show: '!', text: L('충돌'), tone: 'bad' }
  }
}
const pack = (badges: unknown, extra: Record<string, unknown> = {}) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: BADGE_MIN_APP, plugins: [], badges, ...extra })
const run = (b: Record<string, unknown>, official = false) => validatePack(pack([b]), { official })
const errs = (b: Record<string, unknown>, official = false) => run(b, official).errors.join('|')
const ok = (b: Record<string, unknown>, official = false) => run(b, official).pack?.badges?.[0]

test('badge: Git 상태 배지가 통과하고 기본값이 채워짐 (플러그인 없는 팩도 가능)', () => {
  const r = run(gitBadge)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  const b = r.pack!.badges![0]
  assert.equal(b.shell, 'sh')
  assert.equal(b.folderDot, true)
  assert.equal(b.ttl, LIMITS.badgeTtlDefault)
  assert.equal(b.timeout, LIMITS.badgeTimeoutDefault)
  assert.equal(b.tag, '^## (.+?)(?:\\.\\.\\.|$)')
  assert.equal(b.codes['UU'].show, '!')
  assert.equal(Object.getPrototypeOf(b.codes), null) // 코드 이름이 prototype 속성과 겹치지 않게
  assert.equal(validatePack(pack([])).pack, null) // 플러그인도 배지도 없으면 쓸 수 없는 팩
})

test('badge: cmd는 {dir} 하나만, 따옴표·명령 이름 자리 금지', () => {
  assert.match(errs({ ...gitBadge, cmd: 'git status' }), /\{dir\}이 필요/)
  assert.match(errs({ ...gitBadge, cmd: 'ls {dir} {x}' }), /\{dir\}만/)
  assert.match(errs({ ...gitBadge, cmd: "ls '{dir}'" }), /따옴표 안/)
  assert.match(errs({ ...gitBadge, cmd: '{dir} status' }), /명령 이름 자리/)
  assert.match(errs({ ...gitBadge, cmd: 'ls $({dir})' }), /입력 자리/)
  assert.match(errs({ ...gitBadge, cmd: 'ls {dir}\r' }), /제어 문자/)
  assert.match(errs({ ...gitBadge, cmd: 'x'.repeat(2001) + ' {dir}' }), /2000자/)
  assert.match(errs({ ...gitBadge, cmd: '' }), /비었어요/)
})

test('badge: 앱이 읽기로 증명하지 못하면 배지가 빠짐 (공식 팩 예외도 없음)', () => {
  for (const cmd of ['rm -rf {dir}', 'touch {dir}/x', 'ls {dir} > /tmp/x', 'git -c core.fsmonitor=x -C {dir} status', 'git -C {dir} config core.fsmonitor evil', 'git -C {dir} fetch', 'sudo ls {dir}', 'ls {dir}; reboot']) {
    assert.match(errs({ ...gitBadge, cmd }), /읽기로 증명/, cmd)
    assert.match(errs({ ...gitBadge, cmd }, true), /읽기로 증명/, `official ${cmd}`)
    assert.equal(ok({ ...gitBadge, cmd }), undefined, cmd)
  }
  assert.ok(ok({ ...gitBadge, cmd: 'ls -A {dir}', separator: 'line', root: 'dir' }))
})

test('badge: shell·separator·root·match·code·path', () => {
  assert.match(errs({ ...gitBadge, shell: 'zsh' }), /shell/)
  assert.match(errs({ ...gitBadge, separator: 'tab' }), /separator/)
  assert.match(errs({ ...gitBadge, root: 'x' }), /root/)
  assert.match(errs({ ...gitBadge, match: 5 }), /match는 문자열/)
  assert.match(errs({ ...gitBadge, match: '(' }), /정규식이 올바르지 않아요/)
  assert.match(errs({ ...gitBadge, match: '(a+)+', code: 1, path: 2 }), /중첩 수량자/) // 외부 팩은 정규식 제한
  assert.match(errs({ ...gitBadge, match: '^(.{2}) (.+)$\\1' }), /역참조/)
  assert.match(errs({ ...gitBadge, code: 1, path: 1 }), /서로 다른 match 묶음 번호/)
  assert.match(errs({ ...gitBadge, code: 0 }), /묶음 번호/)
  assert.match(errs({ ...gitBadge, path: 3 }), /1~2/)
  assert.match(errs({ ...gitBadge, code: 1.5 }), /묶음 번호/)
  assert.equal(ok({ ...gitBadge, shell: 'bash-i' })?.shell, 'bash-i')
})

test('badge: codes 검사 (코드 1~2글자, 보이는 글자 1~2, tone은 앱 색 이름)', () => {
  const withCodes = (codes: unknown) => ({ ...gitBadge, codes })
  assert.match(errs(withCodes({})), /codes/)
  assert.match(errs(withCodes(5)), /codes/)
  assert.match(errs(withCodes({ ABC: { show: 'M', text: L('x'), tone: 'ok' } })), /1~2글자/)
  assert.match(errs(withCodes({ '': { show: 'M', text: L('x'), tone: 'ok' } })), /1~2글자/)
  assert.match(errs(withCodes({ '\n': { show: 'M', text: L('x'), tone: 'ok' } })), /1~2글자/)
  assert.match(errs(withCodes({ M: { show: 'MMM', text: L('x'), tone: 'ok' } })), /show/)
  assert.match(errs(withCodes({ M: { show: '', text: L('x'), tone: 'ok' } })), /show/)
  assert.match(errs(withCodes({ M: { show: ' ', text: L('x'), tone: 'ok' } })), /show/)
  assert.match(errs(withCodes({ M: { show: 'M‮', text: L('x'), tone: 'ok' } })), /show/)
  assert.match(errs(withCodes({ M: { show: 'M', text: L('x'), tone: 'red' } })), /tone/)
  assert.match(errs(withCodes({ M: { show: 'M', text: 5, tone: 'ok' } })), /text/)
  assert.match(errs(withCodes(JSON.parse('{"__proto__":{"show":"M","text":"x","tone":"ok"}}'))), /1~2글자/)
  assert.ok(ok(withCodes({ M: { show: '✓✓', text: L('x'), tone: 'ok' } }))) // 2글자까지
  const many = Object.fromEntries(Array.from({ length: LIMITS.badgeCodes + 1 }, (_, i) => [String(i % 100).padStart(2, 'a'), { show: 'M', text: L('x'), tone: 'ok' }]))
  assert.equal(Object.keys(many).length, LIMITS.badgeCodes + 1)
  assert.match(errs(withCodes(many)), /codes/)
})

test('badge: tag·folderDot·ttl·timeout', () => {
  assert.match(errs({ ...gitBadge, tag: { match: 'abc' } }), /tag의 match/) // 묶음 없음
  assert.match(errs({ ...gitBadge, tag: 'x' }), /tag의 match/)
  assert.match(errs({ ...gitBadge, tag: { match: '(' } }), /tag의 match/)
  assert.match(errs({ ...gitBadge, tag: { match: '((a+)+)b' } }), /tag의 match/)
  assert.equal(ok({ ...gitBadge, tag: undefined })?.tag, undefined)
  assert.match(errs({ ...gitBadge, folderDot: 'no' }), /folderDot/)
  assert.equal(ok({ ...gitBadge, folderDot: false })?.folderDot, false)
  assert.match(errs({ ...gitBadge, ttl: 2 }), /ttl/)
  assert.match(errs({ ...gitBadge, ttl: LIMITS.badgeTtlMax + 1 }), /ttl/)
  assert.match(errs({ ...gitBadge, ttl: NaN }), /ttl/)
  assert.equal(ok({ ...gitBadge, ttl: 3 })?.ttl, 3)
  assert.match(errs({ ...gitBadge, timeout: 16 }), /timeout/)
  assert.match(errs({ ...gitBadge, timeout: 0 }), /timeout/)
  assert.equal(ok({ ...gitBadge, timeout: 15 })?.timeout, 15)
})

test('badge: 팩당 개수 한도 (외부 2, 공식 4), id 겹침·형식, label 글자쌍', () => {
  const three = ['a', 'b', 'c'].map((id) => ({ ...gitBadge, id }))
  const r = validatePack(pack(three), { official: false })
  assert.equal(r.pack?.badges?.length, LIMITS.badges)
  assert.match(r.errors.join('|'), /배지는 2개까지/)
  const five = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...gitBadge, id }))
  assert.equal(validatePack(pack(five), { official: true }).pack?.badges?.length, LIMITS.badgesOfficial)
  assert.match(validatePack(pack([gitBadge, gitBadge])).errors.join('|'), /id가 겹쳐요/)
  assert.match(errs({ ...gitBadge, id: 'Git' }), /id가 올바르지 않아요/)
  assert.match(errs({ ...gitBadge, label: 5 }), /label/)
  assert.match(errs({ ...gitBadge, label: 'only ko' }, true), /둘 다/) // 공식은 글자쌍 필수
  assert.match(validatePack(pack('x')).errors.join('|'), /badges는 배열/)
  assert.match(errs({ ...gitBadge, id: undefined } as Record<string, unknown>), /id가 올바르지 않아요/)
  assert.match(validatePack(pack([5])).errors.join('|'), /배지 형식/)
})

test('badge: minApp 경고, 옛 앱에서는 팩 전체 거부, badges 없는 팩은 그대로', () => {
  assert.match(validatePack(pack([gitBadge], { minApp: undefined })).warnings.join('|'), /minApp/)
  assert.match(validatePack(pack([gitBadge], { minApp: '5.2.0' })).warnings.join('|'), /minApp/)
  assert.equal(validatePack(pack([gitBadge], { minApp: '5.3.0' })).warnings.length, 0)
  assert.match(validatePack(pack([gitBadge]), { appVersion: '5.2.0' }).errors.join('|'), /5\.3\.0 이상/)
  const old = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: '5.2.0', plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd: 'ls', risk: 'read' }] }] })
  assert.deepEqual([old.errors, old.warnings], [[], []])
  assert.equal(old.pack!.badges, undefined)
})

test('badge: 요약 개수와 허용 창 비교 (읽는 방법이 바뀌면 changed, 이름·점·간격은 아님)', () => {
  const p = validatePack(pack([gitBadge])).pack!
  const s = summarizePack(p)
  assert.equal(s.badge, 1)
  assert.equal(s.autoRun, 1) // 폴더를 열 때 저절로 실행됨
  assert.equal(s.total, 0)
  assert.equal(summarizePack(validatePack(pack([gitBadge, { ...gitBadge, id: 'g2' }])).pack!).autoRun, 2)
  const m = (b: Record<string, unknown>) => commandMap(validatePack(pack([b])).pack!)
  assert.ok(m(gitBadge)['badge:git'])
  const same = { added: [], changed: [], removed: [] }
  assert.deepEqual(diffCommands(m(gitBadge), m({ ...gitBadge, label: L('다른 이름'), folderDot: false, ttl: 9, timeout: 3 })), same)
  for (const change of [{ cmd: 'git -C {dir} rev-parse --show-toplevel' }, { match: '^(..) (.*)$' }, { separator: 'line' }, { root: 'dir' }, { tag: { match: '^## (.+)$' } }, { codes: { ' M': { show: 'M', text: L('수정됨'), tone: 'ok' } } }, { shell: 'bash-i' }]) {
    assert.deepEqual(diffCommands(m(gitBadge), m({ ...gitBadge, ...change })).changed, ['badge:git'], JSON.stringify(change))
  }
  assert.deepEqual(diffCommands({}, m(gitBadge)).added, ['badge:git'])
})

test('영어 화면: 배지 오류 문장에 한글이 남지 않음', () => {
  const bad: Record<string, unknown>[] = [
    { ...gitBadge, cmd: 'git status' }, { ...gitBadge, cmd: 'ls {x}' }, { ...gitBadge, cmd: 'rm {dir}' }, { ...gitBadge, shell: 'zsh' }, { ...gitBadge, separator: 'x' }, { ...gitBadge, root: 'x' },
    { ...gitBadge, code: 1, path: 1 }, { ...gitBadge, codes: {} }, { ...gitBadge, codes: { ABC: { show: 'M', text: L('x'), tone: 'ok' } } }, { ...gitBadge, codes: { M: { show: 'MMM', text: L('x'), tone: 'ok' } } },
    { ...gitBadge, codes: { M: { show: 'M', text: L('x'), tone: 'red' } } }, { ...gitBadge, codes: { M: { show: 'M', text: 5, tone: 'ok' } } }, { ...gitBadge, tag: { match: 'abc' } }, { ...gitBadge, folderDot: 1 },
    { ...gitBadge, ttl: 1 }, { ...gitBadge, timeout: 99 }, { ...gitBadge, id: 'A' }, { ...gitBadge, label: 5 }, { ...gitBadge, match: 5 }, { ...gitBadge, match: '(' }, { ...gitBadge, cmd: '' }
  ]
  setLang('en')
  try {
    const msgs: string[] = []
    for (const b of bad) {
      const r = validatePack(pack([b, { ...gitBadge, id: 'ok1' }]))
      msgs.push(...r.errors, ...r.warnings)
    }
    msgs.push(...validatePack(pack(['x'])).errors, ...validatePack(pack([gitBadge, { ...gitBadge, id: 'b' }, { ...gitBadge, id: 'c' }])).errors, ...validatePack(pack([gitBadge], { minApp: undefined })).warnings, ...validatePack(pack([gitBadge, gitBadge])).errors, ...validatePack(pack('x')).errors)
    assert.ok(msgs.length > 20)
    const left = msgs.map(trErr).filter((m) => /[가-힣]/.test(m))
    assert.deepEqual(left, [])
  } finally {
    setLang('ko')
  }
})
