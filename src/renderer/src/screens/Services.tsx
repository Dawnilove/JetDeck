import { useEffect, useRef, useState } from 'react'
import { isSshUnit, termCommand, type Service, type SvcAction, type SvcData } from '../../../main/svcparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 서비스 화면: systemd 서비스 목록, 시작·정지·재시작, journalctl 로그(실시간 포함). Device에는 설치하는 것이 없고 systemctl·journalctl만 SSH로 실행
type Props = {
  connId: string
  online: boolean
  onLaunch: (cmd: string, warn?: string) => void // sudo 비밀번호가 필요하면 새 터미널 탭에서 직접 입력
}
const MAX_LOG = 200_000

const DOT = (s: Service) => (s.active === 'active' ? 'dot' : s.active === 'inactive' ? 'dot offline' : 'dot connecting') // 실패·전환 중은 주황
const ASK: Record<SvcAction, ((u: string) => string) | null> = {
  start: null,
  stop: (u) => tr("'{0}' 서비스를 정지할까요? 이 서비스를 쓰는 기능이 멈춰요.", u),
  restart: (u) => tr("'{0}' 서비스를 다시 시작할까요? 잠시 끊길 수 있어요.", u)
}

export default function Services({ connId, online, onLaunch }: Props) {
  const [data, setData] = useState<SvcData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [live, setLive] = useState(false)
  const [msg, setMsg] = useState('')
  const followId = useRef('')
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true) // 맨 아래를 보고 있으면 새 출력을 따라감

  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      setData(await window.api.svcList(connId))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (online) refresh()
  }, [online])

  const stopFollow = () => {
    if (followId.current) window.api.svcUnfollow(followId.current)
    followId.current = ''
    setLive(false)
  }
  useEffect(() => {
    const off1 = window.api.onSvcData((id, text) => id === followId.current && setLogs((l) => (l + text).slice(-MAX_LOG)))
    const off2 = window.api.onSvcEnd((id) => {
      if (id !== followId.current) return
      followId.current = ''
      setLive(false)
    })
    // 화면이 사라지면 journalctl -f도 멈춤
    return () => {
      off1()
      off2()
      if (followId.current) window.api.svcUnfollow(followId.current)
    }
  }, [])
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [logs])

  const readLogs = async (unit: string) => {
    stopFollow()
    setLogs(tr('불러오는 중…'))
    stick.current = true
    try {
      setLogs((await window.api.svcLogs(connId, unit)) || tr('(로그 없음)'))
    } catch (e) {
      setLogs(errText(e))
    }
  }
  const pick = (s: Service) => {
    setPicked(s.unit)
    setMsg('')
    readLogs(s.unit)
  }
  const follow = async (unit: string) => {
    stopFollow()
    setLogs('')
    stick.current = true
    const id = crypto.randomUUID()
    followId.current = id
    setLive(true)
    try {
      await window.api.svcFollow(connId, id, unit)
    } catch (e) {
      followId.current = ''
      setLive(false)
      setLogs(errText(e))
    }
  }
  const act = async (s: Service, action: SvcAction) => {
    const ask = ASK[action]
    if (ask && !confirm(ask(s.unit) + (action !== 'start' && isSshUnit(s.unit) ? '\n\n' + tr('SSH 서버를 멈추면 이 연결도 끊겨요.') : ''))) return
    setMsg(tr('{0}: {1} 중…', s.unit, action))
    try {
      const r = await window.api.svcAction(connId, s.unit, action)
      if (r.needPassword) {
        setMsg(tr('sudo 비밀번호가 필요해요. 새 터미널에서 직접 입력해 주세요.'))
        onLaunch(termCommand(action, s.unit), tr('서비스를 {0}해요. sudo 비밀번호를 물어볼 수 있어요.', action))
        return
      }
      setMsg(r.ok ? tr('완료') : r.text || tr('실패'))
      await refresh()
    } catch (e) {
      setMsg(errText(e))
    }
  }

  const f = filter.trim().toLowerCase()
  const ok = data?.state === 'ok' ? data : null
  const failedCount = ok?.services.filter((s) => s.active === 'failed').length ?? 0
  // 없는 유닛(not-found)은 목록에서 빼 노이즈를 줄임
  const list = (ok?.services ?? []).filter((s) => s.load !== 'not-found' && (!failedOnly || s.active === 'failed') && (s.unit + s.desc).toLowerCase().includes(f))
  const sel = ok?.services.find((s) => s.unit === picked)

  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('서비스 목록')}>
        <PanelHead title={tr('서비스')} desc={<Desc>{tr('Device의 systemd 서비스를 보고 시작·정지해요. Device에 따로 설치할 것은 없어요.')}</Desc>}>
          <Button size={36} onClick={refresh} disabled={!online || busy}>{busy ? tr('읽는 중…') : tr('새로고침')}</Button>
        </PanelHead>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <input className="input" style={{ flex: '1 1 160px', height: 40 }} placeholder={tr('이름으로 찾기')} aria-label={tr('이름으로 찾기')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
            {tr('실패한 것만 ({0})', failedCount)}
          </label>
        </div>
        <div className="ros-items" role="listbox" aria-label={tr('서비스')}>
          {!online && <Note>{tr('연결되면 서비스를 읽어요.')}</Note>}
          {online && busy && !data && <Note>{tr('읽는 중…')}</Note>}
          {online && error && <Note err>{error}</Note>}
          {online && data?.state === 'error' && <Note err>{data.text}</Note>}
          {online && data?.state === 'nosystemd' && <Note>{tr('이 Device는 systemd를 쓰지 않아요.')}</Note>}
          {online && list.map((s) => (
            <button key={s.unit} type="button" role="option" aria-selected={picked === s.unit} className="ros-item" onClick={() => pick(s)}>
              <span className={DOT(s)} aria-hidden style={{ width: 8, height: 8 }} />
              <span className="mono">{s.unit.replace(/\.service$/, '')}</span>
              <span className="dim mono ros-type">{s.sub}{s.desc && ` · ${s.desc}`}</span>
            </button>
          ))}
          {online && ok && !busy && !list.length && <Note>{f || failedOnly ? tr('찾는 서비스가 없어요.') : tr('서비스가 없어요.')}</Note>}
        </div>
      </section>

      <section className="card card-sm fw-add ros-detail" aria-label={tr('자세히')}>
        {sel ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="mono" style={{ wordBreak: 'break-all' }}>{sel.unit}</h2>
              <span className="dim" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{sel.desc} · {sel.active} ({sel.sub})</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sel.active !== 'active' && <Button size={36} variant="primary" disabled={!online} onClick={() => act(sel, 'start')}>{tr('시작')}</Button>}
              {sel.active === 'active' && <Button size={36} disabled={!online} onClick={() => act(sel, 'stop')}>{tr('정지')}</Button>}
              {sel.active === 'active' && <Button size={36} disabled={!online} onClick={() => act(sel, 'restart')}>{tr('재시작')}</Button>}
            </div>
            {msg && <p className="dim mono" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{msg}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <h2 style={{ marginRight: 'auto' }}>{live ? tr('로그 (실시간)') : tr('로그 (마지막 200줄)')}</h2>
              <Button size={36} disabled={!online} onClick={() => readLogs(sel.unit)}>{tr('다시 읽기')}</Button>
              {live ? <Button size={36} variant="warn" onClick={stopFollow}>{tr('실시간 중지')}</Button> : <Button size={36} disabled={!online} onClick={() => follow(sel.unit)}>{tr('실시간')}</Button>}
            </div>
            <pre
              ref={box}
              className="hk-code ros-out"
              onScroll={(e) => {
                const el = e.currentTarget
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              }}
            >{logs}</pre>
          </>
        ) : (
          <>
            <h2>{tr('서비스')}</h2>
            <p className="dim" style={{ fontSize: 13 }}>{tr('왼쪽에서 서비스를 고르면 시작·정지·재시작과 로그를 볼 수 있어요.')}</p>
          </>
        )}
      </section>
    </div>
  )
}
