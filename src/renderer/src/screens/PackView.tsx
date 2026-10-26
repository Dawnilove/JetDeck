import { useEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '../../../main/i18n.mts'
import { resolveParams, type PackResult } from '../../../main/packrun.mts'
import type { Pack, PackAction, PackPlugin } from '../../../main/packschema.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import AskDialog, { type Ask } from './PackAsk'
import { FieldInputs, formErrors, useFormValues } from './PackForm'
import { lt } from './PackUi'

// 일반 플러그인 화면 (4.5.0 Manage를 일반화): 팩의 플러그인 하나를 카드로 그림. 명령은 화면이 만들지 않고 항목 id만 main에 보냄
type Cell = { busy: boolean; result?: PackResult; error?: string }
export type Trigger = { packId: string; pluginId: string; actionId: string; n: number } // 명령 팔레트에서 항목을 골랐을 때 (같은 확인 흐름을 탐)

type Props = {
  connId: string
  online: boolean
  jetson: boolean // when:'jetson' 항목은 젯슨일 때만 표시
  pack: Pack
  plugin: PackPlugin
  trigger?: Trigger | null
  onTriggerDone?: () => void
  onLaunch: (cmd: string, warn?: string) => void // sudo 비밀번호가 필요하면 새 터미널 탭에서 직접 입력
  onTerminal: (text: string, enter: boolean) => void // 터미널 입력 모드: 활성 터미널에 입력 (없으면 새 터미널)
}

export default function PackView({ connId, online, jetson, pack, plugin, trigger, onTriggerDone, onLaunch, onTerminal }: Props) {
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [params, setParams] = useState<Record<string, Record<string, string>>>({}) // 항목 id → 고른 선택값
  const [ask, setAsk] = useState<Ask | null>(null)
  const shown = plugin.actions.filter((a) => a.when !== 'jetson' || jetson)
  const runnable = shown.filter((a) => a.mode === 'exec' && !a.hidden && !a.fields) // 입력 폼 항목은 값을 넣고 눌러야 실행
  const started = useRef(new Set<string>()) // 자동 실행은 연결·플러그인마다 한 번

  useEffect(() => {
    started.current.clear()
    setCells({})
  }, [connId, pack.id, plugin.id])

  const valuesOf = (a: PackAction) => resolveParams(a, params[a.id])
  const setCell = (id: string, c: Cell) => setCells((m) => ({ ...m, [id]: c }))
  const exec = async (a: PackAction, values: Record<string, string>, token?: string): Promise<PackResult | null> => {
    setCell(a.id, { busy: true })
    try {
      const r = await window.api.packRun(connId, pack.id, plugin.id, a.id, values, 'run', token)
      setCell(a.id, { busy: false, result: r })
      return r
    } catch (e) {
      setCell(a.id, { busy: false, error: errText(e) })
      return null
    }
  }
  const autoRun = (all: boolean) => {
    for (const a of runnable) if (a.auto && a.risk === 'read' && (all || !started.current.has(a.id))) {
      started.current.add(a.id)
      exec(a, valuesOf(a))
    }
  }
  useEffect(() => {
    if (online) autoRun(false)
  }, [online, connId, pack.id, plugin.id])

  // 입력 폼 항목: main이 값을 검사해 채운 명령과 다시 분석한 위험도(+ 확인 토큰)를 줌. 읽기면 바로 실행, 아니면 채운 명령 전문으로 확인창
  const begin = async (a: PackAction, values: Record<string, string>) => {
    try {
      const p = await window.api.packPrepare(pack.id, plugin.id, a.id, values)
      if (!p.needConfirm) {
        exec(a, values, p.token)
        return
      }
      setAsk({ action: { ...a, risk: p.risk, reasons: p.reasons, understated: p.understated }, values, loading: !!a.preview, prepared: { cmd: p.cmd, token: p.token } })
      if (!a.preview) return
      const r = await window.api.packRun(connId, pack.id, plugin.id, a.id, values, 'preview')
      setAsk((s) => (s?.action.id === a.id ? { ...s, preview: r.text, loading: false } : s))
    } catch (e) {
      setAsk((s) => (s?.action.id === a.id ? { ...s, error: errText(e), loading: false } : s))
      setCell(a.id, { busy: false, error: errText(e) })
    }
  }
  const click = async (a: PackAction, given?: Record<string, string>) => {
    if (a.hidden) return
    if (a.fields && a.mode === 'exec') return begin(a, given ?? {}) // 팔레트에서 고르면 기본값으로
    let values: Record<string, string>
    try {
      values = valuesOf(a)
    } catch (e) {
      return setCell(a.id, { busy: false, error: errText(e) })
    }
    if (a.mode === 'terminal') {
      try {
        const t = await window.api.packTerminal(pack.id, plugin.id, a.id, values) // 입력할 글자는 main이 만들어 줌
        if (t.risk === 'read') return onTerminal(t.text, t.enter) // 읽기로 증명된 것만 확인 없이
        setAsk({ action: { ...a, risk: t.risk, reasons: t.reasons, understated: t.understated }, values, loading: false, term: { text: t.text, enter: t.enter } })
      } catch (e) {
        setCell(a.id, { busy: false, error: errText(e) })
      }
      return
    }
    if (a.risk === 'read') {
      exec(a, values)
      return
    }
    setAsk({ action: a, values, loading: !!a.preview })
    if (!a.preview) return
    try {
      const r = await window.api.packRun(connId, pack.id, plugin.id, a.id, values, 'preview')
      setAsk((s) => (s?.action.id === a.id ? { ...s, preview: r.text, loading: false } : s))
    } catch (e) {
      setAsk((s) => (s?.action.id === a.id ? { ...s, error: errText(e), loading: false } : s))
    }
  }
  useEffect(() => {
    if (!trigger || !online) return
    const a = shown.find((x) => x.id === trigger.actionId)
    onTriggerDone?.()
    if (a) click(a)
  }, [trigger?.n, online])

  const confirmAsk = async () => {
    if (!ask) return
    const { action: a, values, term } = ask
    setAsk(null)
    if (term) return onTerminal(term.text, term.enter)
    const r = await exec(a, values, ask.prepared?.token)
    if (r?.needPassword && r.termCmd) onLaunch(r.termCmd, tr('sudo 비밀번호를 물어볼 수 있어요. 터미널에서 직접 입력해 주세요.'))
    else if (r?.ok) autoRun(true) // 바뀐 뒤 목록·상태를 다시 읽음
  }

  return (
    <div className="fw" style={{ flexDirection: 'column', flexWrap: 'nowrap' }}>
      <PanelHead title={lt(plugin.title)} desc={plugin.desc ? <Desc>{lt(plugin.desc)}</Desc> : undefined} />
      {!online && <Note>{tr('연결되면 사용할 수 있어요.')}</Note>}
      {online &&
        shown.map((a) => {
          const c = cells[a.id]
          const term = a.mode === 'terminal'
          if (a.fields && a.mode === 'exec' && !a.hidden) return <FormCard key={a.id} connId={connId} packId={pack.id} pluginId={plugin.id} a={a} c={c} online={online} onRun={(values) => begin(a, values)} />
          return (
            <section key={a.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={lt(a.label)}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <h2 style={{ marginRight: 'auto' }}>{lt(a.label)}</h2>
                {!a.hidden && a.params?.map((p) => (
                  <label key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
                    {lt(p.label)}
                    <select className="input" style={{ height: 36 }} value={params[a.id]?.[p.name] ?? p.choices[0].value} onChange={(e) => setParams((m) => ({ ...m, [a.id]: { ...m[a.id], [p.name]: e.target.value } }))}>
                      {p.choices.map((ch) => (
                        <option key={ch.value} value={ch.value}>{lt(ch.label)}</option>
                      ))}
                    </select>
                  </label>
                ))}
                {a.hidden ? (
                  <span className="tag">{tr('새 버전 앱이 필요해요')}</span>
                ) : (
                  <Button size={36} variant={a.risk === 'danger' ? 'warn' : 'secondary'} disabled={c?.busy} onClick={() => click(a)}>
                    {c?.busy ? tr('실행 중…') : term ? tr('터미널에 입력') : a.risk === 'read' ? (a.auto ? tr('다시 읽기') : tr('보기')) : tr('실행…')}
                  </Button>
                )}
              </div>
              {a.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(a.desc)}</p>}
              {!a.hidden && !term && <Result a={a} c={c} />}
              {term && c?.error && <p className="msg-err" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{c.error}</p>}
            </section>
          )
        })}
      {online && !shown.length && <Note>{tr('표시할 항목이 없어요.')}</Note>}
      {ask && <AskDialog ask={ask} onCancel={() => setAsk(null)} onOk={confirmAsk} />}
    </div>
  )
}

// 팩/플러그인 고르기 (외부 팩용 "플러그인" 화면): 위 줄 팩, 아래 줄 그 팩의 플러그인
export function PluginHub({ packs, sel, onSel, children }: { packs: Pack[]; sel: { packId: string; pluginId: string }; onSel: (packId: string, pluginId: string) => void; children: (pack: Pack, plugin: PackPlugin) => ReactNode }) {
  const pack = packs.find((p) => p.id === sel.packId) ?? packs[0]
  const plugins = pack?.plugins.filter((p) => !p.group) ?? []
  const plugin = plugins.find((p) => p.id === sel.pluginId) ?? plugins[0]
  if (!pack || !plugin) return <Note>{tr('켜진 플러그인이 없어요. 환경 설정 → 플러그인 관리에서 켤 수 있어요.')}</Note>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 24px 0', alignItems: 'center' }}>
        {packs.length > 1 && <Segment label={tr('팩')} value={pack.id} onChange={(id) => onSel(id, '')} options={packs.map((p) => ({ value: p.id, label: lt(p.name) }))} />}
        {plugins.length > 1 && <Segment label={tr('플러그인')} value={plugin.id} onChange={(id) => onSel(pack.id, id)} options={plugins.map((p) => ({ value: p.id, label: lt(p.title) }))} />}
        {packs.length === 1 && <span className="dim" style={{ fontSize: 13 }}>{lt(pack.name)}</span>}
      </div>
      {children(pack, plugin)}
    </div>
  )
}

