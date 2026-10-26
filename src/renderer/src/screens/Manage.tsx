import { useEffect, useRef, useState } from 'react'
import { getLang, tr } from '../../../main/i18n.mts'
import { fill, resolveParams, type PackResult } from '../../../main/packrun.mts'
import type { L10n, Pack, PackAction } from '../../../main/packschema.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'

// 기기 관리 도구 화면: 팩(main/packs/*.json)의 페이지·항목을 그리기만 하는 범용 화면. 명령은 화면이 만들지 않고 항목 id만 main에 보냄
type Props = {
  connId: string
  online: boolean
  onLaunch: (cmd: string, warn?: string) => void // sudo 비밀번호가 필요하면 새 터미널 탭에서 직접 입력
}
type Cell = { busy: boolean; result?: PackResult; error?: string }
type Ask = { action: PackAction; values: Record<string, string>; preview?: string; loading: boolean; error?: string }

const t = (l: L10n) => l[getLang()]

export default function Manage({ connId, online, onLaunch }: Props) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [pageId, setPageId] = useState('')
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [params, setParams] = useState<Record<string, Record<string, string>>>({}) // 항목 id → 고른 선택값
  const [ask, setAsk] = useState<Ask | null>(null)
  const pages = packs.flatMap((p) => p.plugins)
  const page = pages.find((p) => p.id === pageId) ?? pages[0]
  const shown = (page?.actions ?? []).filter((a) => a.mode === 'exec' && !a.hidden) // 터미널 입력·새 앱이 필요한 항목은 세션 B의 PackView가 다룸
  const where = (a: PackAction): [string, string] => {
    for (const p of packs) for (const pl of p.plugins) if (pl.actions.includes(a)) return [p.id, pl.id]
    return ['', '']
  }
  const started = useRef(new Set<string>()) // 자동 실행은 연결·페이지마다 한 번

  useEffect(() => {
    window.api.packList().then((p) => {
      setPacks(p)
      setPageId(p[0]?.plugins[0]?.id ?? '')
    })
  }, [])
  useEffect(() => {
    started.current.clear()
    setCells({})
  }, [connId])

  const valuesOf = (a: PackAction) => resolveParams(a, params[a.id])
  const setCell = (id: string, c: Cell) => setCells((m) => ({ ...m, [id]: c }))
  const exec = async (a: PackAction, values: Record<string, string>): Promise<PackResult | null> => {
    setCell(a.id, { busy: true })
    try {
      const r = await window.api.packRun(connId, ...where(a), a.id, values, 'run')
      setCell(a.id, { busy: false, result: r })
      return r
    } catch (e) {
      setCell(a.id, { busy: false, error: errText(e) })
      return null
    }
  }
  const autoRun = (all: boolean) => {
    for (const a of shown) if (a.auto && (all || !started.current.has(a.id))) {
      started.current.add(a.id)
      exec(a, valuesOf(a))
    }
  }
  useEffect(() => {
    if (online && page) autoRun(false)
  }, [online, page?.id, connId])

  const click = async (a: PackAction) => {
    const values = valuesOf(a)
    if (a.risk === 'read') {
      exec(a, values)
      return
    }
    setAsk({ action: a, values, loading: !!a.preview })
    if (!a.preview) return
    try {
      const r = await window.api.packRun(connId, ...where(a), a.id, values, 'preview')
      setAsk((s) => (s?.action.id === a.id ? { ...s, preview: r.text, loading: false } : s))
    } catch (e) {
      setAsk((s) => (s?.action.id === a.id ? { ...s, error: errText(e), loading: false } : s))
    }
  }
  const confirmAsk = async () => {
    if (!ask) return
    const { action: a, values } = ask
    setAsk(null)
    const r = await exec(a, values)
    if (r?.needPassword && r.termCmd) onLaunch(r.termCmd, tr('sudo 비밀번호를 물어볼 수 있어요. 터미널에서 직접 입력해 주세요.'))
    else if (r?.ok) autoRun(true) // 바뀐 뒤 목록·상태를 다시 읽음
  }

  return (
    <div className="fw" style={{ flexDirection: 'column', flexWrap: 'nowrap' }}>
      <PanelHead title={tr('업데이트·디스크·전원')} desc={<Desc>{tr('Device의 패키지 업데이트·디스크·전원 설정을 다뤄요. 바꾸는 작업은 항상 확인을 거치고, Device에 따로 설치할 것은 없어요.')}</Desc>} />
      {pages.length > 1 && (
        <div style={{ alignSelf: 'flex-start' }}>
          <Segment label={tr('종류')} value={page?.id ?? ''} onChange={setPageId} options={pages.map((p) => ({ value: p.id, label: t(p.title) }))} />
        </div>
      )}
      {!online && <Note>{tr('연결되면 사용할 수 있어요.')}</Note>}
      {page?.desc && <Desc>{t(page.desc)}</Desc>}
      {online &&
        shown.map((a) => {
          const c = cells[a.id]
          return (
            <section key={a.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={t(a.label)}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <h2 style={{ marginRight: 'auto' }}>{t(a.label)}</h2>
                {a.params?.map((p) => (
                  <label key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
                    {t(p.label)}
                    <select className="input" style={{ height: 36 }} value={params[a.id]?.[p.name] ?? p.choices[0].value} onChange={(e) => setParams((m) => ({ ...m, [a.id]: { ...m[a.id], [p.name]: e.target.value } }))}>
                      {p.choices.map((ch) => (
                        <option key={ch.value} value={ch.value}>{t(ch.label)}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <Button size={36} variant={a.risk === 'danger' ? 'warn' : 'secondary'} disabled={c?.busy} onClick={() => click(a)}>
                  {c?.busy ? tr('실행 중…') : a.risk === 'read' ? (a.auto ? tr('다시 읽기') : tr('보기')) : tr('실행…')}
                </Button>
              </div>
              {a.desc && <p className="dim" style={{ fontSize: 13 }}>{t(a.desc)}</p>}
              <Result a={a} c={c} />
            </section>
          )
        })}
      {ask && <AskDialog ask={ask} onCancel={() => setAsk(null)} onOk={confirmAsk} />}
    </div>
  )
}

// 결과: 표 또는 글자. 비밀번호가 필요하면 새 터미널로 넘겼다고 알림
function Result({ a, c }: { a: PackAction; c?: Cell }) {
  if (!c) return null
  if (c.error) return <p className="msg-err" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{c.error}</p>
  const r = c.result
  if (!r) return null
  if (r.needPassword) return <p className="dim mono" role="status" style={{ fontSize: 12 }}>{tr('sudo 비밀번호가 필요해요. 새 터미널에서 직접 입력해 주세요.')}</p>
  if (a.display?.type === 'table' && r.ok) {
    const d = a.display
    if (!r.rows?.length) return <p className="dim" role="status" style={{ fontSize: 13 }}>{d.empty ? t(d.empty) : tr('결과가 없어요.')}</p>
    return (
      <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
        <table className="pk-table">
          <thead>
            <tr>{d.columns.map((col, i) => <th key={i}>{t(col)}</th>)}</tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j} className="mono">{j === 0 && d.labels?.[cell] ? t(d.labels[cell]) : cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <>
      <p className={r.ok ? 'dim' : 'msg-err'} role="status" style={{ fontSize: 12 }}>{r.ok ? tr('완료') : tr('실패')}</p>
      {r.text && <pre className="hk-code ros-out" style={{ minHeight: 0 }}>{r.text}</pre>}
    </>
  )
}

// 실행 전 확인: 팩의 confirm 문구 + (있으면) 미리보기 결과 + 실제로 실행할 명령
function AskDialog({ ask, onCancel, onOk }: { ask: Ask; onCancel: () => void; onOk: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const a = ask.action
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const cmd = (a.sudo ? 'sudo ' : '') + fill(a.cmd, ask.values)
  return (
    <dialog ref={ref} className="hk" aria-labelledby="pk-title" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h1 id="pk-title" style={{ fontSize: 20, fontWeight: 600 }}>{t(a.label)}</h1>
      {a.confirm && <p style={{ fontSize: 14 }}>{t(a.confirm)}</p>}
      {a.preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="caption">{tr('미리보기 (아직 아무것도 바뀌지 않았어요)')}</span>
          {ask.loading ? <p className="dim">{tr('미리보기 불러오는 중…')}</p> : ask.error ? <p className="msg-err">{ask.error}</p> : <pre className="hk-code ros-out" style={{ minHeight: 0, maxHeight: '30vh' }}>{ask.preview || tr('(바뀌는 것이 없어요)')}</pre>}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{tr('실행할 명령')}</span>
        <code className="hk-code">{cmd}</code>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
        <Button style={{ padding: '0 18px' }} onClick={onCancel}>{tr('취소')}</Button>
        <Button variant={a.risk === 'danger' ? 'warn' : 'primary'} style={{ padding: '0 20px' }} disabled={ask.loading || !!ask.error} onClick={onOk}>{tr('실행')}</Button>
      </div>
    </dialog>
  )
}
