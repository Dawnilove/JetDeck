import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { PackAction } from '../../../main/packschema.mts'
import type { EndReason } from '../../../main/packstreamcore.mts'
import Button from '../components/Button'
import { errText } from '../util'
import AskDialog, { type Ask } from './PackAsk'
import { FieldInputs, formErrors, useFormValues } from './PackForm'
import { lt } from './PackUi'

// 흐르는 출력 로그 카드 (5.1.0). 줄은 main이 정리(제어 문자 제거·비밀 가림)해서 보냄 → 여기서는 글자로만 그림 (HTML 아님).
// 화면을 나가면(이 컴포넌트가 사라지면) 멈춤. 멈춤 = main이 Ctrl-C → 3초 뒤 채널 닫기
type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'ended'; reason: EndReason | 'error'; code?: number; error?: string }

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const fmtClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const fmtRate = (b: number) => (b < 1024 ? `${b}B` : `${(b / 1024).toFixed(b < 10240 ? 1 : 0)}KB`)

const endText = (s: Extract<Status, { kind: 'ended' }>): string => {
  switch (s.reason) {
    case 'stopped': return tr('사용자가 멈췄어요')
    case 'timeout': return tr('시간이 끝나서 멈췄어요')
    case 'closed': return tr('연결이 끊겨서 멈췄어요')
    case 'rate': return tr('출력이 너무 빨라서 멈췄어요')
    case 'total': return tr('출력이 너무 많아서 멈췄어요')
    case 'exit': return tr('명령이 끝났어요 (종료 코드 {0})', s.code ?? 0)
    default: return s.error ?? tr('시작하지 못했어요')
  }
}

type Props = { connId: string; online: boolean; packId: string; pluginId: string; a: PackAction }

