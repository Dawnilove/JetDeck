import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FailCounter, lastLine, Pacer, parseChart, POLL_FAIL_LIMIT, readLines, splitExit } from './packpollcore.mts'
import { validatePack, type ChartDisplay } from './packschema.mts'

// 5.2.0 그래프 읽기: 파서 3종(match+perLine · match+series.key · split+series.col)과 출력 방어, 간격 조절, 연속 실패
const L = (s: string) => ({ ko: s, en: s })
const chart = (d: Record<string, unknown>): ChartDisplay => {
  // 실제 검사기를 통과한 모양으로 만듦 (기본값·정규화가 같음)
  const r = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', display: { type: 'chart', ...d } }] }] })
  assert.ok(r.pack, r.errors.join('|'))
  return r.pack.plugins[0].actions[0].display as ChartDisplay
}
const parse = (d: ChartDisplay, out: string) => parseChart(d, readLines(out))
const vals = (s: { value: number }[]) => s.map((x) => x.value)

const zones = chart({ match: 'thermal_zone(\\d+)/temp:(-?\\d+)$', perLine: { label: { ko: '존 {1}', en: 'Zone {1}' }, value: 2, scale: 0.001 } })
const memD = chart({ match: '^(\\w+):\\s+(\\d+) kB$', series: [{ label: L('total'), key: 'MemTotal', scale: 0.5 }, { label: L('avail'), key: 'MemAvailable', scale: 0.5 }] })
const loadD = chart({ split: 'ws', series: [{ label: L('1m'), col: 1 }, { label: L('5m'), col: 2 }, { label: L('15m'), col: 3 }] })

test('파서 ① match+perLine: 줄마다 선 하나, label {1} 치환, scale 곱하기', () => {
  const s = parse(zones, '/sys/class/thermal/thermal_zone0/temp:45000\n/sys/class/thermal/thermal_zone1/temp:41500\n')
  assert.deepEqual(vals(s), [45, 41.5])
  assert.deepEqual(s.map((x) => x.label), [{ ko: '존 0', en: 'Zone 0' }, { ko: '존 1', en: 'Zone 1' }])
  assert.deepEqual(s.map((x) => x.key), ['0', '1'])
  assert.deepEqual(vals(parse(zones, '/sys/class/thermal/thermal_zone3/temp:-5000')), [-5])
})

test('파서 ② match+series.key: 이름표로 고름, 없는 선은 빠지고 같은 이름은 처음 것', () => {
  const s = parse(memD, 'MemTotal:       4000 kB\nMemFree:  1 kB\nMemAvailable:    1000 kB\nMemTotal: 9 kB\n')
  assert.deepEqual(vals(s), [2000, 500])
  assert.deepEqual(s.map((x) => x.key), ['s0', 's1'])
  assert.deepEqual(vals(parse(memD, 'MemAvailable: 10 kB')), [5])
})

test('파서 ③ split+series.col: 첫 줄을 칸으로 나눔 (ws·tab·csv, skip)', () => {
  assert.deepEqual(vals(parse(loadD, '0.52 0.58 0.59 1/345 12345\n')), [0.52, 0.58, 0.59])
  assert.deepEqual(vals(parse(chart({ split: 'tab', series: [{ label: L('b'), col: 2 }] }), 'a\t7\tc')), [7])
  const csv = chart({ split: 'csv', skip: 1, series: [{ label: L('a'), col: 1 }, { label: L('c'), col: 3 }] })
  assert.deepEqual(vals(parse(csv, 'x,y,z\n1, 2 ,3\n9,9,9')), [1, 3])
  assert.deepEqual(vals(parse(loadD, '0.1 0.2')), [0.1, 0.2]) // 칸이 모자라면 있는 것만
})

test('빈 출력·안 맞는 줄·글자 섞임은 점 없음', () => {
  for (const d of [zones, memD, loadD]) {
    assert.deepEqual(parse(d, ''), [])
    assert.deepEqual(parse(d, '\n\n  \n'), [])
    assert.deepEqual(parse(d, 'no such file or directory'), [])
  }
  assert.deepEqual(vals(parse(zones, 'garbage\n/x/thermal_zone0/temp:45000\nmore garbage')), [45])
  assert.deepEqual(parse(loadD, 'abc def ghi'), [])
  assert.deepEqual(vals(parse(loadD, '1 abc 3')), [1, 3])
})

