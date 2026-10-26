import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLang } from './i18n.mts'
import { trErr } from './packerr.mts'
import { CHART_MIN_APP, LIMITS, OFFICIAL_UNPROVEN_READS, summarizePack, validatePack } from './packschema.mts'
import { commandMap, diffCommands } from './packstore.mts'

// 5.2.0: display.type:"chart" 형식 검사와 읽기 전용 강제
const L = (s: string) => ({ ko: s, en: s })
const pack = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: CHART_MIN_APP, plugins: [{ id: 'p', title: L('p'), actions }], ...extra })
const act = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', ...o })
const run = (o: Record<string, unknown>, official = false, extra: Record<string, unknown> = {}) => validatePack(pack([act(o)], extra), { official })
const errs = (o: Record<string, unknown>, official = false) => run(o, official).errors.join('|')
const get = (o: Record<string, unknown>, official = false) => run(o, official).pack?.plugins[0].actions[0]
const temp = { cmd: 'grep -H . /sys/class/thermal/thermal_zone*/temp', display: { type: 'chart', unit: '℃', min: 0, max: 100, match: 'thermal_zone(\\d+)/temp:(-?\\d+)$', perLine: { label: { ko: '존 {1}', en: 'Zone {1}' }, value: 2, scale: 0.001 } } }
const mem = { cmd: "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo", display: { type: 'chart', match: '^(\\w+):\\s+(\\d+) kB$', series: [{ label: L('전체'), key: 'MemTotal', scale: 0.0009765625 }, { label: L('가용'), key: 'MemAvailable' }] } }
const load = { cmd: 'cat /proc/loadavg', display: { type: 'chart', split: 'ws', min: 0, series: [{ label: L('1m'), col: 1 }, { label: L('5m'), col: 2 }, { label: L('15m'), col: 3 }] } }
const withDisplay = (base: typeof temp | typeof mem | typeof load, d: Record<string, unknown>) => ({ ...base, display: { ...base.display, ...d } })

test('chart: 파서 3종이 통과하고 기본값이 채워짐', () => {
  for (const x of [temp, mem, load]) {
    const a = get(x)!
    assert.ok(a, errs(x))
    assert.equal(a.risk, 'read')
    assert.equal(a.display?.type, 'chart')
    assert.equal(a.timeout, LIMITS.chartTimeoutDefault)
  }
  const d = get(load)!.display as { every: number; points: number; series: { scale: number }[] }
  assert.equal(d.every, 2)
  assert.equal(d.points, 300)
  assert.equal(d.series[0].scale, 1)
  assert.equal(run(temp).warnings.length, 0)
})

test('chart: mode exec 전용, fields·params·sudo·preview 금지, risk는 read', () => {
  assert.match(errs({ ...temp, mode: 'stream' }), /mode가 exec/)
  assert.match(errs({ ...temp, mode: 'terminal' }), /mode가 exec/)
  assert.match(errs({ ...temp, sudo: true, risk: 'change', confirm: L('x') }), /sudo|read/)
  assert.match(errs({ ...temp, preview: 'ls' }), /preview/)
  assert.match(errs({ ...temp, params: [{ name: 'x', label: L('x'), choices: [{ value: 'a', label: L('a') }] }] }), /params/)
  assert.match(errs({ ...temp, fields: [{ name: 'x', label: L('x'), type: 'flag', on: '-x' }] }), /fields/)
  assert.match(errs({ ...temp, risk: 'change', confirm: L('x') }), /risk가 read/)
})

