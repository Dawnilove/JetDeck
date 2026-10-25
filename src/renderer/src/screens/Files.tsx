import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { JobIn, XferEvent } from '../../../main/transfer'
import Button from '../components/Button'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'
import { fmtSize } from './uifmt.mts'

// 파일 전송 화면 (design/Files.dc.html): 왼쪽 내 컴퓨터, 오른쪽 젯슨, 아래 전송 대기열
type Props = { connId: string; online: boolean; home: string; hostName: string }
type Item = { name: string; path: string; dir: boolean; size: number; meta: string } // meta: 날짜(내 PC) 또는 권한(젯슨)
type Side = 'local' | 'remote'
type Q = JobIn & { id: string; status: XferEvent['status']; done: number; total: number; error?: string; t0: number }

const DRAG = 'application/x-nanoterm-files'
const day = (ms: number) => new Date(ms).toLocaleDateString('sv-SE') // YYYY-MM-DD
const rdir = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'

type PaneProps = {
  side: Side
  label: string
  path: string
  items: Item[]
  selected: Set<string>
  metaLabel: string
  canUp: boolean
  error: string
  action: { label: string; primary: boolean; disabled: boolean; run: () => void }
  onSelect: (s: Set<string>) => void
  onOpenDir: (path: string) => void
  onUp: () => void
  onDrop: (from: Side, items: Item[]) => void
  onDropOsFiles?: (files: File[]) => void
}

