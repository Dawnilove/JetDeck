import type { ReactNode } from 'react'
import { tr } from '../../../main/i18n.mts'

// 선 그래프 카드: 모니터 기록과 플러그인 그래프가 같이 씀
export type Series = { id?: string; label: string; color: string; values: (number | null)[]; opacity?: number }
export type Band = { from: number; to: number } // AI가 명령을 돌린 구간(ms)
const W = 600
const H = 140

// 값이 없는 칸(연결이 끊긴 구간)에서는 선을 끊음. 점 하나만 있는 구간은 작은 점으로. xs(점 시각)가 있으면 시각에 비례해 놓음
function path(values: (number | null)[], min: number, max: number, xs?: number[]): string {
  const x = (i: number) => {
    if (xs && xs.length === values.length && xs[xs.length - 1] > xs[0]) return (((xs[i] - xs[0]) / (xs[xs.length - 1] - xs[0])) * W).toFixed(1)
    return ((i / (values.length - 1)) * W).toFixed(1)
  }
  const y = (v: number) => (H - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * H).toFixed(1)
  let d = ''
  values.forEach((v, i) => {
    if (v == null) return
    const first = i === 0 || values[i - 1] == null
    const alone = (i === values.length - 1 || values[i + 1] == null) && first
    d += `${first ? 'M' : 'L'}${x(i)} ${y(v)}${alone ? ` l0.01 0` : ''} `
  })
  return d
}
const last = (xs: (number | null)[]) => [...xs].reverse().find((v) => v != null) ?? null

// 세로 범위 자동: 값의 최댓값을 1·2·5 단위로 올림, 음수가 있으면 최솟값도 내림
function autoRange(series: Series[]): { min: number; max: number } {
  const vs = series.flatMap((s) => s.values).filter((v): v is number => v != null)
  const hi = Math.max(0, ...vs)
  const lo = Math.min(0, ...vs)
  const nice = (v: number) => {
    if (v <= 0) return 0
    const p = 10 ** Math.floor(Math.log10(v))
    const m = v / p
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
  }
  const max = nice(hi)
  const min = lo < 0 ? -nice(-lo) : 0
  return max > min ? { min, max } : { min, max: min + 1 }
}

type Props = { title: string; unit: string; series: Series[]; min?: number; max?: number; digits?: number; note?: string; bands?: Band[]; from?: number; to?: number; xs?: number[]; actions?: ReactNode; children?: ReactNode }

export default function LineChart({ title, unit, series, min, max, digits = 0, note, bands = [], from = 0, to = 1, xs, actions, children }: Props) {
  const auto = max == null ? autoRange(series) : null
  const lo = auto ? min ?? auto.min : min ?? 0
  const hi = auto ? auto.max : max!
  return (
    <section className="card card-sm hist-card" aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2>{title}</h2>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dim mono" style={{ fontSize: 12 }}>{lo ? `${lo}${unit} ~ ` : ''}{tr('{0}{1} 까지', hi, unit)}</span>
          {actions}
        </span>
      </div>
      <svg className="hist-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={tr('{0} 그래프', title)}>
        {/* AI가 명령을 돌린 구간 음영 (너무 짧아도 보이게 최소 폭) */}
        {bands.map((b, i) => {
          const x0 = Math.max(0, ((b.from - from) / (to - from)) * W)
          const x1 = Math.min(W, ((b.to - from) / (to - from)) * W)
          return x1 > x0 || b.to >= from ? <rect key={i} className="hist-band" x={x0} y={0} width={Math.max(2, x1 - x0)} height={H} /> : null
        })}
        {[0.25, 0.5, 0.75].map((r) => <line key={r} className="hist-grid-line" x1="0" x2={W} y1={H * r} y2={H * r} />)}
        {series.map((s) => <path key={s.id ?? s.label} className="hist-line" d={path(s.values, lo, hi, xs)} stroke={s.color} opacity={s.opacity ?? 1} />)}
      </svg>
      <div className="hist-legend">
        {series.filter((s) => !s.opacity).map((s) => {
          const v = last(s.values)
          return (
            <span key={s.id ?? s.label}>
              <i className="hist-key" style={{ background: s.color }} />
              {s.label} <b className="mono">{v == null ? '—' : `${v.toFixed(digits)}${unit}`}</b>
            </span>
          )
        })}
        {note && <span className="dim">{note}</span>}
        {bands.length > 0 && <span className="dim"><i className="hist-key hist-key-band" />{tr('AI 명령 실행 구간')}</span>}
      </div>
      {children}
    </section>
  )
}
