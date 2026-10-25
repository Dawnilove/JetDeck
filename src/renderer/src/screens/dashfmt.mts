import type { Stats } from '../../../main/tegrastats.mts'

// 대시보드 카드에 보일 요약 값 (모두 없으면 null)
export type Summary = { cpu: number | null; ram: number | null; gpu: number | null; temp: number | null; watt: number | null }

const round = (n: number) => Math.round(n)

export function summarize(s: Stats): Summary {
  const on = s.cpu.map((c) => c.pct).filter((p): p is number => p !== null) // 꺼진 코어는 평균에서 뺌
  const temps = [s.temps.cpu, s.temps.gpu, s.temps.board].filter((t): t is number => t !== null)
  return {
    cpu: on.length ? round(on.reduce((a, b) => a + b, 0) / on.length) : null,
    ram: s.ram && s.ram.total > 0 ? round((s.ram.used / s.ram.total) * 100) : null,
    gpu: s.gpu === null ? null : round(s.gpu),
    temp: temps.length ? round(Math.max(...temps)) : null,
    watt: s.powerMw === null ? null : Math.round(s.powerMw / 100) / 10
  }
}
