import { useEffect, useState } from 'react'
import type { ActLite as Act } from '../../../main/activity'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { tr } from '../../../main/i18n.mts'

// AI 활동: MCP로 AI 도구(Claude·Cursor·Codex 등)가 Device에서 한 일의 기록. 최근 500건, 앱 메모리에만 보관
const TOOL: Record<string, string> = { run_command: tr('명령'), read_file: tr('파일 읽기'), write_file: tr('파일 쓰기'), list_dir: tr('폴더 보기'), get_status: tr('상태 조회'), read_terminal: tr('터미널 읽기'), connect: tr('연결'), list_hosts: tr('기기 목록'), external: tr('다른 접속'), external_conn: tr('접속') }
const STATUS: Record<Act['status'], string> = { running: tr('실행 중'), ok: tr('완료'), error: tr('오류'), denied: tr('허용 안 함') }
const two = (n: number) => String(n).padStart(2, '0')
const clock = (t: number) => {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? tr('{0}초', (ms / 1000).toFixed(1)) : tr('{0}분 {1}초', Math.floor(ms / 60_000), Math.floor((ms % 60_000) / 1000)))

export default function AiActivity() {
  const [list, setList] = useState<Act[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [detail, setDetail] = useState('')
  const [now, setNow] = useState(Date.now())
  const [observe, setObserve] = useState(true)

  useEffect(() => {
    window.api.activityList().then(setList, () => {})
    window.api.observeGet().then(setObserve, () => {})
    // 시작·끝 알림이 같은 id로 오면 그 줄을 갈아 끼움
    const off = window.api.onActivity((a) => setList((l) => (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l.slice(-499), a])))
    const t = setInterval(() => setNow(Date.now()), 1000) // 실행 중인 줄의 경과 시간
    return () => (off(), clearInterval(t))
  }, [])

  const toggle = (a: Act) => {
    if (open === a.id) return setOpen(null)
    setOpen(a.id)
    setDetail(tr('불러오는 중…'))
    window.api.activityDetail(a.id).then((d) => setDetail(d || (a.status === 'running' ? tr('(아직 실행 중이에요)') : tr('(결과 없음)'))), () => setDetail(''))
  }
  // 메모리에만 있는 기록이라 지우면 되돌릴 수 없음 → 한 번 확인
  const clear = () => {
    if (!confirm(tr('AI 활동 기록 {0}건을 모두 지울까요? 되돌릴 수 없어요.', list.length))) return
    window.api.activityClear().then(() => (setList([]), setOpen(null)))
  }
  const rows = [...list].reverse()
  const running = list.filter((a) => a.status === 'running' && a.tool !== 'external_conn').length // 접속 중인 줄은 제외 (일이 아니라 접속 상태)

  return (
    <div className="hist">
      <PanelHead
        hist
        title={<>{tr('AI 활동')}{running > 0 && <span className="msg-ok" style={{ fontWeight: 400, fontSize: 14 }}> · {tr('{0}개 실행 중', running)}</span>}</>}
        desc={
          <>
            <Desc max={720}>
              {tr('Claude·Cursor·Codex 같은 AI 도구가 JetDeck(MCP)을 통해 Device에서 한 일이에요. 최근 500건을 이 앱의 메모리에만 보관해요. 비밀번호·토큰처럼 보이는 값은 가리지만 완벽하지는 않아요. 파일을 읽은 내용은 기록하지 않아요.')}
            </Desc>
            <p className="dim" style={{ fontSize: 12, maxWidth: 720 }}>
              {tr('"다른 접속" 줄은 JetDeck을 거치지 않은 SSH 접속을 2초마다 읽어 추정한 거예요. 2초보다 짧은 명령은 놓칠 수 있고, AI인지 사람인지는 알 수 없어요(명령형=notty, 터미널형=pts). 다른 계정의 접속은 접속한 PC 주소를 못 읽을 수 있어요.')}
            </p>
          </>
        }
      >
          <label className="check" title={tr('켜 두면 연결된 동안 2초마다 Device의 ps를 읽어서, JetDeck을 거치지 않고 따로 SSH로 접속한 사람·AI·스크립트의 명령을 기록해요')}>
            <input type="checkbox" checked={observe} onChange={(e) => (setObserve(e.target.checked), window.api.observeSet(e.target.checked))} />{tr('다른 SSH 접속 관찰')}
          </label>
          <Button size={36} disabled={!list.length} onClick={clear}>{tr('기록 비우기')}</Button>
      </PanelHead>
      {!list.length && <Note>{tr('아직 기록이 없어요. AI 도구가 JetDeck으로 Device에서 명령을 실행하거나 파일을 다루면 여기에 쌓여요.')}</Note>}
      {!!list.length && (
        <section className="card card-sm" aria-label={tr('AI 활동 목록')} style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              {rows.map((a) => (
                <div key={a.id}>
                  <button type="button" className="ai-row" aria-expanded={open === a.id} onClick={() => toggle(a)} title={tr('{0} — 눌러서 자세히', STATUS[a.status])}>
                    <span className={a.status === 'running' ? 'dot connecting' : a.status === 'ok' ? 'dot' : 'dot offline'} aria-hidden style={{ width: 8, height: 8 }} />
                    <span className="mono dim">{clock(a.t)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.client}>{a.client}</span>
                    <span className="dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.host || '—'}</span>
                    <span className="tag">{TOOL[a.tool] ?? a.tool}</span>
                    <span className="mono ai-sum">{a.summary}</span>
                    <span className={a.status === 'error' || a.status === 'denied' ? 'msg-err' : 'dim'} style={{ textAlign: 'right', fontSize: 12 }}>
                      {a.status === 'running' ? dur(now - a.t) : a.status === 'ok' ? dur(a.ms ?? 0) : `${STATUS[a.status]}${a.ms != null ? ` · ${dur(a.ms)}` : ''}`}
                    </span>
                  </button>
                  {open === a.id && (
                    <div style={{ padding: '8px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {a.summary && <pre className="hk-code ros-out" style={{ minHeight: 0, maxHeight: 120 }}>{a.summary}</pre>}
                      <pre className="hk-code ros-out" style={{ maxHeight: '40vh' }}>{detail}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
