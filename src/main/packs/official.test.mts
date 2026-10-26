import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fill } from '../packrun.mts'
import { parseChart, readLines } from '../packpollcore.mts'
import { OFFICIAL_UNPROVEN_READS, validatePack, type ChartDisplay } from '../packschema.mts'
import { analyze } from '../risk.mts'
import { OFFICIAL_DEFAULT_OFF } from '../packstore.mts'

// ros2·perf 공식 팩 (device는 device.test.mts). 통과 못 한 항목은 앱에서 조용히 빠지므로 여기서 잡음
const walk = (v: unknown, path: string): void => {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('ko' in o || 'en' in o) assert.ok(typeof o.ko === 'string' && o.ko && typeof o.en === 'string' && o.en, `ko/en 누락: ${path}`)
    else for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`)
  }
}

for (const id of ['ros2', 'perf']) {
  const raw = JSON.parse(readFileSync(new URL(`./${id}.json`, import.meta.url), 'utf8'))
  const r = validatePack(raw, { official: true })
  const all = r.pack?.plugins.flatMap((p) => p.actions) ?? []

  test(`${id}.json: 검증 통과, 한·영 모두 있음, 선언과 계산이 같음`, () => {
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.warnings, [])
    assert.equal(r.pack?.id, id)
    assert.ok(all.length > 0)
    walk(raw, id)
    for (const a of all) {
      assert.equal(a.understated, false, a.id)
      if (a.sudo) assert.ok(a.confirm, a.id)
    }
  })

  test(`${id}.json: 읽기 항목은 앱이 읽기로 증명함 (신뢰 목록 없이)`, () => {
    for (const p of raw.plugins) for (const a of p.actions) {
      if (a.risk !== 'read') continue
      assert.ok(![...OFFICIAL_UNPROVEN_READS.keys()].includes(`${id}/${a.id}`))
      const ps = a.params ?? []
      const combos = ps.length ? ps[0].choices.map((c: { value: string }) => ({ [ps[0].name]: c.value })) : [{}]
      for (const v of combos) assert.equal(analyze(fill(a.cmd, v)).risk, 'read', `${a.id}: ${fill(a.cmd, v)}`)
    }
  })
}

test('examples: 앱 동봉본 = 공개 문서 원본, 검증 통과, 선언과 계산이 같음', () => {
  const src = readFileSync(new URL('../../../docs/plugins/examples/examples.jdpack.json', import.meta.url), 'utf8')
  assert.equal(readFileSync(new URL('./examples.json', import.meta.url), 'utf8'), src)
  const r = validatePack(JSON.parse(src), { official: true })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  walk(JSON.parse(src), 'examples')
  const all = r.pack!.plugins.flatMap((p) => p.actions)
  assert.equal(all.find((a) => a.id === 'train-stop')!.risk, 'danger')
  assert.equal(all.find((a) => a.id === 'train-log')!.risk, 'read')
  assert.ok(all.some((a) => a.mode === 'terminal'))
  for (const id of ['follow-log', 'follow-train-log', 'topic-echo']) {
    const a = all.find((x) => x.id === id)!
    assert.equal(a.mode, 'stream', id)
    assert.equal(a.computed, 'read', id)
  }
})

test('ros2.json: bash-i, 그룹 dev, 내장 ROS2 탭과 제목이 다름', () => {
  const p = validatePack(JSON.parse(readFileSync(new URL('./ros2.json', import.meta.url), 'utf8')), { official: true }).pack!
  assert.deepEqual(p.plugins.map((x) => x.group), ['dev'])
  assert.notEqual(p.plugins[0].title.ko, 'ROS2')
  for (const a of p.plugins[0].actions) assert.equal(a.shell, 'bash-i')
})

test('perf.json: 모든 항목이 젯슨 전용, 스캔은 바꿈', () => {
  const p = validatePack(JSON.parse(readFileSync(new URL('./perf.json', import.meta.url), 'utf8')), { official: true }).pack!
  const all = p.plugins.filter((x) => x.id === 'perf-hw').flatMap((x) => x.actions)
  for (const a of all) assert.equal(a.when, 'jetson', a.id)
  assert.equal(all.find((a) => a.id === 'i2c-scan')!.risk, 'change')
})

test('perf.json perf-graph: 그래프 5개, minApp 5.2.0, 읽기 증명, 자동 시작 없음, 젯슨에서 읽은 출력을 파싱함', () => {
  const p = validatePack(JSON.parse(readFileSync(new URL('./perf.json', import.meta.url), 'utf8')), { official: true }).pack!
  assert.equal(p.minApp, '5.2.0')
  const all = p.plugins.find((x) => x.id === 'perf-graph')!.actions
  assert.deepEqual(all.map((a) => a.id), ['temp-chart', 'mem-chart', 'load-chart', 'gpu-chart', 'fan-chart'])
  for (const a of all) {
    assert.equal(a.display?.type, 'chart', a.id)
    assert.equal(a.risk, 'read', a.id)
    assert.equal(a.computed, 'read', a.id)
    assert.ok(!a.auto, a.id)
  }
  const d = (id: string) => all.find((a) => a.id === id)!.display as ChartDisplay
  const run = (id: string, out: string) => parseChart(d(id), readLines(out)).map((s) => s.value)
  // 입력은 Jetson(Orin급)에서 읽은 출력 모양
  const temp = run('temp-chart', '/sys/class/thermal/thermal_zone0/temp:46093\n/sys/class/thermal/thermal_zone1/temp:46468\n')
  assert.deepEqual(temp.map((v) => Math.round(v * 10) / 10), [46.1, 46.5])
  assert.deepEqual(run('mem-chart', 'MemTotal:        7665088 kB\nMemAvailable:    4162708 kB\n').map(Math.round), [7485, 4065])
  assert.deepEqual(run('load-chart', '0.04 0.08 0.08 2/947 1146595\n'), [0.04, 0.08, 0.08])
  assert.deepEqual(run('gpu-chart', '250\n'), [25])
  assert.deepEqual(run('fan-chart', '/sys/class/hwmon/hwmon0/pwm1:62\n'), [62])
  assert.equal(all.find((a) => a.id === 'gpu-chart')!.when, 'jetson')
  assert.equal(all.find((a) => a.id === 'fan-chart')!.when, 'jetson')
  assert.equal(all.find((a) => a.id === 'temp-chart')!.when, undefined)
})

test('ros2live.json: 검증 통과, 한·영, 스트림 읽기 증명, 기본 꺼짐 목록에 있음', () => {
  const raw = JSON.parse(readFileSync(new URL('./ros2live.json', import.meta.url), 'utf8'))
  const r = validatePack(raw, { official: true })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  walk(raw, 'ros2live')
  const all = r.pack!.plugins.flatMap((p) => p.actions)
  assert.deepEqual(all.map((a) => a.id), ['topic-echo', 'topic-hz'])
  for (const a of all) {
    assert.equal(a.mode, 'stream', a.id)
    assert.equal(a.computed, 'read', a.id)
    assert.equal(a.understated, false, a.id)
  }
  assert.ok(OFFICIAL_DEFAULT_OFF.has('ros2-live'))
})
