import { useEffect, useRef, useState } from 'react'
import type { CamList } from '../../../main/camparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 카메라 미리보기: Device의 gst-launch로 JPEG 프레임을 SSH로 받아 표시. 화면을 떠나면 자동 정지 (젯슨 쪽 gst도 종료)
type Props = { connId: string; online: boolean }

export default function Camera({ connId, online }: Props) {
  const [list, setList] = useState<CamList | null>(null)
  const [error, setError] = useState('')
  const [ci, setCi] = useState(0) // 고른 카메라
  const [mi, setMi] = useState(0) // 고른 해상도
  const [fps, setFps] = useState(15)
  const [running, setRunning] = useState(false)
  const [count, setCount] = useState(0) // 받은 프레임 수 (화면이 살아 있는지 표시용)
  const img = useRef<HTMLImageElement>(null)
  const sid = useRef('')
  const url = useRef('') // 지금 보이는 프레임 (새 프레임이 오면 이전 것은 바로 해제 — 쌓이면 메모리가 계속 늘어남)

  const load = () => {
    setError('')
    window.api.camList(connId).then(
      (l) => {
        setList(l)
        const m = l.cameras[0]?.modes.findIndex((x) => x.w === 640 && x.h === 480) ?? 0
        setCi(0)
        setMi(Math.max(0, m))
      },
      (e) => setError(errText(e))
    )
  }
  useEffect(() => {
    if (online) load()
  }, [online])

  const stop = () => {
    if (sid.current) window.api.camStop(sid.current)
    sid.current = ''
    setRunning(false)
  }
  useEffect(() => stop, []) // 화면을 닫으면 정지

  useEffect(() => {
    const offF = window.api.onCamFrame((id, d) => {
      if (id !== sid.current || !img.current) return
      const u = URL.createObjectURL(new Blob([d.slice()], { type: 'image/jpeg' }))
      const old = url.current
      url.current = u
      img.current.src = u
      if (old) URL.revokeObjectURL(old)
      setCount((n) => n + 1)
    })
    const offE = window.api.onCamEnd((id, err) => {
      if (id !== sid.current) return
      sid.current = ''
      setRunning(false)
      if (err) setError(err)
    })
    return () => {
      offF()
      offE()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [])

  const cam = list?.cameras[ci]
  const mode = cam?.modes[mi]
  const fpsList = mode?.fps ?? []
  const start = async () => {
    if (!cam || !mode) return
    setError('')
    setCount(0)
    const id = `cam-${Date.now()}`
    sid.current = id
    setRunning(true)
    try {
      await window.api.camStart(connId, id, cam.path, cam.fourcc, mode.w, mode.h, fpsList.includes(fps) ? fps : fpsList[0])
    } catch (e) {
      sid.current = ''
      setRunning(false)
      setError(errText(e))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelHead title={tr('영상 입력 미리보기')} desc={<Desc>{tr('Device에 연결된 카메라(USB 등) 영상을 SSH로 미리 봐요. Device에 따로 설치하는 것은 없어요.')}</Desc>}>
        <Button size={36} onClick={load} disabled={!online || running}>{tr('목록 새로고침')}</Button>
      </PanelHead>
      {!online && <Note>{tr('연결되면 카메라를 찾아요.')}</Note>}
      {online && !list && !error && <Note>{tr('카메라를 찾는 중…')}</Note>}
      {online && list && !list.cameras.length && (
        <div className="callout" style={{ margin: 20, flexDirection: 'column', gap: 6 }}>
          <b>{tr('카메라를 찾지 못했어요')}</b>
          <span>
            {list.nov4l2
              ? tr('Device에 v4l2-ctl이 없어요. Device에 직접 설치하세요 (sudo apt install v4l-utils).')
              : list.nogst
                ? tr('Device에 gst-launch-1.0(GStreamer)이 없어요. JetPack 이미지에는 보통 들어 있어요.')
                : tr('USB 카메라를 Device에 연결한 뒤 "목록 새로고침"을 누르세요. (CSI 카메라는 아직 지원하지 않아요)')}
          </span>
        </div>
      )}
      {online && cam && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <select className="input" style={{ height: 40, width: 'auto', flex: '1 1 160px' }} aria-label={tr('카메라')} value={ci} disabled={running} onChange={(e) => (setCi(Number(e.target.value)), setMi(0))}>
            {list!.cameras.map((c, i) => <option key={c.path} value={i}>{c.name} ({c.path})</option>)}
          </select>
          <select className="input" style={{ height: 40, width: 'auto', flex: '1 1 160px' }} aria-label={tr('해상도')} value={mi} disabled={running} onChange={(e) => setMi(Number(e.target.value))}>
            {cam.modes.map((m, i) => <option key={`${m.w}x${m.h}`} value={i}>{m.w}×{m.h}</option>)}
          </select>
          <select className="input" style={{ height: 40, width: 'auto', flex: '1 1 160px' }} aria-label={tr('초당 프레임')} value={fpsList.includes(fps) ? fps : fpsList[0]} disabled={running} onChange={(e) => setFps(Number(e.target.value))}>
            {fpsList.map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
          {running ? <Button size={40} variant="warn" onClick={stop}>{tr('정지')}</Button> : <Button size={40} variant="primary" onClick={start}>{tr('시작')}</Button>}
          {running && <span className="dim mono" style={{ fontSize: 12 }}>{count ? tr('프레임 {0}', count) : tr('연결하는 중…')}</span>}
        </div>
      )}
      {error && <Note err>{error}</Note>}
      <div style={{ flex: 1, minHeight: 0, background: '#000', display: running || count ? 'block' : 'none', position: 'relative' }}>
        <img ref={img} alt={tr('영상 입력 미리보기')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    </div>
  )
}