test('chart: 앱 계산이 읽기가 아니면 항목이 빠짐 (경고만 하지 않음), 공식 예외도 못 씀', () => {
  const r = run({ ...temp, cmd: 'rm -rf /tmp/x' })
  assert.equal(r.pack, null)
  assert.match(errs({ ...temp, cmd: 'cat /proc/loadavg > /tmp/x' }), /읽기로 증명/)
  assert.match(errs({ ...load, cmd: 'journalctl -f' }), /읽기로 증명/) // 스트림 목록은 exec 모드에서 읽기가 아님
  // 공식 팩의 고정된 예외 명령이라도 chart 에서는 거부
  const [key, cmd] = [...OFFICIAL_UNPROVEN_READS.entries()][0]
  const [pid, aid] = key.split('/')
  assert.ok(validatePack(pack([act({ id: aid, cmd })], { id: pid }), { official: true }).pack, '그래프가 아니면 예외로 통과')
  const o = validatePack(pack([act({ id: aid, cmd, display: load.display })], { id: pid }), { official: true })
  assert.equal(o.pack, null)
  assert.match(o.errors.join('|'), /읽기로 증명/)
})

test('chart: every·points·timeout 한도 (공식은 0.5초부터)', () => {
  assert.match(errs(withDisplay(temp, { every: 0.5 })), /every/)
  assert.ok(get(withDisplay(temp, { every: 1 })))
  const offLoad = { ...withDisplay(load, { every: 0.5 }), label: L('l') }
  assert.ok(get(offLoad, true), errs(offLoad, true))
  assert.match(errs(withDisplay(load, { every: 61 })), /every/)
  assert.match(errs(withDisplay(load, { every: NaN })), /every/)
  assert.match(errs(withDisplay(load, { points: 9 })), /points/)
  assert.match(errs(withDisplay(load, { points: 3601 })), /points/)
  assert.match(errs(withDisplay(load, { points: 10.5 })), /points/)
  assert.equal((get(withDisplay(load, { points: 3600 }))!.display as { points: number }).points, 3600)
  assert.equal(get({ ...load, timeout: 30 })!.timeout, 30)
  assert.match(errs({ ...load, timeout: 31 }), /timeout/)
  assert.match(errs({ ...load, timeout: 31 }, true), /timeout/)
  assert.match(errs(withDisplay(load, { unit: 'x'.repeat(9) })), /unit/)
  assert.match(errs(withDisplay(load, { min: 5, max: 5 })), /min은 max보다/)
  assert.match(errs(withDisplay(load, { max: Infinity })), /min·max/)
  assert.match(errs(withDisplay(load, { min: 2e9 })), /min·max/)
})

