import { useEffect, useRef, useState } from 'react'
import { killBlock, killWarn, procName, procRest, type Proc } from '../../../main/procparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 프로세스 목록·종료: 이 탭이 열려 있는 동안만 2초마다 ps로 읽음. 종료는 확인 창 필수, 내 계정 프로세스만
type Sort = 'cpu' | 'mem' | 'pid'
const SHOW = 100 // 화면에 그릴 최대 줄 수
const fmtTime = (s: number) => (s < 60 ? tr('{0}초', s) : s < 3600 ? tr('{0}분', Math.floor(s / 60)) : s < 86400 ? tr('{0}시간 {1}분', Math.floor(s / 3600), Math.floor((s % 3600) / 60)) : tr('{0}일', Math.floor(s / 86400)))

export default function ProcessList({ connId, online }: { connId: string; online: boolean }) {
  const [data, setData] = useState<{ me: string; procs: Proc[] } | null>(null)
  const [sort, setSort] = useState<Sort>('cpu')
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [error, setError] = useState('')
  const [termed, setTermed] = useState<Set<number>>(new Set()) // 정상 종료를 요청했는데 아직 남아 있는 PID → 강제 종료 버튼
  const busy = useRef(false)

  const load = async () => {
    if (busy.current) return
    busy.current = true
    try {
      const d = await window.api.procList(connId)
      setData(d)
      setError('')
      setTermed((s) => new Set([...s].filter((pid) => d.procs.some((p) => p.pid === pid)))) // 사라진 건 목록에서 뺌
    } catch (e) {
      setError(errText(e))
    } finally {
      busy.current = false
    }
  }
  useEffect(() => {
    if (!online) return
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [connId, online])

  const kill = async (p: Proc, force: boolean) => {
    const what = `${procName(p.args)} (PID ${p.pid})\n${p.args.length > 300 ? p.args.slice(0, 300) + '…' : p.args}`
    const ask = force
      ? tr('강제 종료할까요?\n\n{0}\n\n프로세스가 정리할 틈 없이 즉시 끝나요. 저장하지 않은 데이터가 사라질 수 있어요.{1}', what, killWarn(p))
      : tr('종료할까요?\n\n{0}\n\n정상 종료를 요청해요. 이 프로세스가 만든 다른 프로세스는 남을 수 있어요.{1}', what, killWarn(p))
    if (!confirm(ask)) return
    try {
      await window.api.procKill(connId, p.pid, p.args, force)
      setMsg({ text: (force ? tr('{0} ({1})에 강제 종료를 요청했어요', procName(p.args), p.pid) : tr('{0} ({1})에 종료를 요청했어요', procName(p.args), p.pid)), ok: true })
      if (!force) setTermed((s) => new Set(s).add(p.pid))
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    }
    load()
  }

  const f = filter.trim().toLowerCase()
  const rows = (data?.procs ?? [])
    .filter((p) => !f || (p.args + p.user + p.pid).toLowerCase().includes(f))
    .sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu || b.mem - a.mem : sort === 'mem' ? b.mem - a.mem || b.cpu - a.cpu : a.pid - b.pid))
  const me = data?.me ?? ''

  return (
    <div className="hist">
      <PanelHead
        hist
        title={<>{tr('프로세스')}{data && <span className="dim" style={{ fontWeight: 400 }}> · {tr('{0}개', data.procs.length)}</span>}</>}
        desc={<Desc>{tr('Device의 ps로 2초마다 읽어요. 종료는 내 계정({0})의 프로세스만 할 수 있어요.', me || '…')}</Desc>}
      >
          <Segment label={tr('정렬')} value={sort} onChange={setSort} options={[{ value: 'cpu', label: tr('CPU순') }, { value: 'mem', label: tr('메모리순') }, { value: 'pid', label: tr('PID순') }]} />
          <input className="input" style={{ width: 200, height: 40 }} placeholder={tr('이름·PID로 찾기')} aria-label={tr('이름·PID로 찾기')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </PanelHead>
      {msg && <p role="status" className={msg.ok ? 'msg-ok' : 'msg-err'} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{msg.text}</p>}
      {!online && <Note>{tr('연결되면 프로세스를 읽어요.')}</Note>}
      {online && error && <Note err>{error}</Note>}
      {online && !data && !error && <Note>{tr('읽는 중…')}</Note>}
      {online && data && (
        <section className="card card-sm" aria-label={tr('프로세스 목록')} style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div className="proc-row proc-th">
                <span>PID</span><span>{tr('사용자')}</span><span>CPU%</span><span>{tr('메모리%')}</span><span>{tr('실행 시간')}</span><span>{tr('명령')}</span><span />
              </div>
              {rows.slice(0, SHOW).map((p) => {
                const block = killBlock(p, me)
                return (
                  <div key={p.pid} className="proc-row">
                    <span className="mono">{p.pid}</span>
                    <span className="mono dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.user}>{p.user}</span>
                    <span className="mono">{p.cpu.toFixed(1)}</span>
                    <span className="mono">{p.mem.toFixed(1)}</span>
                    <span className="dim">{fmtTime(p.secs)}</span>
                    <span className="mono proc-cmd" title={p.args}><b>{procName(p.args)}</b> <span className="dim">{procRest(p.args)}</span></span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {termed.has(p.pid) && !block && <Button size={36} variant="warn" onClick={() => kill(p, true)} title={tr('종료 요청에도 남아 있어요. 즉시 끝내요')}>{tr('강제 종료')}</Button>}
                      <Button size={36} disabled={!!block} onClick={() => kill(p, false)} title={block ?? tr('정상 종료를 요청해요 (확인 창이 떠요)')}>{tr('종료')}</Button>
                    </span>
                  </div>
                )
              })}
              {!rows.length && <p className="dim fw-empty">{f ? tr('찾는 프로세스가 없어요.') : tr('프로세스를 읽지 못했어요.')}</p>}
              {rows.length > SHOW && <p className="dim fw-empty">{tr('위쪽 {0}개만 보여요 ({1}개 중). 이름으로 찾아 좁혀 보세요.', SHOW, rows.length)}</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