test('NaN·무한대·거대 값·숫자가 아닌 글자는 버림', () => {
  const kv = chart({ match: '^(\\w+)=(\\S+)$', perLine: { label: { ko: '{1}', en: '{1}' }, value: 2 } })
  const out = ['a=NaN', 'b=Infinity', 'c=-Infinity', 'd=1e999', 'e=1e10', 'f=1000000001', 'g=0x10', 'h=1_000', 'i=', 'j=--5', 'k=5', 'l=-3.5e1', 'm=.5', 'n=1000000000', 'o=1e9'].join('\n')
  const s = parse(kv, out)
  assert.deepEqual(s.map((x) => [x.label.ko, x.value]), [['k', 5], ['l', -35], ['m', 0.5], ['n', 1e9], ['o', 1e9]])
  // scale 을 곱한 뒤에도 상한 검사
  const big = chart({ match: '^(\\w+)=(\\S+)$', perLine: { label: { ko: '{1}', en: '{1}' }, value: 2, scale: 1000 } })
  assert.deepEqual(parse(big, 'a=999999\nb=1000001'), [{ key: 'a', label: { ko: 'a', en: 'a' }, value: 999999000 }])
})

test('label {n}에 끼우는 값은 [A-Za-z0-9_.-] 20자만, 아니면 그 줄을 버림', () => {
  const d = chart({ match: '^(.+?)=(\\d+)$', perLine: { label: { ko: 'x {1}', en: 'x {1}' }, value: 2 } })
  const s = parse(d, ['ok-1.a=1', 'has space=2', '<b>x</b>=3', 'a'.repeat(20) + '=4', 'a'.repeat(21) + '=5', 'é=6'].join('\n'))
  assert.deepEqual(s.map((x) => x.label.ko), ['x ok-1.a', 'x ' + 'a'.repeat(20)])
})

test('묶음 수가 안 맞아도 죽지 않음, perLine 선은 8개까지, 같은 이름은 따로 그림', () => {
  const one = { ...memD, match: '^(\\w+):' } as ChartDisplay // 검사기를 거치지 않은 잘못된 모양 (방어)
  assert.deepEqual(parse(one, 'MemTotal: 5'), [])
  const same = chart({ match: '^v=(\\d+)$', perLine: { label: L('v'), value: 1 } })
  const s = parse(same, Array.from({ length: 12 }, (_, i) => `v=${i}`).join('\n'))
  assert.equal(s.length, 8)
  assert.equal(new Set(s.map((x) => x.key)).size, 8)
})

test('출력 읽기: 1000줄·줄 1000자까지, 제어 문자·ANSI 제거, 종료 코드 떼기', () => {
  const many = readLines(Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n'))
  assert.equal(many.length, 1000)
  assert.equal(many[999], 'l999')
  assert.equal(readLines('a'.repeat(5000))[0].length, 1000)
  assert.deepEqual(readLines('\u001b[31m12\u001b[0m\u0000\n\n 3 \r\n'), ['12', ' 3 '])
  // 한도 밖의 거대 출력도 시간 안에 끝남 (256KB로 먼저 자름)
  const t = Date.now()
  readLines('9'.repeat(5_000_000))
  assert.ok(Date.now() - t < 2000)
  assert.deepEqual(splitExit('1 2\n__EXIT__0\n'), { body: '1 2\n', code: 0 })
  assert.deepEqual(splitExit('boom\n__EXIT__127'), { body: 'boom\n', code: 127 })
  assert.deepEqual(splitExit('partial'), { body: 'partial', code: null })
  assert.equal(splitExit('x__EXIT__abc').code, null)
  assert.equal(lastLine(['a', 'b'.repeat(500)]).length, 200)
  assert.equal(lastLine([]), '')
})

test('간격 조절: 실행이 간격의 절반을 넘으면 두 배(최대 60), 빨라지면 기본까지 되돌림', () => {
  const p = new Pacer(2)
  p.record(900)
  assert.equal(p.cur, 2) // 절반(1초) 이하
  p.record(1100)
  assert.equal(p.cur, 4)
  p.record(2100)
  assert.equal(p.cur, 8)
  p.record(2500) // 간격 8의 1/4(2초)보다 느리고 절반(4초)보다 빠름 → 그대로
  assert.equal(p.cur, 8)
  p.record(1900)
  assert.equal(p.cur, 4)
  p.record(100)
  assert.equal(p.cur, 2)
  p.record(100)
  assert.equal(p.cur, 2)
  const q = new Pacer(40)
  q.record(30_000)
  assert.equal(q.cur, 60)
  q.record(59_000)
  assert.equal(q.cur, 60)
})

test('연속 실패: 5번째에 true, 성공하면 처음부터', () => {
  const f = new FailCounter()
  for (let i = 1; i < POLL_FAIL_LIMIT; i++) assert.equal(f.fail(), false)
  f.ok()
  for (let i = 1; i < POLL_FAIL_LIMIT; i++) assert.equal(f.fail(), false)
  assert.equal(f.fail(), true)
})