test('chart: match/split, perLine/series 짝 규칙', () => {
  assert.match(errs({ ...load, display: { ...load.display, match: '(a)(b)' } }), /match 또는 split/)
  assert.match(errs({ cmd: 'ls', display: { type: 'chart', series: load.display.series } }), /match 또는 split/)
  assert.match(errs({ ...temp, display: { ...temp.display, series: mem.display.series } }), /perLine 또는 series/)
  assert.match(errs({ ...temp, display: { ...temp.display, perLine: undefined } }), /perLine 또는 series/)
  assert.match(errs({ ...load, display: { ...load.display, split: 'x' } }), /split/)
  assert.ok(get({ ...load, display: { ...load.display, split: 'csv', skip: 1 } }))
  assert.match(errs({ ...temp, display: { ...temp.display, skip: 1 } }), /skip/)
  assert.match(errs({ ...load, display: { ...load.display, skip: -1 } }), /skip/)
  // perLine 은 match 와, series.col 은 split 과, series.key 는 match 와
  assert.match(errs({ ...load, display: { type: 'chart', split: 'ws', perLine: temp.display.perLine } }), /perLine은 match/)
  assert.match(errs(withDisplay(load, { series: mem.display.series })), /col/)
  assert.match(errs(withDisplay(mem, { series: load.display.series })), /key/)
  assert.match(errs(withDisplay(mem, { match: '^(\\w+):\\s+\\d+ kB$' })), /묶음이 정확히 2개/)
  assert.match(errs(withDisplay(mem, { match: '^(\\w+):\\s+(\\d+) (kB)$' })), /묶음이 정확히 2개/)
  // 묶음 번호
  assert.match(errs(withDisplay(temp, { perLine: { ...temp.display.perLine, value: 3 } })), /value/)
  assert.match(errs(withDisplay(temp, { perLine: { ...temp.display.perLine, value: 0 } })), /value/)
  assert.match(errs(withDisplay(temp, { perLine: { ...temp.display.perLine, label: L('존 {3}') } })), /label \{n\}/)
  assert.ok(get(withDisplay(temp, { perLine: { ...temp.display.perLine, label: L('존 {1}/{2}') } })))
  // 정규식 제한 (외부 팩만)
  assert.match(errs(withDisplay(temp, { match: '((a+)+)(b)' })), /중첩 수량자/)
  assert.match(errs(withDisplay(temp, { match: '(' })), /정규식이 올바르지 않아요/)
  // 배열 크기·겹침
  const nine = Array.from({ length: LIMITS.chartLines + 1 }, (_, i) => ({ label: L(`s${i}`), col: i + 1 }))
  assert.match(errs(withDisplay(load, { series: nine })), /series/)
  assert.ok(get(withDisplay(load, { series: nine.slice(0, LIMITS.chartLines) })))
  assert.match(errs(withDisplay(load, { series: [] })), /series/)
  assert.match(errs(withDisplay(load, { series: [{ label: L('a'), col: 1 }, { label: L('b'), col: 1 }] })), /col이 겹쳐요/)
  assert.match(errs(withDisplay(mem, { series: [{ label: L('a'), key: 'A' }, { label: L('b'), key: 'A' }] })), /key가 겹쳐요/)
  assert.match(errs(withDisplay(load, { series: [{ label: L('a'), col: 0 }] })), /col/)
  assert.match(errs(withDisplay(load, { series: [{ label: L('a'), col: 1, scale: 0 }] })), /series 항목/)
  assert.match(errs(withDisplay(load, { series: [{ label: L('a'), col: 1, scale: NaN }] })), /series 항목/)
  assert.match(errs(withDisplay(mem, { series: [{ label: L('a'), key: 'a b' }] })), /key/)
})

test('chart: auto 는 팩당 5개 한도에 포함, 안 읽히는 값은 거부', () => {
  const many = Array.from({ length: LIMITS.auto + 1 }, (_, i) => act({ ...load, id: `c${i}`, auto: true }))
  const r = validatePack(pack(many))
  const a = r.pack!.plugins[0].actions
  assert.equal(a.filter((x) => x.auto).length, LIMITS.auto)
  assert.ok(r.warnings.some((w) => w.includes('auto')))
  assert.equal(summarizePack(r.pack!).autoRun, LIMITS.auto)
})

test('chart: 요약 개수·minApp 경고·5.1.0 팩은 그대로', () => {
  const p = validatePack(pack([act({ id: 'a', ...temp }), act({ id: 'b', ...load }), act({ id: 'c' })])).pack!
  const s = summarizePack(p)
  assert.equal(s.chart, 2)
  assert.equal(s.total, 3)
  assert.equal(s.stream, 0)
  // 그래프가 있는데 minApp 이 없으면 경고 (옛 앱이 팩 전체를 거부하게 하려는 안내)
  assert.match(validatePack(pack([act(temp)], { minApp: undefined })).warnings.join('|'), /minApp/)
  assert.match(validatePack(pack([act(temp)], { minApp: '5.1.0' })).warnings.join('|'), /minApp/)
  assert.equal(validatePack(pack([act(temp)], { minApp: '5.2.0' })).warnings.length, 0)
  // 5.1.0 팩: 그래프 없음, 경고도 없음
  const old = validatePack(pack([act({ cmd: 'ls' }), act({ id: 'f', mode: 'stream', cmd: 'journalctl -f --no-pager' })], { minApp: '5.1.0' }))
  assert.equal(old.errors.length, 0)
  assert.equal(old.warnings.length, 0)
  assert.equal(summarizePack(old.pack!).chart, 0)
  // 이 앱이 5.1.0이면 minApp 5.2.0 팩 전체를 거부
  assert.match(validatePack(pack([act(temp)]), { appVersion: '5.1.0' }).errors.join('|'), /5\.2\.0 이상/)
})

