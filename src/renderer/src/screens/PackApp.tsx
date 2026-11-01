import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { AppPrepared, AppResult } from '../../../main/packappcore.mts'
import type { PackAction } from '../../../main/packschema.mts'
import Button from '../components/Button'
import { errText } from '../util'
import { fmtSize } from './uifmt.mts'
import { FieldInputs, formErrors, useFormValues } from './PackForm'
import { lt, Reasons, RiskTag } from './PackUi'

// 앱 기능 권한 항목(mode:'app', 6.0.0)의 카드. Device 경로·PC 경로는 화면이 정하지 못한다: main이 팩 템플릿 + 검사된 입력값으로 만들고,
// PC 파일은 OS 대화상자에서만 얻는다. 화면은 (항목, 입력값, 확인 token)만 보낸다
type Tunnel = { id: string; port: number; endsAt: number } // port는 run 결과 값만 (이벤트로 받은 값은 쓰지 않음)
type Cell = { busy?: boolean; result?: AppResult; error?: string; progress?: { done: number; total: number }; ended?: string }

const END_TEXT: Record<string, string> = {
  stop: tr('정지했어요'),
  timeout: tr('시간이 끝나서 닫았어요'),
  error: tr('오류로 닫혔어요'),
  conn: tr('연결이 끊겨서 닫았어요'),
  pack: tr('팩이 꺼지거나 바뀌어서 닫았어요'),
  quit: tr('앱을 끝내서 닫았어요'),
  closed: tr('포트가 닫혔어요. 장치를 뽑았는지 확인하세요'),
  rate: tr('데이터가 너무 빨리 들어와서 닫았어요'),
  total: tr('짧은 시간에 데이터가 너무 많이 들어와서 닫았어요'),
  bytes: tr('받은 양 한도에 닿아서 닫았어요')
}
const MAX_LINES = 2000 // 글자 구역에 남기는 최근 줄 수
type Serial = { id: string; port?: string; baud?: number; endsAt?: number }

