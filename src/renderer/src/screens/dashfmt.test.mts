import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize } from './dashfmt.mts'

test('요약: 꺼진 코어 제외 평균, 메모리 %, 가장 높은 온도, 전력 W', () => {
  const r = summarize({
    ram: { used: 3700, total: 7400 },
    cpu: [{ pct: 10, mhz: 1 }, { pct: 30, mhz: 1 }, { pct: null, mhz: null }],
    gpu: 12.4,
    temps: { cpu: 46, gpu: 51.4, board: null, boardName: null },
    powerMw: 4949
  })
  assert.deepEqual(r, { cpu: 20, ram: 50, gpu: 12, temp: 51, watt: 4.9 })
})

test('요약: 값이 없으면 null', () => {
  const r = summarize({ ram: null, cpu: [], gpu: null, temps: { cpu: null, gpu: null, board: null, boardName: null }, powerMw: null })
  assert.deepEqual(r, { cpu: null, ram: null, gpu: null, temp: null, watt: null })
})
