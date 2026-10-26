import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fill } from '../packrun.mts'
import { OFFICIAL_UNPROVEN_READS, validatePack } from '../packschema.mts'
import { analyze } from '../risk.mts'

const raw = JSON.parse(readFileSync(new URL('./device.json', import.meta.url), 'utf8'))
const r = validatePack(raw, { official: true })

// 동봉 팩이 검증을 모두 통과해야 함 (통과 못 한 항목은 앱에서 조용히 빠지므로 여기서 잡음)
test('device.json: 모든 항목이 검증을 통과하고 한·영이 모두 있음', () => {
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  assert.ok(r.pack && r.pack.plugins.length >= 3)
  assert.equal(r.pack!.official, true)
  assert.deepEqual(r.pack!.plugins.map((p) => p.group), ['manage', 'manage', 'manage', 'manage'])
  const all = r.pack!.plugins.flatMap((p) => p.actions)
  for (const a of all) if (a.sudo) assert.ok(a.confirm, a.id)
  // 공식 팩 글자는 {ko, en} 둘 다 (strict 검사를 통과했으므로 원본에서도 확인)
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if ('ko' in o || 'en' in o) assert.ok(typeof o.ko === 'string' && o.ko && typeof o.en === 'string' && o.en, `ko/en 누락: ${path}`)
      else for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`)
    }
  }
  walk(raw, 'device')
})

// 읽기라고 적었지만 앱이 읽기로 증명 못 하는 공식 항목은 목록(OFFICIAL_UNPROVEN_READS)에 고정된 것뿐이어야 함 — 새 공식 항목이 증명 못 하면 이 시험이 깨져 리뷰를 강제함
test('device.json: 읽기로 증명 못 하는 읽기 항목은 신뢰 목록과 정확히 같다', () => {
  const unproven: [string, string][] = []
  for (const p of raw.plugins) for (const a of p.actions) {
    if (a.risk !== 'read' || a.mode === 'stream') continue
    const cmds = (a.params?.[0]?.choices ?? [{ value: '' }]).map((c: { value: string }) => fill(a.cmd, { [a.params?.[0]?.name ?? '']: c.value }))
    if (cmds.some((c: string) => analyze(c).risk !== 'read')) unproven.push([`${'device'}/${a.id}`, a.cmd])
  }
  assert.deepEqual(unproven, [...OFFICIAL_UNPROVEN_READS].filter(([k]) => k.startsWith('device/')))
})

test('device.json: 5.0.0 추가 항목(전원 모드 현재값, 로그 보기)은 읽기이며 증명됨', () => {
  const all = r.pack!.plugins.flatMap((p) => p.actions)
  for (const id of ['pwr-mode', 'log-view']) assert.equal(all.find((a) => a.id === id)?.computed, 'read', id)
  assert.equal(all.find((a) => a.id === 'pwr-mode')!.when, 'jetson')
})

test('device.json: 4.5.0 항목은 그대로 (5.0.0 추가분 제외)', () => {
  const ids = r.pack!.plugins.map((p) => `${p.id}:${p.actions.map((a) => a.id).filter((i) => i !== 'pwr-mode').join(',')}`).filter((s) => s !== 'logs:log-view,log-follow')
  assert.deepEqual(ids, [
    'apt:apt-check,apt-update,apt-upgrade',
    'disk:disk-df,disk-du,apt-clean,apt-autoremove,journal-vacuum',
    'power:pwr-status,pwr-target,pwr-sched-reboot,pwr-sched-off,pwr-cancel,pwr-reboot,pwr-off'
  ])
  const risk = Object.fromEntries(r.pack!.plugins.flatMap((p) => p.actions.map((a) => [a.id, a.risk])).filter(([i]) => i !== 'pwr-mode' && i !== 'log-view' && i !== 'log-follow'))
  assert.deepEqual(risk, {
    'apt-check': 'read', 'apt-update': 'change', 'apt-upgrade': 'danger', 'disk-df': 'read', 'disk-du': 'read', 'apt-clean': 'change', 'apt-autoremove': 'danger', 'journal-vacuum': 'change',
    'pwr-status': 'read', 'pwr-target': 'change', 'pwr-sched-reboot': 'danger', 'pwr-sched-off': 'danger', 'pwr-cancel': 'change', 'pwr-reboot': 'danger', 'pwr-off': 'danger'
  })
  for (const a of r.pack!.plugins.flatMap((p) => p.actions)) assert.equal(a.understated, false, a.id) // 선언과 계산이 어긋난 항목 없음
})

test('device.json: 실시간 로그(log-follow)는 스트림 읽기이며 증명됨', () => {
  const a = r.pack!.plugins.flatMap((p) => p.actions).find((x) => x.id === 'log-follow')!
  assert.equal(a.mode, 'stream')
  assert.equal(a.computed, 'read')
  assert.equal(a.understated, false)
})