test('chart: 허용 창 비교 — 읽는 방법이 바뀌면 changed, 단위·범위·점 수는 아님', () => {
  const m = (x: unknown) => commandMap(validatePack(pack([act(x as Record<string, unknown>)])).pack!)
  assert.ok(m(temp)['p/a'].includes('chart:'))
  assert.deepEqual(diffCommands(m(temp), m(withDisplay(temp, { unit: 'C', min: 1, max: 90, points: 100 }))), { added: [], changed: [], removed: [] })
  assert.deepEqual(diffCommands(m(temp), m(withDisplay(temp, { every: 5 }))).changed, ['p/a'])
  assert.deepEqual(diffCommands(m(temp), m(withDisplay(temp, { match: 'thermal_zone(\\d+)/temp:(-?\\d+)' }))).changed, ['p/a'])
  assert.deepEqual(diffCommands(m(temp), m(withDisplay(temp, { perLine: { ...temp.display.perLine, scale: 1 } }))).changed, ['p/a'])
  assert.deepEqual(diffCommands(m(load), m(withDisplay(load, { series: [{ label: L('x'), col: 1 }] }))).changed, ['p/a'])
  // 그래프가 아닌 항목의 키는 5.1.0과 같음
  assert.equal(commandMap(validatePack(pack([act({})])).pack!)['p/a'], 'ls\u0000exec')
})

test('영어 화면: 그래프 오류 문장에 한글이 남지 않음', () => {
  const bad: Record<string, unknown>[] = [
    { ...temp, mode: 'stream' }, { ...temp, preview: 'ls' }, { ...temp, params: [] }, { ...temp, risk: 'change', confirm: L('x') }, { ...load, cmd: 'cat /proc/loadavg > /tmp/x' },
    withDisplay(load, { every: 0 }), withDisplay(load, { points: 1 }), withDisplay(load, { unit: 'x'.repeat(9) }), withDisplay(load, { min: 'a' }), withDisplay(load, { min: 5, max: 1 }),
    { ...load, display: { ...load.display, match: 'x' } }, { cmd: 'ls', display: { type: 'chart', series: load.display.series } }, { ...temp, display: { ...temp.display, series: [] } },
    { ...load, display: { ...load.display, split: 'x' } }, { ...temp, display: { ...temp.display, skip: 1 } }, withDisplay(temp, { match: 5 }), withDisplay(temp, { match: '(' }), withDisplay(temp, { match: '((a+)+)(b)' }),
    { ...load, display: { type: 'chart', split: 'ws', perLine: temp.display.perLine } }, withDisplay(temp, { perLine: 5 }), withDisplay(temp, { perLine: { ...temp.display.perLine, value: 3 } }),
    withDisplay(temp, { perLine: { ...temp.display.perLine, label: L('{3}') } }), withDisplay(load, { series: 5 }), withDisplay(load, { series: [5] }), withDisplay(load, { series: mem.display.series }),
    withDisplay(mem, { series: load.display.series }), withDisplay(mem, { match: '(a)' }), withDisplay(mem, { series: [{ label: L('a'), key: 'A' }, { label: L('b'), key: 'A' }] }), withDisplay(load, { series: [{ label: L('a'), col: 1 }, { label: L('b'), col: 1 }] }), { ...load, timeout: 99 }
  ]
  setLang('en')
  try {
    const msgs: string[] = []
    for (const x of bad) {
      const r = validatePack(pack([act({ id: 'ok' }), act(x)]), { official: false })
      msgs.push(...r.errors, ...r.warnings)
    }
    msgs.push(...validatePack(pack([act(temp)], { minApp: undefined })).warnings)
    assert.ok(msgs.length >= bad.length, String(msgs.length))
    const left = msgs.map(trErr).filter((m) => /[가-힣]/.test(m))
    assert.deepEqual(left, [])
  } finally {
    setLang('ko')
  }
})
