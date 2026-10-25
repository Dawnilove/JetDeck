import { useEffect, useState } from 'react'
import { bagPlayCommand, bagRecordCommand, isBagName, type Bag, type Param, type Service } from '../../../main/rosparse.mts'
import Button from '../components/Button'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// ROS2 2.4.0: 서비스 호출 / 파라미터 읽기·설정 / bag 재생·녹화 (오른쪽 자세히 창)
type Launcher = (cmd: string, warn?: string) => void // 새 터미널 탭에서 실행

export function ServiceDetail({ connId, svc }: { connId: string; svc: Service }) {
  const [text, setText] = useState(tr('불러오는 중…'))
  const [yaml, setYaml] = useState('{}')
  const [result, setResult] = useState('')
  const [calling, setCalling] = useState(false)
  useEffect(() => {
    window.api.rosIface(connId, svc.type).then(
      (r) => (setText(r.text), setYaml(r.template)),
      (e) => setText(errText(e))
    )
  }, [connId, svc.type])
  const call = async () => {
    // 서비스가 장치를 움직이거나 설정을 바꿀 수 있어 한 번 확인
    if (!confirm(tr('서비스를 호출할까요? 장치가 움직이거나 설정이 바뀔 수 있어요.\n\n{0}\n{1}', svc.name, yaml))) return
    setCalling(true)
    setResult(tr('호출 중… (최대 15초)'))
    try {
      setResult((await window.api.rosCall(connId, svc.name, svc.type, yaml)) || tr('(응답 없음)'))
    } catch (e) {
      setResult(errText(e))
    } finally {
      setCalling(false)
    }
  }
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 className="mono" style={{ wordBreak: 'break-all' }}>{svc.name}</h2>
        <span className="dim mono" style={{ fontSize: 12 }}>{svc.type}</span>
      </div>
      <pre className="hk-code ros-out" style={{ minHeight: 0, maxHeight: 160 }}>{text}</pre>
      <label className="field">
        {tr('요청 (YAML)')}
        <textarea className="input mono" rows={3} style={{ height: 'auto', padding: 10, resize: 'vertical' }} value={yaml} onChange={(e) => setYaml(e.target.value)} spellCheck={false} />
      </label>
      <div>
        <Button size={36} variant="primary" disabled={calling} onClick={call}>{calling ? tr('호출 중…') : tr('호출')}</Button>
      </div>
      {result && <pre className="hk-code ros-out">{result}</pre>}
    </>
  )
}

export function ParamDetail({ connId, node }: { connId: string; node: string }) {
  const [list, setList] = useState<Param[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    window.api.rosParams(connId, node).then(setList, (e) => setErr(errText(e)))
  }, [connId, node])
  const set = async (p: Param) => {
    const v = draft[p.name]
    if (!confirm(tr("'{0}'을(를) {1}(으)로 바꿀까요?\n\n실행 중인 {2}의 동작이 바뀔 수 있어요. 노드를 다시 켜면 원래 값으로 돌아가요.", p.name, v, node))) return
    try {
      const r = await window.api.rosParamSet(connId, node, p.name, v)
      setMsg(r)
      if (/success/i.test(r)) {
        setList((l) => l && l.map((x) => (x.name === p.name ? { ...x, value: v } : x)))
        setDraft(({ [p.name]: _, ...rest }) => rest)
      }
    } catch (e) {
      setMsg(errText(e))
    }
  }
  return (
    <>
      <h2 className="mono" style={{ wordBreak: 'break-all' }}>{node}</h2>
      {err && <p className="msg-err" style={{ fontSize: 13 }}>{err}</p>}
      {!list && !err && <p className="dim" style={{ fontSize: 13 }}>{tr('파라미터를 읽는 중… 몇 초 걸려요.')}</p>}
      {list && !list.length && <p className="dim" style={{ fontSize: 13 }}>{tr('파라미터가 없어요.')}</p>}
      <div className="ros-params">
        {list?.map((p) => {
          const cur = draft[p.name] ?? p.value
          return (
            <div key={p.name} className="ros-param">
              <span className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{p.name}</span>
              <input className="input mono" style={{ height: 36, fontSize: 12 }} aria-label={tr('{0} 값', p.name)} value={cur} onChange={(e) => setDraft((d) => ({ ...d, [p.name]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && cur !== p.value && set(p)} />
              <Button size={36} disabled={cur === p.value} onClick={() => set(p)}>{tr('설정')}</Button>
            </div>
          )
        })}
      </div>
      {msg && <p className="dim mono" role="status" style={{ fontSize: 12 }}>{msg}</p>}
    </>
  )
}

const stamp = () => new Date().toLocaleString('sv-SE').replace(/[- :]/g, '').replace(/^(\d{8})(\d{6})$/, '$1_$2')

export function BagDetail({ connId, bag, topics, onLaunch }: { connId: string; bag: Bag | null; topics: string[]; onLaunch: Launcher }) {
  const [info, setInfo] = useState('')
  const [loop, setLoop] = useState(false)
  const [rate, setRate] = useState(1)
  const [name, setName] = useState(() => `bag_${stamp()}`)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!bag) return setInfo('')
    setInfo(tr('불러오는 중…'))
    window.api.rosBagInfo(connId, bag.path).then(setInfo, (e) => setInfo(errText(e)))
  }, [connId, bag?.path])
  // 녹화를 시작하면 다음 녹화용 이름을 새로 만듦 (같은 이름이면 ros2가 '이미 있음'으로 실패)
  const record = () => {
    onLaunch(bagRecordCommand(name, [...picked]), tr('홈 폴더에 bag 파일이 만들어져요.'))
    setName(`bag_${stamp()}`)
  }
  const toggle = (t: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (!n.delete(t)) n.add(t)
      return n
    })
  return (
    <>
      {bag && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="mono" style={{ wordBreak: 'break-all' }}>{bag.name}</h2>
            <span className="dim mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{bag.path.replace(/^\/home\/[^/]+/, '~')}</span>
          </div>
          <pre className="hk-code ros-out" style={{ minHeight: 0, maxHeight: 220 }}>{info}</pre>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <Button size={36} variant="primary" onClick={() => onLaunch(bagPlayCommand(bag.path, loop, rate), tr('재생하면 bag에 담긴 메시지가 다시 발행돼서 로봇이 움직일 수 있어요.'))}>{tr('재생 (새 터미널)')}</Button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> {tr('반복')}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              {tr('속도')}
              <select className="input" style={{ height: 36, width: 80 }} value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {[0.5, 1, 2].map((r) => <option key={r} value={r}>{tr('{0}배', r)}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
      <h2 style={{ marginTop: bag ? 8 : 0 }}>{tr('새로 녹화')}</h2>
      <label className="field">
        {tr('bag 이름 (홈 폴더에 저장)')}
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <div className="dim" style={{ fontSize: 12 }}>{tr('녹화할 토픽 — 고르지 않으면 모든 토픽')}</div>
      <div className="ros-topics" role="group" aria-label={tr('녹화할 토픽')}>
        {topics.map((t) => (
          <label key={t} className="mono" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={picked.has(t)} onChange={() => toggle(t)} /> {t}
          </label>
        ))}
        {!topics.length && <span className="dim" style={{ fontSize: 12 }}>{tr('실행 중인 토픽이 없어요')}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Button size={36} disabled={!isBagName(name)} onClick={record}>{tr('녹화 시작 (새 터미널)')}</Button>
        {!isBagName(name) && <span className="msg-err" style={{ fontSize: 12 }}>{tr('이름은 영문·숫자·_·- 만 쓸 수 있어요')}</span>}
      </div>
    </>
  )
}
