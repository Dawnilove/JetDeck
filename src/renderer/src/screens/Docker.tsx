import { useEffect, useState } from 'react'
import { followCommand, type Container, type DockerAction, type DockerData } from '../../../main/dockerparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import Segment from '../components/Segment'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// Docker 패널: 컨테이너·이미지 목록, 시작·정지·재시작·삭제, 로그. Device에는 설치하는 것이 없고 docker CLI만 SSH로 실행
type Props = {
  connId: string
  online: boolean
  onLaunch: (cmd: string, warn?: string) => void // 새 터미널 탭에서 실행 (실시간 로그)
}
type Tab = 'container' | 'image'

// docker가 없거나 쓸 수 없을 때: 설치는 하지 않고 할 일만 알려 줌 (명령은 Device 터미널에서 사용자가 직접)
const GUIDE: Record<'missing' | 'noperm' | 'down', { title: string; text: string; cmd?: string }> = {
  missing: { title: tr('Device에 Docker가 없어요'), text: tr('JetDeck은 Device에 아무것도 설치하지 않아요. Docker가 필요하면 Device에 직접 설치하세요 (JetPack 이미지에는 보통 들어 있어요). 설치 방법: https://docs.docker.com/engine/install/ubuntu/') },
  noperm: { title: tr('Docker를 쓸 권한이 없어요'), text: tr('이 계정이 docker 그룹에 없어요. Device 터미널에서 아래 명령을 실행한 뒤, 이 기기와 다시 연결하세요 (연결 해제 → 다시 접속).'), cmd: 'sudo usermod -aG docker $USER' },
  down: { title: tr('Docker가 꺼져 있어요'), text: tr('Docker 서비스가 실행 중이 아니에요. Device 터미널에서 아래 명령으로 켜세요.'), cmd: 'sudo systemctl start docker' }
}
const DOT = (state: string) => (state === 'running' ? 'dot' : state === 'paused' || state === 'restarting' ? 'dot connecting' : 'dot offline')
// 확인 문구: 컨테이너 이름은 문장 안의 자리({0})에 넣음 (영어 어순도 자연스럽게)
const ASK: Record<DockerAction, ((name: string) => string) | null> = {
  start: null,
  stop: (n) => tr("'{0}' 컨테이너를 정지할까요? 안에서 실행 중인 작업(학습·서버 등)이 멈춰요.", n),
  restart: (n) => tr("'{0}' 컨테이너를 다시 시작할까요? 안에서 실행 중인 작업이 중단돼요.", n),
  rm: (n) => tr("'{0}' 컨테이너를 삭제할까요? 컨테이너 안에만 있던 파일은 되돌릴 수 없어요.", n)
}

