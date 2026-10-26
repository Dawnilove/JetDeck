import { useEffect, useState } from 'react'
import type { ActLite } from '../../../main/activity'
import type { Bucket } from '../../../main/historyfmt.mts'
import Button from '../components/Button'
import Chart, { type Band } from '../components/LineChart'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 모니터 기록: 최근 1시간을 이 앱의 메모리에만 보관 (파일에 쓰지 않음, 앱을 닫으면 사라짐). 선 그래프 + CSV 내보내기
const MINUTES = [5, 15, 30, 60]
const N = 300
const last = (xs: (number | null)[]) => [...xs].reverse().find((v) => v != null) ?? null

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