const opKey = (pre = 'op') => `${pre}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

export default function AppCard({ connId, online, packId, pluginId, a, trigger }: { connId: string; online: boolean; packId: string; pluginId: string; a: PackAction; trigger?: number }) {
  const [values, setValue] = useFormValues(packId, pluginId, a)
  const [cell, setCell] = useState<Cell>({})
  const [ask, setAsk] = useState<AppPrepared | null>(null)
  const [tunnel, setTunnel] = useState<Tunnel | null>(null)
  const [serial, setSerial] = useState<Serial | null>(null)
  const [text, setText] = useState<{ lines: string[]; skipped: number; bytes: number; idle: boolean }>({ lines: [], skipped: 0, bytes: 0, idle: false })
  const [now, setNow] = useState(Date.now())
  const op = useRef<string | null>(null) // 전송 중인 opId (취소용)
  const tun = useRef<string | null>(null) // 열린 터널 id (화면을 나가면 닫음)
  const ser = useRef<string | null>(null) // 읽는 시리얼 id (화면을 나가면 닫음)
  const bad = Object.keys(formErrors(a.fields, values)).length > 0

  useEffect(
    () =>
      window.api.onPackAppEvent((e) => {
        if (e.type === 'progress' && e.opId === op.current) setCell((c) => ({ ...c, progress: { done: e.done, total: e.total } }))
        else if (e.type === 'tunnel' && e.state === 'closed' && e.id === tun.current) {
          tun.current = null
          setTunnel(null)
          setCell((c) => ({ ...c, ended: END_TEXT[e.reason ?? 'stop'] ?? END_TEXT.stop }))
        } else if (e.type === 'serial' && e.id === ser.current) {
          if (e.state === 'open') (setNow(Date.now()), setSerial({ id: e.id, port: e.port, baud: e.baud, endsAt: e.endsAt }))
          else {
            ser.current = null
            setSerial(null)
            setCell((c) => ({ ...c, ended: `${END_TEXT[e.reason === 'stopped' || !e.reason ? 'stop' : e.reason] ?? END_TEXT.stop} (${fmtSize(e.bytes ?? 0)})` }))
          }
        } else if (e.type === 'serial-data' && e.id === ser.current) {
          // 글자는 React 텍스트로만 보임. 한 묶음이 빈 줄 수만 개일 수 있어 먼저 자르고, 전체도 최근 MAX_LINES줄만 남김
          const add = e.lines.slice(-MAX_LINES)
          const n = e.lines.reduce((t, l) => t + l.length + 1, 0)
          setText((t) => ({ ...t, lines: [...t.lines, ...add].slice(-MAX_LINES), skipped: t.skipped + e.skipped, bytes: t.bytes + n }))
        } else if (e.type === 'serial-idle' && e.id === ser.current) setText((t) => ({ ...t, idle: true }))
      }),
    []
  )
  useEffect(() => () => void (tun.current && window.api.packAppStop(tun.current)), []) // 화면을 나가면 터널을 닫음
  useEffect(() => () => void (ser.current && window.api.packAppStop(ser.current)), []) // 시리얼도 닫음
  useEffect(() => {
    if (!tunnel && !serial) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [tunnel, serial])
  useEffect(() => {
    if (trigger && online && !bad) void begin() // 명령 팔레트에서 고름
  }, [trigger])

  const run = async (token?: string) => {
    const opId = a.op === 'get' || a.op === 'put' ? opKey() : a.op === 'read' ? opKey('sr') : undefined
    op.current = opId ?? null
    if (a.op === 'read') {
      ser.current = opId! // 열리는 동안 오는 이벤트도 받고, 화면을 나가면 정지
      setText({ lines: [], skipped: 0, bytes: 0, idle: false })
    }
    setCell({ busy: true })
    try {
      const r = await window.api.packAppRun(connId, packId, pluginId, a.id, values, token, opId)
      if (r.op === 'open') {
        tun.current = r.id
        setTunnel({ id: r.id, port: r.port, endsAt: r.endsAt })
        setNow(Date.now())
      }
      setCell((c) => ({ ended: c.ended, result: r })) // 열리자마자 닫힌 경우의 끝난 이유를 지우지 않음
    } catch (e) {
      if (a.op === 'read') ser.current = null
      setCell({ error: errText(e) })
    } finally {
      op.current = null
    }
  }
  const begin = async () => {
    if (a.op !== 'put' && a.op !== 'open' && a.op !== 'read') return run() // 목록·읽기·받기는 확인 창 없음 (받기는 OS 저장 대화상자가 확인)
    setCell({ busy: true })
    try {
      const p = await window.api.packAppPrepare(connId, packId, pluginId, a.id, values) // put: 여기서 PC 파일 고르기 대화상자가 뜸
      if (!p) return setCell({})
      if (p.needConfirm) {
        setCell({})
        setAsk(p)
      } else await run(p.token)
    } catch (e) {
      setCell({ error: errText(e) })
    }
  }
  const confirm = () => {
    const p = ask
    setAsk(null)
    if (p) void run(p.token)
  }
  const label = a.op === 'open' ? tr('터널 열기…') : a.op === 'put' ? tr('올리기…') : a.op === 'get' ? tr('받기…') : a.op === 'read' ? tr('읽기…') : tr('보기')
  const sLeft = serial?.endsAt ? Math.max(0, Math.round((serial.endsAt - now) / 1000)) : 0
  const left = tunnel ? Math.max(0, Math.round((tunnel.endsAt - now) / 1000)) : 0

  return (
    <section className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={lt(a.label)} data-testid="pk-app-card">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <h2 style={{ marginRight: 'auto' }}>{lt(a.label)}</h2>
        <FieldInputs connId={connId} online={online} packId={packId} pluginId={pluginId} action={a} values={values} onChange={setValue} disabled={cell.busy} />
        {cell.busy && op.current ? (
          <Button size={36} onClick={() => op.current && window.api.packAppStop(op.current)}>{tr('취소')}</Button>
        ) : (
          <Button size={36} variant="secondary" disabled={cell.busy || bad || !online || !!tunnel || !!serial} onClick={begin}>{cell.busy ? tr('실행 중…') : label}</Button>
        )}
      </div>
      {a.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(a.desc)}</p>}
      {cell.busy && cell.progress && cell.progress.total > 0 && (
        <p className="dim" role="status" style={{ fontSize: 12 }} data-testid="pk-app-progress">{fmtSize(cell.progress.done)} / {fmtSize(cell.progress.total)}</p>
      )}
      {tunnel && (
        <div className="card-sm" role="status" data-testid="pk-app-tunnel" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <code className="mono" style={{ marginRight: 'auto' }}>127.0.0.1:{tunnel.port}</code>
          <span className="dim" style={{ fontSize: 12 }}>{tr('남은 시간 {0}:{1}', String(Math.floor(left / 60)), String(left % 60).padStart(2, '0'))}</span>
          <Button size={36} variant="warn" onClick={() => window.api.packAppStop(tunnel.id)}>{tr('정지')}</Button>
        </div>
      )}
      {serial && (
        <div className="card-sm" role="status" data-testid="pk-app-serial" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <code className="mono" style={{ marginRight: 'auto', overflowWrap: 'anywhere' }}>{serial.port} · {serial.baud}</code>
          <span className="dim" style={{ fontSize: 12 }}>{tr('남은 시간 {0}:{1}', String(Math.floor(sLeft / 60)), String(sLeft % 60).padStart(2, '0'))} · {tr('받은 양 {0}', fmtSize(text.bytes))}</span>
          <Button size={36} variant="warn" onClick={() => window.api.packAppStop(serial.id)}>{tr('정지')}</Button>
        </div>
      )}
      {(serial || text.lines.length > 0) && <pre className="hk-code ros-out" data-testid="pk-app-serial-out" style={{ minHeight: 0, maxHeight: '40vh', overflow: 'auto' }}>{text.lines.join('\n')}</pre>}
      {text.skipped > 0 && <p className="dim" style={{ fontSize: 12 }}>{tr('{0}줄은 너무 많아서 건너뛰었어요', text.skipped)}</p>}
      {serial && text.idle && text.bytes === 0 && <p className="dim" role="status" style={{ fontSize: 12 }} data-testid="pk-app-serial-idle">{tr('데이터가 없어요. 보율이 맞는지 확인하세요. 일부 장치는 내장 시리얼 콘솔에서만 데이터를 보내요.')}</p>}
      {cell.ended && <p className="dim" role="status" style={{ fontSize: 12 }}>{cell.ended}</p>}
      {cell.error && <p className="msg-err" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{cell.error}</p>}
      <AppResultView r={cell.result} />
      {ask && <AppAsk a={a} p={ask} onCancel={() => setAsk(null)} onOk={confirm} />}
    </section>
  )
}

function AppResultView({ r }: { r?: AppResult }) {
  if (!r) return null
  if (r.op === 'list')
    return r.entries.length ? (
      <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
        <table className="pk-table">
          <thead>
            <tr><th>{tr('이름')}</th><th>{tr('크기')}</th></tr>
          </thead>
          <tbody>
            {r.entries.map((e, i) => (
              <tr key={i}><td className="mono">{e.kind === 'dir' ? `${e.name}/` : e.name}</td><td className="mono">{e.kind === 'file' ? fmtSize(e.size) : ''}</td></tr>
            ))}
          </tbody>
        </table>
        {r.truncated && <p className="dim" style={{ fontSize: 12 }}>{tr('일부만 보여요.')}</p>}
      </div>
    ) : (
      <p className="dim" role="status" style={{ fontSize: 13 }}>{tr('결과가 없어요.')}</p>
    )
  if (r.op === 'text') return <pre className="hk-code ros-out" style={{ minHeight: 0 }}>{r.text}</pre>
  if (r.op === 'get') return <p className="dim" role="status" style={{ fontSize: 12 }}>{r.saved ? tr('{0} 저장 완료 ({1})', r.saved, fmtSize(r.size)) : tr('저장을 취소했어요.')}</p>
  if (r.op === 'put') return <p className="dim" role="status" style={{ fontSize: 12 }}>{tr('{0} 올림 ({1})', r.name, fmtSize(r.size))}</p>
  return null // open: 상태 줄이 보임
}

// 실행 전 확인 창 (put·open). 문장은 앱이 만든다. 팩이 쓴 글자는 없음
function AppAsk({ a, p, onCancel, onOk }: { a: PackAction; p: AppPrepared; onCancel: () => void; onOk: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="hk" aria-labelledby="pk-app-title" onCancel={(e) => { e.preventDefault(); onCancel() }} data-testid="pk-app-ask">
      <h1 id="pk-app-title" style={{ fontSize: 20, fontWeight: 600 }}>{lt(a.label)}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{tr('앱이 확인한 내용')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><RiskTag risk={p.risk} /></div>
        <Reasons a={{ reasons: p.reasons, understated: false, declared: p.risk }} />
      </div>
      {p.op === 'put' && p.local && (
        <p style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{tr('PC 파일 {0} ({1})을 Device {2}에 올려요.', p.local.name, fmtSize(p.local.size), p.remotePath ?? '')}</p>
      )}
      {p.op === 'put' && p.exists && <p className="msg-err" style={{ fontSize: 13 }}>{tr('같은 이름의 파일이 이미 있어요. 확인하면 덮어써요.')}</p>}
      {p.op === 'read' && p.serial && (
        <>
          <p style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{tr('이 PC의 {0}을(를) {1}으로 읽어요.', p.serial.path + (p.serial.label || p.serial.vidpid ? ` (${[p.serial.label, p.serial.vidpid].filter(Boolean).join(' · ')})` : ''), String(p.serial.baud))}</p>
          <p className="dim" style={{ fontSize: 12 }}>{tr('최대 {0}분 · {1}. 장치로 아무것도 보내지 않아요.', String(p.serial.minutes), fmtSize(p.serial.maxBytes))}</p>
          <p className="msg-err" style={{ fontSize: 13 }}>⚠ {tr('일부 장치는 포트를 열 때 다시 시작해요. 작업 중인 3D 프린터·기계의 포트는 열지 마세요.')}</p>
          <p className="dim" style={{ fontSize: 12 }}>{tr('다른 프로그램이 같은 포트를 쓰면 닫고 실행하세요.')}</p>
        </>
      )}
      {p.op === 'open' && p.tunnel && (
        <>
          <p style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{tr('이 PC의 127.0.0.1:{0}을 Device 포트 {1}에 연결해요.', String(p.tunnel.port), String(p.tunnel.remotePort))}</p>
          <p className="msg-err" style={{ fontSize: 13 }}>{tr('이 PC의 다른 프로그램도 이 주소에 접속할 수 있어요.')}</p>
          <p className="dim" style={{ fontSize: 12 }}>{tr('{0}분 뒤 또는 정지·연결 끊김 때 닫혀요.', String(p.tunnel.minutes))}</p>
        </>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
        <Button style={{ padding: '0 18px' }} onClick={onCancel}>{tr('취소')}</Button>
        <Button variant={p.risk === 'danger' ? 'warn' : 'primary'} style={{ padding: '0 20px' }} onClick={onOk}>{p.op === 'open' ? tr('열기') : p.op === 'read' ? tr('읽기') : p.exists ? tr('덮어쓰고 올리기') : tr('올리기')}</Button>
      </div>
    </dialog>
  )
}
