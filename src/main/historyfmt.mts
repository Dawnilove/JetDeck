// 모니터 기록(2.7.0): 최근 1시간만 PC 앱 메모리에 보관. 값 정리·줄이기·CSV 만들기 (Electron 없이 시험)
import type { Stats } from './tegrastats.mts'

export const HOLD_MS = 60 * 60 * 1000 // 보관 시간 (사용자 결정: 1시간, 메모리에만)
export type Sample = {
  t: number // 시각(ms)
  cpu: number | null // 켜진 코어 평균 %
  cores: (number | null)[]
  gpu: number | null
  ram: number | null // 사용 MB
  ramTotal: number | null
  tCpu: number | null
  tGpu: number | null
  tBoard: number | null
  mw: number | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function toSample(t: number, s: Stats): Sample {
  return {
    t,
    cpu: avg(s.cpu.flatMap((c) => (c.pct == null ? [] : [c.pct]))),
    cores: s.cpu.map((c) => c.pct),
    gpu: s.gpu,
    ram: s.ram?.used ?? null,
    ramTotal: s.ram?.total ?? null,
    tCpu: s.temps.cpu,
    tGpu: s.temps.gpu,
    tBoard: s.temps.board,
    mw: s.powerMw
  }
}

// 시간 순서대로 쌓이므로 앞에서부터 오래된 것을 버림
export function push(buf: Sample[], s: Sample, holdMs = HOLD_MS): void {
  buf.push(s)
  let n = 0
  while (n < buf.length && buf[n].t < s.t - holdMs) n++
  if (n) buf.splice(0, n)
}

// 그래프용: [from, to) 구간을 n칸으로 나눠 칸마다 평균. 샘플이 없는 칸(연결이 끊긴 구간)은 null → 그래프에서 선이 끊김
export type Bucket = Omit<Sample, 't'> & { t: number }
export function bucket(buf: Sample[], from: number, to: number, n: number): (Bucket | null)[] {
  const step = (to - from) / n
  const groups: Sample[][] = Array.from({ length: n }, () => [])
  for (const s of buf) {
    if (s.t < from || s.t >= to) continue
    groups[Math.min(n - 1, Math.floor((s.t - from) / step))].push(s)
  }
  const mean = (g: Sample[], f: (s: Sample) => number | null) => avg(g.flatMap((s) => (f(s) == null ? [] : [f(s) as number])))
  return groups.map((g, i) => {
    if (!g.length) return null
    const cores = Math.max(...g.map((s) => s.cores.length))
    return {
      t: from + step * (i + 0.5),
      cpu: mean(g, (s) => s.cpu),
      cores: Array.from({ length: cores }, (_, k) => mean(g, (s) => s.cores[k] ?? null)),
      gpu: mean(g, (s) => s.gpu),
      ram: mean(g, (s) => s.ram),
      ramTotal: g.at(-1)!.ramTotal,
      tCpu: mean(g, (s) => s.tCpu),
      tGpu: mean(g, (s) => s.tGpu),
      tBoard: mean(g, (s) => s.tBoard),
      mw: mean(g, (s) => s.mw)
    }
  })
}

const two = (n: number) => String(n).padStart(2, '0')
// 이 PC의 시간대 기준 "2026-10-23 14:05:09.500"
export const localTime = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
const cell = (v: number | null, digits = 1) => (v == null ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits))

export function toCsv(buf: Sample[]): string {
  const cores = Math.max(0, ...buf.map((s) => s.cores.length))
  const head = ['time', 'cpu_avg_pct', ...Array.from({ length: cores }, (_, i) => `cpu${i}_pct`), 'gpu_pct', 'ram_used_mb', 'ram_total_mb', 'temp_cpu_c', 'temp_gpu_c', 'temp_board_c', 'power_mw']
  const rows = buf.map((s) => [localTime(s.t), cell(s.cpu), ...Array.from({ length: cores }, (_, i) => cell(s.cores[i] ?? null)), cell(s.gpu, 0), cell(s.ram, 0), cell(s.ramTotal, 0), cell(s.tCpu), cell(s.tGpu), cell(s.tBoard), cell(s.mw, 0)])
  return [head, ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n'
}
