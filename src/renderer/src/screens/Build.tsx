import { useEffect, useMemo, useRef, useState } from 'react'
import { parseLine, rosdepCommand, type BuildKind, type Line } from '../../../main/buildparse.mts'
import { shq } from '../../../main/shq.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 빌드 도구: colcon·catkin_make를 Device에서 실행하고, 출력의 오류 줄을 누르면 그 파일·줄로 이동. Device에 설치하는 것은 없음
type Props = {
  connId: string
  hostId: string
  online: boolean
  visible: boolean // 보일 때 처음 한 번 워크스페이스 후보를 찾음 (숨어 있는 동안은 아무것도 안 함)
  home: string
  onOpen: (path: string, line: number) => void
  onLaunch: (cmd: string, warn?: string) => void // rosdep은 sudo 비밀번호를 물을 수 있어 새 터미널 탭에서
}
const MAX_LINES = 3000

export default function Build({ connId, hostId, online, visible, home, onOpen, onLaunch }: Props) {
  const saveKey = `build-ws:${hostId}`
  const [ws, setWs] = useState(() => {
    try {
      return localStorage.getItem(saveKey) ?? ''
    } catch {
      return ''
    }
  })
  const [cands, setCands] = useState<string[]>([])
  const [pkgs, setPkgs] = useState('')
  const [symlink, setSymlink] = useState(true)
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState(false)
  const [exit, setExit] = useState<number | null>(null)
  const [only, setOnly] = useState(false)
  const [error, setError] = useState('')
  const idRef = useRef('')
  const cwd = useRef('') // 지금 출력이 나오는 빌드의 워크스페이스 (상대 경로를 풀 기준)
  const rest = useRef('') // 아직 줄바꿈이 안 온 마지막 조각
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // 맨 아래를 보고 있으면 새 출력을 따라감
  const dir = ws.trim() || cands[0] || home

  const looked = useRef(false)
  useEffect(() => {
    if (!online) looked.current = false // 다시 연결하면 새로 찾음
    else if (visible && !looked.current) {
      looked.current = true
      window.api.buildWorkspaces(connId).then(setCands, () => setCands([]))
    }
  }, [online, visible, connId])

  const add = (raw: string[]) => {
    const parsed = raw.map((t) => parseLine(t, cwd.current))
    const done = parsed.find((l) => l.exit !== undefined)
    if (done) setExit(done.exit!)
    setLines((ls) => [...ls, ...parsed.filter((l) => l.exit === undefined)].slice(-MAX_LINES))
  }
  useEffect(() => {
    const off1 = window.api.onBuildData((id, text) => {
      if (id !== idRef.current) return
      const parts = (rest.current + text).split('\n')
      rest.current = parts.pop() ?? ''
      add(parts)
    })
    const off2 = window.api.onBuildEnd((id) => {
      if (id !== idRef.current) return
      if (rest.current) add([rest.current])
      rest.current = ''
      setRunning(false)
    })
    // 화면이 사라질 때(연결을 닫음) 돌고 있던 빌드도 멈춤
    return () => {
      off1()
      off2()
      if (idRef.current) window.api.buildStop(idRef.current)
    }
  }, [])
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines])

  const start = async (kind: BuildKind) => {
    setError('')
    setLines([])
    setExit(null)
    rest.current = ''
    stick.current = true
    cwd.current = dir
    const id = crypto.randomUUID()
    idRef.current = id
    setRunning(true)
    try {
      localStorage.setItem(saveKey, ws.trim())
    } catch {
      /* 저장 실패해도 이번 실행 동안은 사용 가능 */
    }
    try {
      await window.api.buildStart(connId, id, kind, dir, symlink, pkgs)
    } catch (e) {
      setRunning(false)
      setError(errText(e))
    }
  }

  const counts = useMemo(() => ({ err: lines.filter((l) => l.sev === 'error').length, warn: lines.filter((l) => l.sev === 'warning').length }), [lines])
  const shown = only ? lines.filter((l) => l.sev !== 'plain') : lines
  const status = running ? tr('빌드 중…') : exit === 0 ? tr('빌드 성공') : exit != null ? tr('빌드 실패 (종료 코드 {0})', exit) : ''

  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('빌드 도구')}>
        <PanelHead title={tr('빌드 도구')} desc={<Desc>{tr('Device에서 colcon·catkin_make를 실행해요. 출력의 오류 줄을 누르면 그 파일로 이동해요.')}</Desc>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <input className="input mono" style={{ flex: '2 1 240px', height: 40 }} list="build-ws" placeholder={cands[0] ?? home} aria-label={tr('워크스페이스 폴더')} value={ws} onChange={(e) => setWs(e.target.value)} />
            <datalist id="build-ws">{cands.map((c) => <option key={c} value={c} />)}</datalist>
            <input className="input mono" style={{ flex: '1 1 160px', height: 40 }} placeholder={tr('패키지 (비우면 전부)')} aria-label={tr('패키지')} value={pkgs} onChange={(e) => setPkgs(e.target.value)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Button size={40} variant="primary" disabled={!online || running} onClick={() => start('colcon')}>colcon build</Button>
            <Button size={40} disabled={!online || running} onClick={() => start('catkin')}>catkin_make</Button>
            <Button size={40} disabled={!online || running} onClick={() => onLaunch(rosdepCommand(shq(dir)), tr('필요한 패키지를 apt로 설치해요. sudo 비밀번호를 물어볼 수 있어요.'))}>{tr('rosdep install (새 터미널)')}</Button>
            {running && <Button size={40} variant="warn" onClick={() => window.api.buildStop(idRef.current)}>{tr('중지')}</Button>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={symlink} onChange={(e) => setSymlink(e.target.checked)} />
              --symlink-install
            </label>
          </div>
        </div>
        <div className="ros-items" style={{ display: 'flex', flexDirection: 'column' }}>
          {!online && <Note>{tr('연결되면 빌드할 수 있어요.')}</Note>}
          {error && <Note err>{error}</Note>}
          {online && (status || lines.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '4px 20px 8px', fontSize: 13 }} role="status">
              <b className={exit != null && exit !== 0 ? 'msg-err' : exit === 0 ? 'msg-ok' : ''}>{status}</b>
              <span className="msg-err">{tr('오류 {0}', counts.err)}</span>
              <span className="git-M">{tr('경고 {0}', counts.warn)}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
                {tr('오류·경고만 보기')}
              </label>
            </div>
          )}
          <div
            ref={box}
            className="build-out mono"
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
          >
            {shown.map((l, i) =>
              l.path ? (
                <button key={i} type="button" className={`build-line link build-${l.sev}`} title={tr('{0}:{1} 열기', l.path, l.line)} onClick={() => onOpen(l.path!, l.line!)}>{l.text}</button>
              ) : (
                <div key={i} className={`build-line build-${l.sev}`}>{l.text}</div>
              )
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
