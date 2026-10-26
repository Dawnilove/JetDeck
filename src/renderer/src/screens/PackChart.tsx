import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { PackAction } from '../../../main/packschema.mts'
import type { PollEndReason, Sample } from '../../../main/packpollcore.mts'
import Button from '../components/Button'
import LineChart from '../components/LineChart'
import { errText } from '../util'
import { lt } from './PackUi'

// 시계열 그래프 카드 (5.2.0). 점은 main이 읽어서 보내고(명령은 화면이 만들지 않음) 여기서는 이 앱의 메모리에만 쌓음.
// 화면을 나가면(이 컴포넌트가 사라지면) 멈춤. 색은 앱 팔레트가 정함 (팩은 못 정함)
type Pt = { t: number; v: Record<string, number> }
type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'ended'; reason: PollEndReason | 'error'; detail?: string }

const PALETTE = ['var(--accent)', 'var(--info)', 'var(--warn)', 'var(--status-off)', 'color-mix(in srgb, var(--accent) 50%, var(--info))', 'color-mix(in srgb, var(--warn) 50%, var(--status-off))', 'color-mix(in srgb, var(--info) 50%, var(--status-off))', 'color-mix(in srgb, var(--accent) 50%, var(--warn))']
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB')

const endText = (s: Extract<Status, { kind: 'ended' }>): string => {
  switch (s.reason) {
    case 'stopped': return tr('사용자가 멈췄어요')
    case 'closed': return tr('연결이 끊겨서 멈췄어요')
    case 'failures': return tr('연속으로 실패해서 멈췄어요')
    default: return s.detail ?? tr('시작하지 못했어요')
  }
}

type Props = { connId: string; packId: string; pluginId: string; a: PackAction }

export default function ChartCard({ connId, packId, pluginId, a }: Props) {
  const d = a.display?.type === 'chart' ? a.display : null
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [view, setView] = useState<Pt[]>([])
  const [paused, setPaused] = useState(false)
  const [every, setEvery] = useState(d?.every ?? 2)
  const [hint, setHint] = useState<string>()
  const [noNum, setNoNum] = useState(false)
  const [lastT, setLastT] = useState<number>()
  const buf = useRef<Pt[]>([])
  const names = useRef(new Map<string, string>()) // key → 선 이름 (이어 주는 건 key, 이름은 표시만)
  const idRef = useRef<string | null>(null)
  const pausedRef = useRef(false)
  const points = d?.points ?? 300
  const running = status.kind === 'running'

  useEffect(() => {
    const offData = window.api.onPackPollData((id, t, samples: Sample[], ev, h) => {
      if (id !== idRef.current) return
      setEvery(ev)
      setLastT(t)
      setNoNum(samples.length === 0)
      setHint(samples.length === 0 ? h : undefined)
      if (samples.length) {
        const v: Record<string, number> = {}
        for (const s of samples) {
          v[s.key] = s.value
          names.current.set(s.key, lt(s.label))
        }
        buf.current.push({ t, v })
        if (buf.current.length > points) buf.current.splice(0, buf.current.length - points)
        if (!pausedRef.current) setView(buf.current.slice())
      }
    })
    const offEnd = window.api.onPackPollEnd((id, reason, detail) => {
      if (id !== idRef.current) return
      idRef.current = null
      setStatus({ kind: 'ended', reason, detail })
    })
    return () => {
      offData()
      offEnd()
      const id = idRef.current
      idRef.current = null // 시작 요청이 아직 가는 중이면 doStart가 보고 바로 멈춤
      if (id) window.api.packPollStop(id).catch(() => {})
    }
  }, [])

  const start = async () => {
    const id = newId()
    idRef.current = id
    buf.current = []
    names.current.clear()
    setView([])
    setHint(undefined)
    setNoNum(false)
    setLastT(undefined)
    setEvery(d?.every ?? 2)
    setStatus({ kind: 'running' })
    try {
      await window.api.packPollStart(connId, packId, pluginId, a.id, id)
      if (idRef.current !== id) window.api.packPollStop(id).catch(() => {}) // 기다리는 사이 화면을 나갔음
    } catch (e) {
      if (idRef.current === id) {
        idRef.current = null
        setStatus({ kind: 'ended', reason: 'error', detail: errText(e) })
      }
    }
  }
  const stop = () => {
    if (idRef.current) window.api.packPollStop(idRef.current).catch(() => {})
  }
  useEffect(() => {
    if (a.auto && a.risk === 'read') start()
  }, [])

  if (!d) return null
  const keys = [...new Set(view.flatMap((p) => Object.keys(p.v)))].slice(0, PALETTE.length)
  const series = keys.map((k, i) => ({ id: k, label: names.current.get(k) ?? k, color: PALETTE[i], values: view.map((p) => p.v[k] ?? null) }))
  const int = series.every((s) => s.values.every((v) => v == null || Number.isInteger(v)))
  const btn = { size: 36 as const, variant: 'ghost' as const, style: { padding: '0 12px' } }
  const state = status.kind === 'idle' ? tr('대기 중') : running ? tr('실행 중') : endText(status)
  return (
    <LineChart
      title={lt(a.label)}
      unit={d.unit ?? ''}
      min={d.min}
      max={d.max}
      digits={int ? 0 : 2}
      series={series}
      xs={view.map((p) => p.t)}
      actions={
        <>
          <span className="tag">{tr('{0}초마다', d.every)}</span>
          {running ? <Button size={36} variant="secondary" onClick={stop}>{tr('멈춤')}</Button> : <Button size={36} variant="secondary" onClick={start}>{tr('시작')}</Button>}
          <Button {...btn} onClick={() => { pausedRef.current = !paused; setPaused(!paused); if (paused) setView(buf.current.slice()) }} aria-pressed={paused} title={tr('화면 갱신만 멈춰요. Device의 명령은 계속 돌아요')}>{paused ? tr('이어서') : tr('일시정지')}</Button>
          <Button {...btn} onClick={() => { buf.current = []; setView([]) }}>{tr('지우기')}</Button>
        </>
      }
    >
      {a.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(a.desc)}</p>}
      <p data-testid="pk-chart-status" role="status" className={status.kind === 'ended' && (status.reason === 'error' || status.reason === 'failures') ? 'msg-err' : 'dim'} style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
        {running ? '● ' : status.kind === 'ended' ? '■ ' : ''}
        {state}
        {status.kind !== 'idle' && ` · ${tr('점 {0}개', buf.current.length)}`}
        {lastT != null && ` · ${tr('마지막 읽음 {0}', clock(lastT))}`}
        {paused && ` · ${tr('일시정지')}`}
        {running && every > d.every && ` · ${tr('간격을 {0}초로 늘렸어요', every)}`}
        {running && noNum && ` · ${tr('읽을 수 있는 숫자가 없어요')}${hint ? `: ${hint}` : ''}`}
        {status.kind === 'ended' && status.reason === 'failures' && status.detail && `: ${status.detail}`}
      </p>
    </LineChart>
  )
}
