import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Stats } from './tegrastats.mts'
import { bucket, HOLD_MS, push, toCsv, toSample, type Sample } from './historyfmt.mts'

const stats = (cpu: (number | null)[], gpu: number | null, mw: number | null): Stats => ({
  ram: { used: 3000, total: 7000 },
  cpu: cpu.map((pct) => ({ pct, mhz: 1000 })),
  gpu,
  temps: { cpu: 45.55, gpu: null, board: 47, boardName: 'tj' },
  powerMw: mw
})

test('toSample: 꺼진 코어(null)는 평균에서 뺌', () => {
  const s = toSample(1000, stats([10, 30, null], 5, 4000))
  assert.equal(s.cpu, 20)
  assert.deepEqual(s.cores, [10, 30, null])
  assert.equal(s.ram, 3000)
  assert.equal(toSample(0, stats([null], null, null)).cpu, null)
})

test('push: 1시간보다 오래된 것은 앞에서부터 버림', () => {
  const buf: Sample[] = []
  for (const t of [0, 1000, HOLD_MS, HOLD_MS + 1500]) push(buf, toSample(t, stats([1], 1, 1)))
  assert.deepEqual(buf.map((s) => s.t), [HOLD_MS, HOLD_MS + 1500]) // 마지막 시각 기준 1시간 안쪽만 (1000은 1500보다 오래됨)
})

test('bucket: 칸별 평균, 비어 있는(끊긴) 칸은 null, 범위 밖은 제외', () => {
  const buf = [10, 20, 90].map((cpu, i) => toSample(i === 2 ? 3500 : i * 500, stats([cpu], null, null))) // t=0,500,3500
  const r = bucket(buf, 0, 4000, 4) // 칸 폭 1000
  assert.equal(r.length, 4)
  assert.equal(r[0]?.cpu, 15)
  assert.equal(r[1], null)
  assert.equal(r[2], null)
  assert.equal(r[3]?.cpu, 90)
  assert.equal(bucket(buf, 1000, 3000, 2).every((b) => b === null), true)
})

test('toCsv: 머리글+행, 코어 수만큼 열, 값 없으면 빈 칸', () => {
  const buf = [toSample(1000, stats([10, 20], null, 4000)), toSample(1500, stats([30], 7, null))]
  const lines = toCsv(buf).trimEnd().split('\r\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], 'time,cpu_avg_pct,cpu0_pct,cpu1_pct,gpu_pct,ram_used_mb,ram_total_mb,temp_cpu_c,temp_gpu_c,temp_board_c,power_mw')
  const row1 = lines[1].split(',')
  const row2 = lines[2].split(',')
  assert.equal(row1.length, 11)
  assert.deepEqual(row1.slice(1), ['15', '10', '20', '', '3000', '7000', '45.6', '', '47', '4000'])
  assert.deepEqual(row2.slice(1), ['30', '30', '', '7', '3000', '7000', '45.6', '', '47', ''])
})