function Pane(p: PaneProps) {
  const [over, setOver] = useState(false)
  const click = (e: MouseEvent, it: Item) => {
    const s = new Set(e.ctrlKey ? p.selected : [])
    if (e.ctrlKey && s.has(it.path)) s.delete(it.path)
    else s.add(it.path)
    p.onSelect(s)
  }
  const dragStart = (e: DragEvent, it: Item) => {
    // 선택된 행을 끌면 선택한 것 모두, 아니면 그 행만
    const items = p.selected.has(it.path) ? p.items.filter((x) => p.selected.has(x.path)) : [it]
    e.dataTransfer.setData(DRAG, JSON.stringify({ from: p.side, items }))
    e.dataTransfer.effectAllowed = 'copy'
  }
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG) || (!!p.onDropOsFiles && e.dataTransfer.types.includes('Files'))

  return (
    <section
      aria-label={p.label}
      className={`xf-pane ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const raw = e.dataTransfer.getData(DRAG)
        if (raw) {
          const d = JSON.parse(raw) as { from: Side; items: Item[] }
          if (d.from !== p.side) p.onDrop(d.from, d.items)
        } else if (p.onDropOsFiles && e.dataTransfer.files.length) p.onDropOsFiles([...e.dataTransfer.files])
      }}
    >
      <div className="xf-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span className="dim" style={{ fontSize: 12 }}>{p.label}</span>
          <span className="mono xf-path" title={p.path}>{p.path || '…'}</span>
        </div>
        <Button variant={p.action.primary ? 'primary' : 'filled'} size={40} disabled={p.action.disabled} onClick={p.action.run}>
          {p.action.label}
        </Button>
      </div>
      <div className="xf-table" role="grid" aria-label={tr('{0} 파일 목록', p.label)}>
        <div className="xf-row xf-th" role="row">
          <span>{tr('이름')}</span>
          <span style={{ textAlign: 'right' }}>{tr('크기')}</span>
          <span>{p.metaLabel}</span>
        </div>
        {p.canUp && (
          <button type="button" className="xf-row" onDoubleClick={p.onUp} title={tr('상위 폴더 (더블클릭)')}>
            <span className="xf-name"><span className="tree-icon dir" />..</span>
            <span className="xf-size">—</span>
            <span />
          </button>
        )}
        {p.items.map((it) => (
          <button
            key={it.path}
            type="button"
            role="row"
            aria-selected={p.selected.has(it.path)}
            className="xf-row"
            draggable
            title={it.dir ? tr('{0} (더블클릭으로 열기 · 끌어다 놓으면 폴더째 전송)', it.name) : it.name}
            onClick={(e) => click(e, it)}
            onDoubleClick={() => it.dir && p.onOpenDir(it.path)}
            onDragStart={(e) => dragStart(e, it)}
          >
            <span className="xf-name">
              <span className={`tree-icon ${it.dir ? 'dir' : ''}`} />
              <span className="tree-name">{it.name}</span>
            </span>
            <span className="xf-size">{it.dir ? '—' : fmtSize(it.size)}</span>
            <span className="xf-meta">{it.meta}</span>
          </button>
        ))}
        {p.error && <p className="msg-err xf-note">{p.error}</p>}
      </div>
    </section>
  )
}

export default function Files({ connId, online, home, hostName }: Props) {
  const [local, setLocal] = useState<{ dir: string; parent: string | null; items: Item[] }>({ dir: '', parent: null, items: [] })
  const [remote, setRemote] = useState<{ dir: string; items: Item[] }>({ dir: '', items: [] })
  const [selL, setSelL] = useState<Set<string>>(new Set())
  const [selR, setSelR] = useState<Set<string>>(new Set())
  const [err, setErr] = useState({ local: '', remote: '', top: '' })
  const [queue, setQueue] = useState<Q[]>([])
  const [, tick] = useState(0)
  const dirsRef = useRef({ local: '', remote: '' })
  dirsRef.current = { local: local.dir, remote: remote.dir }

  const loadLocal = async (dir?: string) => {
    try {
      const r = await window.api.listLocal(dir)
      setLocal({ dir: r.dir, parent: r.parent, items: r.entries.map((e) => ({ ...e, meta: day(e.mtime) })) })
      setSelL(new Set())
      setErr((x) => ({ ...x, local: '' }))
    } catch (e) {
      setErr((x) => ({ ...x, local: errText(e) }))
    }
  }
  const loadRemote = async (dir: string) => {
    try {
      const list = await window.api.fsList(connId, dir)
      setRemote({ dir, items: list.map((e) => ({ ...e, meta: e.perm })) })
      setSelR(new Set())
      setErr((x) => ({ ...x, remote: '' }))
    } catch (e) {
      setErr((x) => ({ ...x, remote: errText(e) }))
    }
  }

  useEffect(() => {
    loadLocal()
  }, [])
  useEffect(() => {
    if (online && home && !remote.dir) loadRemote(home)
  }, [online, home])

  // 진행 이벤트 → 대기열 갱신, 끝나면 받는 쪽 목록 새로고침
  useEffect(
    () =>
      window.api.onXfer((ev) => {
        if (ev.connId !== connId) return // 다른 세션(다른 젯슨)의 전송
        setQueue((q) => {
          const job = q.find((x) => x.id === ev.id)
          // 탐색기 우클릭으로 시작한 전송도 대기열에 보이게: 처음 보는 작업은 이벤트에 담긴 정보로 추가
          if (!job) return [...q, { ...ev.job, ...ev, total: ev.total || ev.job.size, t0: Date.now() }]
          if (ev.status === 'done' && job.status !== 'done') {
            if (job.kind === 'up' && job.dstDir === dirsRef.current.remote) loadRemote(job.dstDir)
            if (job.kind === 'down' && job.dstDir === dirsRef.current.local) loadLocal(job.dstDir)
          }
          // 속도는 실제로 전송을 시작한 때부터 계산 (대기 시간 제외)
          return q.map((x) => (x.id === ev.id ? { ...x, ...ev, total: ev.total || x.total, t0: ev.status === 'running' && x.status === 'queued' ? Date.now() : x.t0 } : x))
        })
      }),
    []
  )
  // 속도 표시용 1초 갱신 (진행 중일 때만)
  const busy = queue.some((q) => q.status === 'running' || q.status === 'queued')
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  const start = async (kind: 'up' | 'down', items: Item[]) => {
    if (!items.length) return
    setErr((x) => ({ ...x, top: '' }))
    const dstDir = kind === 'up' ? remote.dir : local.dir
    // 폴더는 main이 안의 파일들로 펼쳐서 보냄 (크기는 파일마다 따로)
    const jobs: JobIn[] = items.map((f) => ({ kind, src: f.path, dstDir, name: f.name, size: f.dir ? 0 : f.size }))
    try {
      const dup = await window.api.xferConflicts(connId, jobs)
      if (dup.length && !confirm(tr('이미 있는 파일 {0}개를 덮어쓸까요?\n\n{1}', dup.length, dup.slice(0, 8).join('\n') + (dup.length > 8 ? '\n…' : '')))) return
      await window.api.xferAdd(connId, jobs) // 대기열 표시는 'queued' 이벤트가 채움
      if (items.some((i) => i.dir)) void (kind === 'up' ? loadRemote(dstDir) : loadLocal(dstDir)) // 새 폴더가 바로 보이게
    } catch (e) {
      setErr((x) => ({ ...x, top: errText(e) }))
    }
  }

  const running = queue.filter((q) => q.status === 'running')
  const speed = running.reduce((s, q) => s + q.done / Math.max(0.5, (Date.now() - q.t0) / 1000), 0)
  const waiting = queue.filter((q) => q.status === 'queued').length
  const doneN = queue.filter((q) => q.status === 'done').length
  // 폴더를 보내면 수백 줄이 되므로 진행 중 → 대기 → 끝난 것(최근 먼저) 순으로 30줄만 보임
  const rows = [...running, ...queue.filter((q) => q.status === 'queued'), ...queue.filter((q) => q.status !== 'running' && q.status !== 'queued').reverse()]

  return (
    <div className="xf">
      {err.top && <p className="msg-err xf-note" role="status">{err.top}</p>}
      <div className="xf-panes">
        <Pane
          side="local"
          label={tr('내 컴퓨터')}
          path={local.dir}
          items={local.items}
          selected={selL}
          metaLabel={tr('수정한 날짜')}
          canUp={!!local.parent}
          error={err.local}
          action={{ label: tr('업로드 →'), primary: true, disabled: !online || !remote.dir || !selL.size, run: () => start('up', local.items.filter((i) => selL.has(i.path))) }}
          onSelect={setSelL}
          onOpenDir={loadLocal}
          onUp={() => local.parent && loadLocal(local.parent)}
          onDrop={(_from, items) => start('down', items)}
        />
        <Pane
          side="remote"
          label={hostName}
          path={remote.dir}
          items={remote.items}
          selected={selR}
          metaLabel={tr('권한')}
          canUp={!!remote.dir && remote.dir !== '/'}
          error={online ? err.remote : tr('연결되면 Device 파일이 보여요.')}
          action={{ label: tr('← 다운로드'), primary: false, disabled: !online || !local.dir || !selR.size, run: () => start('down', remote.items.filter((i) => selR.has(i.path))) }}
          onSelect={setSelR}
          onOpenDir={loadRemote}
          onUp={() => loadRemote(rdir(remote.dir))}
          onDrop={(_from, items) => start('up', items)}
          onDropOsFiles={(files) =>
            start(
              'up',
              files.map((f) => ({ name: f.name, path: window.api.pathForFile(f), dir: false, size: f.size, meta: '' }))
            )
          }
        />
      </div>

      <section className="xf-queue" aria-label={tr('전송 대기열')}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>{tr('전송 대기열')}</h2>
          <span className="dim" style={{ fontSize: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            {running.length ? tr('{0}개 진행 중 · {1}/s', running.length, fmtSize(Math.round(speed))) : waiting ? tr('{0}개 대기 중', waiting) : queue.length ? tr('모두 끝났어요') : tr('파일이나 폴더를 고르거나 반대편으로 끌어다 놓으세요')}
            {queue.length > 1 && <span>{tr('완료 {0}/{1}', doneN, queue.length)}</span>}
            {(running.length > 0 || waiting > 0) && (
              <button type="button" className="ws-mini" onClick={() => queue.filter((q) => q.status === 'running' || q.status === 'queued').forEach((q) => window.api.xferCancel(q.id))}>
                {tr('모두 취소')}
              </button>
            )}
            {queue.some((q) => q.status === 'done' || q.status === 'error' || q.status === 'canceled') && (
              <button type="button" className="ws-mini" onClick={() => setQueue((q) => q.filter((x) => x.status === 'running' || x.status === 'queued'))}>
                {tr('끝난 항목 지우기')}
              </button>
            )}
          </span>
        </div>
        {rows.slice(0, 30).map((q) => {
          const pct = q.status === 'done' ? 100 : q.total ? (q.done / q.total) * 100 : 0
          return (
            <div key={q.id} className="xf-job">
              <span className="dim" style={{ width: 72, fontSize: 12 }}>{q.kind === 'up' ? tr('업로드 ↑') : tr('다운로드 ↓')}</span>
              <span className="mono xf-job-name" title={q.src}>{q.label ?? q.name}</span>
              <div className="xf-bar" role="progressbar" aria-label={q.name} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className={q.status === 'done' ? 'done' : ''} style={{ width: `${pct}%` }} />
              </div>
              <span className={`mono xf-job-status ${q.status === 'error' ? 'msg-err' : ''}`} title={q.error}>
                {q.status === 'queued' ? tr('대기 중') : q.status === 'running' ? `${fmtSize(q.done)} / ${fmtSize(q.total)}` : q.status === 'done' ? tr('완료') : q.status === 'canceled' ? tr('취소됨') : tr('실패: {0}', q.error)}
              </span>
              {/* 대기 중·전송 중일 때만 취소. 취소하면 받던 임시 파일은 지워지고 기존 파일은 그대로 */}
              <button
                type="button"
                className="ws-icon-btn"
                aria-label={tr('{0} 전송 취소', q.name)}
                title={tr('전송 취소')}
                style={{ visibility: q.status === 'queued' || q.status === 'running' ? undefined : 'hidden' }}
                onClick={() => window.api.xferCancel(q.id)}
              >
                ×
              </button>
            </div>
          )
        })}
        {rows.length > 30 && <p className="dim xf-note">{tr('…외 {0}개', rows.length - 30)}</p>}
      </section>
    </div>
  )
}
