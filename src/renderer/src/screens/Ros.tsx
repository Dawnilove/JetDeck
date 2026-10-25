import { useEffect, useRef, useState } from 'react'
import { isParamService, launchCommand, type Bag, type Launch, type RosList, type Service } from '../../../main/rosparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'
import { BagDetail, ParamDetail, ServiceDetail } from './RosExtra'

// ROS2 도구: 토픽(목록·info·echo·hz) / 노드(목록·info) / 서비스(호출) / 파라미터(읽기·설정) / bag(재생·녹화) / launch 파일 찾아 실행
type Props = {
  connId: string
  online: boolean
  onLaunch: (cmd: string, warn?: string) => void // 새 터미널 탭에서 실행 (warn: 실행 전 확인 창에 보여 줄 주의 문구)
}
type Tab = 'topic' | 'node' | 'service' | 'param' | 'bag' | 'launch'
type Stream = { id: string; kind: 'echo' | 'hz'; topic: string; text: string; running: boolean }

const MAX_TEXT = 60_000 // 화면에 남길 출력 글자 수 (오래된 것부터 버림)

export default function Ros({ connId, online, onLaunch }: Props) {
  const [tab, setTab] = useState<Tab>('topic')
  const [data, setData] = useState<RosList | null>(null)
  const [launches, setLaunches] = useState<Launch[] | null>(null)
  const [services, setServices] = useState<Service[] | null>(null)
  const [bags, setBags] = useState<Bag[] | null>(null)
  const [showParamSvc, setShowParamSvc] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [info, setInfo] = useState('')
  const [stream, setStream] = useState<Stream | null>(null)
  const streamRef = useRef(stream)
  streamRef.current = stream
  const outRef = useRef<HTMLPreElement>(null)

  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      if (tab === 'launch') setLaunches(await window.api.rosLaunches(connId))
      else if (tab === 'service') setServices(await window.api.rosServices(connId))
      else if (tab === 'bag') {
        // 녹화할 토픽 목록도 필요
        const [b, d] = await Promise.all([window.api.rosBags(connId), window.api.rosList(connId)])
        setBags(b)
        setData(d)
      } else setData(await window.api.rosList(connId))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  // 처음 열 때·탭을 바꿀 때 한 번 읽음 (ros2 명령은 몇 초 걸려서 자동 반복은 안 함)
  useEffect(() => {
    if (online && !(tab === 'launch' ? launches : tab === 'service' ? services : tab === 'bag' ? bags && data : data)) refresh()
  }, [online, tab])

  const stop = () => {
    const s = streamRef.current
    if (s?.running) window.api.rosStop(s.id)
  }
  useEffect(() => stop, []) // 화면을 닫으면 젯슨 쪽 echo·hz도 끝냄
  useEffect(() => {
    if (!online) setStream((s) => s && { ...s, running: false })
  }, [online])
  useEffect(() => {
    const offs = [
      window.api.onRosData((id, text) => setStream((s) => (s && s.id === id ? { ...s, text: (s.text + text).slice(-MAX_TEXT) } : s))),
      window.api.onRosEnd((id) => setStream((s) => (s && s.id === id ? { ...s, running: false } : s)))
    ]
    return () => offs.forEach((off) => off())
  }, [])
  // 새 출력이 오면 맨 아래로
  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream?.text])

  const pick = async (name: string) => {
    stop()
    setStream(null)
    setPicked(name)
    setInfo(tr('불러오는 중…'))
    try {
      setInfo(await window.api.rosInfo(connId, tab === 'node' ? 'node' : 'topic', name))
    } catch (e) {
      setInfo(errText(e))
    }
  }
  const start = async (kind: 'echo' | 'hz') => {
    if (!picked) return
    stop()
    const id = crypto.randomUUID()
    setStream({ id, kind, topic: picked, text: '', running: true })
    try {
      await window.api.rosStream(connId, id, kind, picked)
    } catch (e) {
      setStream({ id, kind, topic: picked, text: errText(e), running: false })
    }
  }

  const f = filter.trim().toLowerCase()
  const topics = (data?.topics ?? []).filter((t) => (t.name + t.type).toLowerCase().includes(f))
  const nodes = (data?.nodes ?? []).filter((n) => n.toLowerCase().includes(f))
  const svcs = (services ?? []).filter((s) => (showParamSvc || !isParamService(s.name)) && (s.name + s.type).toLowerCase().includes(f))
  const bagList = (bags ?? []).filter((b) => b.path.toLowerCase().includes(f))
  const ls = (launches ?? []).filter((l) => (l.path + (l.pkg ?? '')).toLowerCase().includes(f))
  const rate = stream?.kind === 'hz' ? [...stream.text.matchAll(/average rate: ([\d.]+)/g)].at(-1)?.[1] : undefined
  const topicType = data?.topics.find((t) => t.name === picked)?.type
  const svcPicked = services?.find((s) => s.name === picked)
  const bagPicked = bags?.find((b) => b.path === picked) ?? null

  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('ROS2 목록')}>
        <PanelHead title={<>ROS2{data?.distro && <span className="dim" style={{ fontWeight: 400 }}> · {data.distro}</span>}</>} desc={<Desc>{tr('Device의 ros2 명령으로 읽어요. Device에 따로 설치할 것은 없어요.')}</Desc>}>
          <Button size={36} onClick={refresh} disabled={!online || busy}>{busy ? tr('읽는 중…') : tr('새로고침')}</Button>
        </PanelHead>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <Segment
            label={tr('ROS2 보기')}
            value={tab}
            onChange={(v) => {
              stop()
              setStream(null)
              setPicked(null)
              setInfo('')
              setTab(v)
            }}
            options={[
              { value: 'topic', label: `${tr('토픽')}${data ? ` ${data.topics.length}` : ''}` },
              { value: 'node', label: `${tr('노드')}${data ? ` ${data.nodes.length}` : ''}` },
              { value: 'service', label: tr('서비스') },
              { value: 'param', label: tr('파라미터') },
              { value: 'bag', label: 'bag' },
              { value: 'launch', label: 'launch' }
            ]}
          />
          <input className="input" style={{ flex: '1 1 160px', height: 40 }} placeholder={tr('이름으로 찾기')} aria-label={tr('이름으로 찾기')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div
          className="ros-items"
          role="listbox"
          aria-label={{ topic: tr('토픽'), node: tr('노드'), service: tr('서비스'), param: tr('파라미터를 볼 노드'), bag: 'bag', launch: tr('launch 파일') }[tab]}
          // ↑↓로 항목(launch는 실행 버튼) 사이 이동
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
            const i = items.indexOf(document.activeElement as HTMLButtonElement)
            if (i < 0) return
            e.preventDefault()
            items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus()
          }}
        >
          {!online && <Note>{tr('연결되면 ROS2 정보를 읽어요.')}</Note>}
          {online && busy && <Note>{tr('읽는 중… ros2 명령은 몇 초 걸려요.')}</Note>}
          {/* ros2가 없거나 환경을 안 불러온 젯슨이면 main이 할 일까지 적은 문구를 보냄 (원문 비교 없이 그대로) */}
          {online && error && <Note err>{error}</Note>}
          {/* 연결이 끊기면 예전 목록은 숨김 (지금 상태처럼 보이지 않게) */}
          {online && tab === 'topic' &&
            topics.map((t) => (
              <button key={t.name} type="button" role="option" aria-selected={picked === t.name} className="ros-item" onClick={() => pick(t.name)}>
                <span className="mono">{t.name}</span>
                <span className="dim mono ros-type">{t.type}</span>
              </button>
            ))}
          {online && tab === 'service' && (
            <label className="dim" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 20px', fontSize: 12 }}>
              <input type="checkbox" checked={showParamSvc} onChange={(e) => setShowParamSvc(e.target.checked)} /> {tr('노드별 파라미터 서비스도 보기')}
            </label>
          )}
          {online && tab === 'service' &&
            svcs.map((sv) => (
              <button key={sv.name} type="button" role="option" aria-selected={picked === sv.name} className="ros-item" onClick={() => setPicked(sv.name)}>
                <span className="mono">{sv.name}</span>
                <span className="dim mono ros-type">{sv.type}</span>
              </button>
            ))}
          {online && tab === 'bag' &&
            bagList.map((b) => (
              <button key={b.path} type="button" role="option" aria-selected={picked === b.path} className="ros-item" onClick={() => setPicked(b.path)}>
                <span className="mono">{b.name}</span>
                <span className="dim mono ros-type">{b.path.replace(/^\/home\/[^/]+/, '~')}</span>
              </button>
            ))}
          {online && (tab === 'node' || tab === 'param') &&
            nodes.map((n) => (
              <button key={n} type="button" role="option" aria-selected={picked === n} className="ros-item" onClick={() => (tab === 'param' ? setPicked(n) : pick(n))}>
                <span className="mono">{n}</span>
              </button>
            ))}
          {online && tab === 'launch' &&
            ls.map((l, i) => (
              <div key={l.path} className="ros-item ros-launch">
                {(i === 0 || (ls[i - 1].pkg === null) !== (l.pkg === null)) && <span className="caption ros-group">{l.pkg ? tr('설치된 패키지') : tr('내 워크스페이스')}</span>}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <span className="mono">{l.file}</span>
                  <span className="dim mono ros-type">{l.pkg ?? l.path.replace(/^\/home\/[^/]+/, '~')}</span>
                </span>
                <Button size={36} disabled={!online} onClick={() => onLaunch(launchCommand(l))}>{tr('실행')}</Button>
              </div>
            ))}
          {online && !busy && !error && ((tab === 'topic' && data && !topics.length) || ((tab === 'node' || tab === 'param') && data && !nodes.length) || (tab === 'launch' && launches && !ls.length) || (tab === 'service' && services && !svcs.length) || (tab === 'bag' && bags && !bagList.length)) && (
            <Note>{f ? tr('찾는 이름이 없어요.') : tab === 'launch' ? tr('launch 파일이 없어요.') : tab === 'bag' ? tr('홈 폴더 아래에서 bag을 찾지 못했어요. 오른쪽에서 새로 녹화할 수 있어요.') : tr('실행 중인 것이 없어요. 노드를 실행한 뒤 새로고침하세요.')}</Note>
          )}
        </div>
      </section>

      <section className="card card-sm fw-add ros-detail" aria-label={tr('자세히')}>
        {tab === 'launch' ? (
          <>
            <h2>{tr('launch 실행')}</h2>
            <p className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
              {tr('실행을 누르면 새 터미널 탭에서 ros2 launch가 시작돼요. 멈출 때는 그 터미널에서 Ctrl+C.')}
              <br />{tr('내 워크스페이스는 홈 폴더 아래 소스(src/…/launch)에서, 설치된 패키지는 ROS 환경에서 찾아요.')}
            </p>
          </>
        ) : tab === 'bag' ? (
          <BagDetail connId={connId} bag={bagPicked} topics={data?.topics.map((t) => t.name) ?? []} onLaunch={onLaunch} />
        ) : !picked ? (
          <>
            <h2>{{ topic: tr('토픽'), node: tr('노드'), service: tr('서비스'), param: tr('파라미터') }[tab]}</h2>
            <p className="dim" style={{ fontSize: 13 }}>
              {{ topic: tr('왼쪽에서 토픽을 고르면 발행·구독 정보와 메시지, 주기(Hz)를 볼 수 있어요.'), node: tr('왼쪽에서 노드를 고르면 토픽·서비스 연결을 볼 수 있어요.'), service: tr('왼쪽에서 서비스를 고르면 요청 형식을 보고 호출할 수 있어요.'), param: tr('왼쪽에서 노드를 고르면 파라미터 값을 읽고 바꿀 수 있어요.') }[tab]}
            </p>
          </>
        ) : tab === 'service' && svcPicked ? (
          <ServiceDetail key={svcPicked.name} connId={connId} svc={svcPicked} />
        ) : tab === 'param' ? (
          <ParamDetail key={picked} connId={connId} node={picked} />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="mono" style={{ wordBreak: 'break-all' }}>{picked}</h2>
              {topicType && <span className="dim mono" style={{ fontSize: 12 }}>{topicType}</span>}
            </div>
            {tab === 'topic' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Button size={36} variant={stream?.kind === 'echo' && stream.running ? 'primary' : undefined} disabled={!online} onClick={() => start('echo')}>{tr('메시지 보기 (echo)')}</Button>
                <Button size={36} variant={stream?.kind === 'hz' && stream.running ? 'primary' : undefined} disabled={!online} onClick={() => start('hz')}>{tr('주기 측정 (hz)')}</Button>
                {stream?.running && <Button size={36} variant="warn" onClick={stop}>{tr('멈춤')}</Button>}
              </div>
            )}
            {stream && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
                {stream.kind === 'hz' && (
                  <div className="ros-rate" role="status">
                    <span className="mono">{rate ?? '—'}</span> Hz
                    <span className="dim" style={{ fontSize: 12 }}>{stream.running ? (rate ? tr(' 평균') : tr(' 메시지를 기다리는 중…')) : tr(' 멈춤')}</span>
                  </div>
                )}
                <pre ref={outRef} className="hk-code ros-out" aria-live="off">{stream.text || (stream.running ? tr('메시지를 기다리는 중…') : '')}</pre>
              </div>
            )}
            {!stream && <pre className="hk-code ros-out">{info}</pre>}
          </>
        )}
      </section>
    </div>
  )
}