export default function Docker({ connId, online, onLaunch }: Props) {
  const [tab, setTab] = useState<Tab>('container')
  const [data, setData] = useState<DockerData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      setData(await window.api.dockerList(connId))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  // 연결될 때마다 새로 읽음 (다시 연결한 뒤 옛 목록이 남지 않게)
  useEffect(() => {
    if (online) refresh()
  }, [online])

  const readLogs = async (ref: string) => {
    setLogs(tr('불러오는 중…'))
    try {
      setLogs((await window.api.dockerLogs(connId, ref)) || tr('(로그 없음)'))
    } catch (e) {
      setLogs(errText(e))
    }
  }
  const pick = (c: Container) => {
    setPicked(c.id)
    setMsg('')
    readLogs(c.id)
  }
  const act = async (c: Container, action: DockerAction) => {
    const ask = ASK[action]
    if (ask && !confirm(ask(c.name))) return
    setMsg(tr('{0}: {1} 중…', c.name, action))
    try {
      setMsg((await window.api.dockerAction(connId, c.id, action)) || tr('완료'))
      if (action === 'rm') setPicked(null)
      await refresh()
      if (action !== 'rm') readLogs(c.id)
    } catch (e) {
      setMsg(errText(e))
    }
  }

  const f = filter.trim().toLowerCase()
  const ok = data?.state === 'ok' ? data : null
  const containers = (ok?.containers ?? []).filter((c) => (c.name + c.image + c.id).toLowerCase().includes(f))
  const images = (ok?.images ?? []).filter((i) => (i.repo + i.tag + i.id).toLowerCase().includes(f))
  const sel = ok?.containers.find((c) => c.id === picked)
  const guide = data && data.state !== 'ok' && data.state !== 'error' ? GUIDE[data.state] : null

  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('Docker 목록')}>
        <PanelHead title="Docker" desc={<Desc>{tr('Device의 docker 명령으로 읽어요. Device에 따로 설치할 것은 없어요.')}</Desc>}>
          <Button size={36} onClick={refresh} disabled={!online || busy}>{busy ? tr('읽는 중…') : tr('새로고침')}</Button>
        </PanelHead>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <Segment
            label={tr('Docker 보기')}
            value={tab}
            onChange={(v) => {
              setTab(v)
              setPicked(null)
            }}
            options={[
              { value: 'container', label: `${tr('컨테이너')}${ok ? ` ${ok.containers.length}` : ''}` },
              { value: 'image', label: `${tr('이미지')}${ok ? ` ${ok.images.length}` : ''}` }
            ]}
          />
          <input className="input" style={{ flex: '1 1 160px', height: 40 }} placeholder={tr('이름으로 찾기')} aria-label={tr('이름으로 찾기')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="ros-items" role="listbox" aria-label={tab === 'container' ? tr('컨테이너') : tr('이미지')}>
          {!online && <Note>{tr('연결되면 Docker 정보를 읽어요.')}</Note>}
          {online && busy && !data && <Note>{tr('읽는 중…')}</Note>}
          {online && error && <Note err>{error}</Note>}
          {online && data?.state === 'error' && <Note err>{data.text}</Note>}
          {online && guide && (
            <div className="callout" style={{ margin: '12px 20px', flexDirection: 'column', gap: 8 }}>
              <b>{guide.title}</b>
              <span>{guide.text}</span>
              {guide.cmd && <div className="hk-code" style={{ userSelect: 'all' }}>{guide.cmd}</div>}
            </div>
          )}
          {online && tab === 'container' &&
            containers.map((c) => (
              <button key={c.id} type="button" role="option" aria-selected={picked === c.id} className="ros-item" onClick={() => pick(c)}>
                <span className={DOT(c.state)} aria-hidden style={{ width: 8, height: 8 }} />
                <span className="mono">{c.name}</span>
                <span className="dim mono ros-type">{c.image} · {c.status}</span>
              </button>
            ))}
          {online && tab === 'image' &&
            images.map((i) => (
              <div key={i.id + i.repo + i.tag} className="ros-item">
                <span className="mono">{i.repo}:{i.tag}</span>
                <span className="dim mono ros-type">{i.size} · {i.created} · {i.id}</span>
              </div>
            ))}
          {online && ok && !busy && ((tab === 'container' && !containers.length) || (tab === 'image' && !images.length)) && (
            <Note>{f ? tr('찾는 이름이 없어요.') : tab === 'container' ? tr('컨테이너가 없어요.') : tr('이미지가 없어요.')}</Note>
          )}
        </div>
      </section>

      <section className="card card-sm fw-add ros-detail" aria-label={tr('자세히')}>
        {sel ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="mono" style={{ wordBreak: 'break-all' }}>{sel.name}</h2>
              <span className="dim mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{sel.image} · {sel.status}{sel.ports && ` · ${sel.ports}`}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sel.state !== 'running' && <Button size={36} variant="primary" disabled={!online} onClick={() => act(sel, 'start')}>{tr('시작')}</Button>}
              {sel.state === 'running' && <Button size={36} disabled={!online} onClick={() => act(sel, 'stop')}>{tr('정지')}</Button>}
              {sel.state === 'running' && <Button size={36} disabled={!online} onClick={() => act(sel, 'restart')}>{tr('재시작')}</Button>}
              <Button size={36} variant="warn" disabled={!online} onClick={() => act(sel, 'rm')}>{tr('삭제')}</Button>
            </div>
            {msg && <p className="dim mono" role="status" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{msg}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <h2 style={{ marginRight: 'auto' }}>{tr('로그 (마지막 200줄)')}</h2>
              <Button size={36} disabled={!online} onClick={() => readLogs(sel.id)}>{tr('다시 읽기')}</Button>
              <Button size={36} disabled={!online} onClick={() => onLaunch(followCommand(sel.id), tr('컨테이너 로그를 계속 보여 줘요.'))}>{tr('실시간 (새 터미널)')}</Button>
            </div>
            <pre className="hk-code ros-out">{logs}</pre>
          </>
        ) : (
          <>
            <h2>{tab === 'container' ? tr('컨테이너') : tr('이미지')}</h2>
            <p className="dim" style={{ fontSize: 13 }}>
              {tab === 'container' ? tr('왼쪽에서 컨테이너를 고르면 시작·정지·재시작·삭제와 로그를 볼 수 있어요.') : tr('이미지 목록이에요. 이미지 삭제·받기는 터미널에서 해 주세요.')}
            </p>
          </>
        )}
      </section>
    </div>
  )
}
