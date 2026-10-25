import { useEffect, useState } from 'react'
import type { ActLite } from '../../../main/activity'
import type { Bucket } from '../../../main/historyfmt.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 모니터 기록: 최근 1시간을 이 앱의 메모리에만 보관 (파일에 쓰지 않음, 앱을 닫으면 사라짐). 선 그래프 + CSV 내보내기
type Series = { label: string; color: string; values: (number | null)[]; opacity?: number }
type Band = { from: number; to: number } // AI가 명령을 돌린 구간(ms)
const W = 600
const H = 140
const MINUTES = [5, 15, 30, 60]
const N = 300

// 값이 없는 칸(연결이 끊긴 구간)에서는 선을 끊음. 점 하나만 있는 구간은 작은 점으로
function path(values: (number | null)[], min: number, max: number): string {
  const x = (i: number) => ((i / (values.length - 1)) * W).toFixed(1)
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

function Chart({ title, unit, series, min = 0, max, digits = 0, note, bands, from, to }: { title: string; unit: string; series: Series[]; min?: number; max: number; digits?: number; note?: string; bands: Band[]; from: number; to: number }) {
  return (
    <section className="card card-sm hist-card" aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <h2>{title}</h2>
        <span className="dim mono" style={{ fontSize: 12 }}>{tr('{0}{1} 까지', max, unit)}</span>
      </div>
      <svg className="hist-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={tr('{0} 그래프', title)}>
        {/* AI가 명령을 돌린 구간 음영 (너무 짧아도 보이게 최소 폭) */}
        {bands.map((b, i) => {
          const x0 = Math.max(0, ((b.from - from) / (to - from)) * W)
          const x1 = Math.min(W, ((b.to - from) / (to - from)) * W)
          return x1 > x0 || b.to >= from ? <rect key={i} className="hist-band" x={x0} y={0} width={Math.max(2, x1 - x0)} height={H} /> : null
        })}
        {[0.25, 0.5, 0.75].map((r) => <line key={r} className="hist-grid-line" x1="0" x2={W} y1={H * r} y2={H * r} />)}
        {series.map((s) => <path key={s.label} className="hist-line" d={path(s.values, min, max)} stroke={s.color} opacity={s.opacity ?? 1} />)}
      </svg>
      <div className="hist-legend">
        {series.filter((s) => !s.opacity).map((s) => {
          const v = last(s.values)
          return (
            <span key={s.label}>
              <i className="hist-key" style={{ background: s.color }} />
              {s.label} <b className="mono">{v == null ? '—' : `${v.toFixed(digits)}${unit}`}</b>
            </span>
          )
        })}
        {note && <span className="dim">{note}</span>}
        {bands.length > 0 && <span className="dim"><i className="hist-key hist-key-band" />{tr('AI 명령 실행 구간')}</span>}
      </div>
    </section>
  )
}

export default function MonitorHistory({ connId }: { connId: string }) {
  const [minutes, setMinutes] = useState(15)
  const [range, setRange] = useState<{ from: number; to: number; points: (Bucket | null)[] } | null>(null)
  const [cores, setCores] = useState(false)
  const [acts, setActs] = useState<ActLite[]>([])
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // 열려 있는 동안 2초마다 새로 받음 (줄인 값이라 가벼움)
  useEffect(() => {
    let alive = true
    const load = () => {
      window.api.historyGet(connId, minutes, N).then((r) => alive && setRange(r), () => {})
      window.api.activityList().then((l) => alive && setActs(l), () => {})
    }
    load()
    const t = setInterval(load, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [connId, minutes])

  const pts = range?.points ?? []
  // 이 연결에서 AI가 돌린 명령(run_command)의 시작~끝. 아직 실행 중이면 지금까지
  const bands: Band[] = range ? acts.filter((a) => a.connId === connId && (a.tool === 'run_command' || a.tool === 'external')).map((a) => ({ from: a.t, to: a.ms == null ? range.to : a.t + a.ms })).filter((b) => b.to >= range.from && b.from <= range.to) : []
  const bp = { bands, from: range?.from ?? 0, to: range?.to ?? 1 }
  const col = (f: (b: Bucket) => number | null) => pts.map((b) => (b ? f(b) : null))
  const has = (v: (number | null)[]) => v.some((x) => x != null)
  const cpu = col((b) => b.cpu)
  const gpu = col((b) => b.gpu)
  const ramTotal = last(col((b) => b.ramTotal)) ?? 0
  const ram = col((b) => (b.ram == null ? null : b.ram / 1024))
  const temps = [
    { label: 'CPU', color: 'var(--accent)', values: col((b) => b.tCpu) },
    { label: 'GPU', color: 'var(--info)', values: col((b) => b.tGpu) },
    { label: tr('보드'), color: 'var(--warn)', values: col((b) => b.tBoard) }
  ].filter((s) => has(s.values))
  const power = col((b) => (b.mw == null ? null : b.mw / 1000))
  const nCores = Math.max(0, ...pts.map((b) => b?.cores.length ?? 0))
  const maxOf = (vs: (number | null)[][], floor: number, step: number) => Math.max(floor, Math.ceil(Math.max(0, ...vs.flat().map((v) => v ?? 0)) / step + 0.001) * step)
  const empty = range && !has(cpu) && !has(ram) && !has(gpu)

  const doExport = async () => {
    try {
      const p = await window.api.historyExport(connId)
      if (p) setMsg({ text: tr('저장했어요: {0}', p), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    }
  }

  return (
    <div className="hist">
      <PanelHead hist title={tr('모니터 기록')} desc={<Desc>{tr('최근 1시간까지 이 앱의 메모리에만 보관해요. 앱을 닫거나 연결을 닫으면 사라지고, 필요하면 CSV로 내보내세요.')}</Desc>}>
          <Segment label={tr('보기 구간')} value={String(minutes)} onChange={(v) => setMinutes(Number(v))} options={MINUTES.map((m) => ({ value: String(m), label: m === 60 ? tr('1시간') : tr('{0}분', m) }))} />
          <Button size={36} onClick={doExport}>{tr('CSV 내보내기')}</Button>
      </PanelHead>
      {msg && <p role="status" className={msg.ok ? 'msg-ok' : 'msg-err'} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{msg.text}</p>}
      {!range && <Note>{tr('불러오는 중…')}</Note>}
      {empty && <Note>{tr('아직 기록된 값이 없어요. 연결된 기기에서 값을 받기 시작하면 그려져요.')}</Note>}
      {!empty && (
        <div className="hist-grid">
          <Chart
            {...bp}
            title={tr('CPU 사용률')}
            unit="%"
            max={100}
            series={[
              { label: tr('평균'), color: 'var(--accent)', values: cpu },
              ...(cores ? Array.from({ length: nCores }, (_, k) => ({ label: tr('코어{0}', k), color: 'var(--accent)', opacity: 0.35, values: col((b) => b.cores[k] ?? null) })) : [])
            ]}
            note={nCores ? tr('{0}코어', nCores) : undefined}
          />
          {has(gpu) && <Chart {...bp} title={tr('GPU 사용률')} unit="%" max={100} series={[{ label: 'GPU', color: 'var(--info)', values: gpu }]} />}
          {has(ram) && <Chart {...bp} title={tr('메모리 사용량')} unit=" GB" max={Math.max(1, Math.round((ramTotal / 1024) * 10) / 10)} digits={1} series={[{ label: tr('사용'), color: 'var(--accent)', values: ram }]} note={ramTotal ? tr('전체 {0} GB', (ramTotal / 1024).toFixed(1)) : undefined} />}
          {temps.length > 0 && <Chart {...bp} title={tr('온도')} unit="°C" max={maxOf(temps.map((s) => s.values), 60, 10)} digits={1} series={temps} />}
          {has(power) && <Chart {...bp} title={tr('소비 전력 (보드 전체)')} unit=" W" max={maxOf([power], 10, 5)} digits={1} series={[{ label: tr('전력'), color: 'var(--warn)', values: power }]} />}
        </div>
      )}
      {!empty && nCores > 1 && (
        <label className="check" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={cores} onChange={(e) => setCores(e.target.checked)} />{tr('CPU 코어별 선도 같이 보기')}
        </label>
      )}
      <div className="hist-axis dim" aria-hidden>
        <span>{tr('{0} 전', minutes === 60 ? tr('1시간') : tr('{0}분', minutes))}</span>
        <span>{tr('지금')}</span>
      </div>
    </div>
  )
}