// 결과: 표 또는 글자
function Result({ a, c }: { a: PackAction; c?: Cell }) {
  if (!c) return null
  if (c.error) return <p className="msg-err" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{c.error}</p>
  const r = c.result
  if (!r) return null
  if (r.needPassword) return <p className="dim mono" role="status" style={{ fontSize: 12 }}>{tr('sudo 비밀번호가 필요해요. 새 터미널에서 직접 입력해 주세요.')}</p>
  if (a.display?.type === 'table' && r.ok) {
    const d = a.display
    if (!r.rows?.length) return <p className="dim" role="status" style={{ fontSize: 13 }}>{d.empty ? lt(d.empty) : tr('결과가 없어요.')}</p>
    return (
      <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
        <table className="pk-table">
          <thead>
            <tr>{d.columns.map((col, i) => <th key={i}>{lt(col)}</th>)}</tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j} className="mono">{j === 0 && d.labels?.[cell] ? lt(d.labels[cell]) : cell}</td>)}</tr>
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

// 입력 폼이 있는 실행 항목: 칸 + 실행 버튼 + 결과. 틀린 칸이 있으면 버튼 비활성
function FormCard({ connId, packId, pluginId, a, c, online, onRun }: { connId: string; packId: string; pluginId: string; a: PackAction; c?: Cell; online: boolean; onRun: (values: Record<string, string>) => void }) {
  const [values, setValue] = useFormValues(packId, pluginId, a)
  const bad = Object.keys(formErrors(a.fields, values)).length > 0
  return (
    <section className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={lt(a.label)}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <h2 style={{ marginRight: 'auto' }}>{lt(a.label)}</h2>
        <FieldInputs connId={connId} online={online} packId={packId} pluginId={pluginId} action={a} values={values} onChange={setValue} disabled={c?.busy} />
        <Button size={36} variant={a.risk === 'danger' ? 'warn' : 'secondary'} disabled={c?.busy || bad} onClick={() => onRun(values)}>
          {c?.busy ? tr('실행 중…') : a.risk === 'read' ? tr('보기') : tr('실행…')}
        </Button>
      </div>
      {a.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(a.desc)}</p>}
      <Result a={a} c={c} />
    </section>
  )
}