export default function StreamCard({ connId, online, packId, pluginId, a }: Props) {
  const maxLines = a.display?.type === 'log' ? a.display.maxLines : 1000
  const wrap = a.display?.type === 'log' ? a.display.wrap : true
  const [values, setValue] = useFormValues(packId, pluginId, a)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [view, setView] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [rate, setRate] = useState(0)
  const [secs, setSecs] = useState(0)
  const [paused, setPaused] = useState(false)
  const [follow, setFollow] = useState(true)
  const [find, setFind] = useState('')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [msg, setMsg] = useState<string>()
  const buf = useRef<string[]>([])
  const idRef = useRef<string | null>(null)
  const pausedRef = useRef(false)
  const bytes = useRef(0)
  const preRef = useRef<HTMLPreElement>(null)
  const errors = formErrors(a.fields, values)
  const running = status.kind === 'running'

  // 이벤트 구독 (내 streamId 것만) + 화면을 나가면 멈춤
  useEffect(() => {
    const offData = window.api.onPackStreamData((id, lines, skipped) => {
      if (id !== idRef.current) return
      const add = skipped > 0 ? [tr('…{0}줄 건너뜀', skipped), ...lines] : lines
      for (const l of add) bytes.current += l.length + 1
      buf.current.push(...add)
      if (buf.current.length > maxLines) buf.current.splice(0, buf.current.length - maxLines)
      setTotal((n) => n + lines.length)
      if (!pausedRef.current) setView(buf.current.slice())
    })
    const offEnd = window.api.onPackStreamEnd((id, reason, code) => {
      if (id !== idRef.current) return
      idRef.current = null
      setStatus({ kind: 'ended', reason, code })
      if (!pausedRef.current) setView(buf.current.slice())
    })
    return () => {
      offData()
      offEnd()
      if (idRef.current) window.api.packStreamStop(idRef.current).catch(() => {})
    }
  }, [])

  // 실행 중에만 1초마다 경과 시간·속도 갱신
  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    setSecs(0)
    const h = setInterval(() => {
      setSecs(Math.floor((Date.now() - t0) / 1000))
      setRate(bytes.current)
      bytes.current = 0
    }, 1000)
    return () => clearInterval(h)
  }, [running])

  // 연결이 끊기면 main이 'closed'로 끝냄. 화면 쪽에서도 오프라인이 되면 새로 시작해야 함
  useEffect(() => {
    if (!online && idRef.current) {
      window.api.packStreamStop(idRef.current).catch(() => {})
    }
  }, [online])

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [view, follow, find])

  const doStart = async (token?: string) => {
    const id = newId()
    idRef.current = id
    buf.current = []
    bytes.current = 0
    setView([])
    setTotal(0)
    setRate(0)
    setMsg(undefined)
    setFollow(true)
    setStatus({ kind: 'running' })
    try {
      await window.api.packStreamStart(connId, packId, pluginId, a.id, values, id, token)
    } catch (e) {
      if (idRef.current === id) idRef.current = null
      setStatus({ kind: 'ended', reason: 'error', error: errText(e) })
    }
  }
  const start = async () => {
    setMsg(undefined)
    try {
      const p = await window.api.packPrepare(packId, pluginId, a.id, values)
      if (!p.needConfirm) return doStart(p.token)
      setAsk({ action: { ...a, risk: p.risk, reasons: p.reasons, understated: p.understated }, values, loading: false, prepared: { cmd: p.cmd, token: p.token } })
    } catch (e) {
      setMsg(errText(e))
    }
  }
  const stop = () => {
    if (idRef.current) window.api.packStreamStop(idRef.current).catch(() => {})
  }
  const clear = () => {
    buf.current = []
    setView([])
    setTotal(0)
  }
  const togglePause = () => {
    const next = !paused
    pausedRef.current = next
    setPaused(next)
    if (!next) setView(buf.current.slice())
  }
  const needle = find.trim().toLowerCase()
  const shown = needle ? view.filter((l) => l.toLowerCase().includes(needle)) : view
  const copy = () => navigator.clipboard.writeText(shown.join('\n')).then(() => setMsg(tr('복사했어요')), () => setMsg(tr('복사하지 못했어요')))
  const onScroll = () => {
    const el = preRef.current
    if (el && follow && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false)
  }

  return (
    <section className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={lt(a.label)}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <h2 style={{ marginRight: 'auto' }}>{lt(a.label)}</h2>
        <FieldInputs connId={connId} online={online} packId={packId} pluginId={pluginId} action={a} values={values} onChange={setValue} disabled={running} />
        {running ? (
          <Button size={36} variant="secondary" onClick={stop}>{tr('멈춤')}</Button>
        ) : (
          <Button size={36} variant={a.risk === 'danger' ? 'warn' : 'secondary'} disabled={Object.keys(errors).length > 0} onClick={start}>{tr('시작')}</Button>
        )}
      </div>
      {a.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(a.desc)}</p>}
      {status.kind === 'idle' && <p className="dim" style={{ fontSize: 12 }}>{tr('화면을 나가면 멈춰요')}</p>}
      {status.kind !== 'idle' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input className="input" style={{ height: 32, width: 180 }} placeholder={tr('찾기')} aria-label={tr('찾기')} value={find} onChange={(e) => setFind(e.target.value)} />
            <Button size={36} variant="ghost" style={{ padding: '0 12px' }} onClick={togglePause} aria-pressed={paused} title={tr('화면 갱신만 멈춰요. Device의 명령은 계속 돌아요')}>{paused ? tr('이어서') : tr('일시정지')}</Button>
            <Button size={36} variant="ghost" style={{ padding: '0 12px' }} onClick={clear}>{tr('지우기')}</Button>
            <Button size={36} variant="ghost" style={{ padding: '0 12px' }} onClick={copy} disabled={!shown.length}>{tr('복사')}</Button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginLeft: 'auto' }}>
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {tr('따라가기')}
            </label>
          </div>
          <pre ref={preRef} data-testid="pk-log" className="hk-code ros-out" style={{ minHeight: 120, whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal', wordBreak: wrap ? 'break-all' : 'normal' }} onScroll={onScroll}>
            {shown.length ? shown.join('\n') : <span className="dim">{running ? tr('출력을 기다리는 중…') : tr('(출력이 없어요)')}</span>}
          </pre>
          <p data-testid="pk-log-status" role="status" className={status.kind === 'ended' && (status.reason === 'error' || status.reason === 'rate' || status.reason === 'total') ? 'msg-err' : 'dim'} style={{ fontSize: 12 }}>
            {running ? `● ${tr('실행 중 · 줄 {0} · {1}/s · {2}', total.toLocaleString(), fmtRate(rate), fmtClock(secs))}` : status.kind === 'ended' ? `■ ${endText(status)} · ${tr('줄 {0}', total.toLocaleString())}` : ''}
            {paused && ` · ${tr('일시정지')}`}
            {msg && ` · ${msg}`}
          </p>
        </>
      )}
      {status.kind === 'idle' && msg && <p className="msg-err" role="status" style={{ fontSize: 12 }}>{msg}</p>}
      {ask && <AskDialog ask={ask} onCancel={() => setAsk(null)} onOk={() => { const t = ask.prepared?.token; setAsk(null); doStart(t) }} />}
    </section>
  )
}
