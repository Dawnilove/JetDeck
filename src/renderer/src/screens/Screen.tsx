import RFB from '@novnc/novnc'
import { useEffect, useRef, useState } from 'react'
import type { Guide } from '../../../main/vncparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 젯슨 화면 뷰어: noVNC가 SSH 연결(IPC 통로)로 Device의 VNC에 접속. Device에는 설치하는 것이 없고, 비밀번호는 저장하지 않음
// 연결 설정에 원격 화면(VNC·RDP)을 정해 두었으면 같은 화면에서 PC의 뷰어(mstsc·VNC 뷰어)로도 열 수 있음 (예전 제목줄 '원격 화면' 버튼을 여기로 합침)
type Props = { connId: string; hostId: string; online: boolean; onLaunch: (cmd: string, warn?: string) => void; onClose?: () => void; remote?: 'rdp' | 'vnc'; onExternal?: () => void }
type State = 'idle' | 'connecting' | 'password' | 'connected' | 'guide' | 'ended'

// noVNC가 WebSocket 대신 받는 통로 (RTCDataChannel과 같은 모양). 보낸 바이트는 main이 SSH 스트림으로 전달
class IpcChannel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState = 1
  onopen: (() => void) | null = null
  private handler: ((e: { data: ArrayBuffer }) => void) | null = null
  private queue: ArrayBuffer[] = [] // 서버는 접속 즉시 첫 인사를 보내므로 noVNC가 붙기 전에 온 바이트를 보관
  get onmessage() {
    return this.handler
  }
  set onmessage(f) {
    this.handler = f
    setTimeout(() => this.queue.splice(0).forEach((b) => this.handler?.({ data: b })), 0) // noVNC가 상태를 정리한 뒤(같은 턴이 끝난 뒤) 전달
  }
  receive(b: ArrayBuffer) {
    if (this.handler && !this.queue.length) this.handler({ data: b })
    else this.queue.push(b)
  }
  onerror: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(private id: string) {}
  send(d: Uint8Array) {
    window.api.vncSend(this.id, d.slice()) // 큰 버퍼의 일부만 보내므로 복사 (구조적 복제가 전체 버퍼를 복사함)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    window.api.vncClose(this.id)
  }
}

export default function Screen({ connId, hostId, online, onLaunch, onClose, remote, onExternal }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [state, setState] = useState<State>('idle')
  const [msg, setMsg] = useState('')
  const [guide, setGuide] = useState<Guide | null>(null)
  const [pw, setPw] = useState('')
  const [tries, setTries] = useState(0) // 올릴 때마다 새로 연결
  const idRef = useRef(0)

  useEffect(() => {
    if (!online || !box.current) return
    const id = `vnc-${Date.now()}-${++idRef.current}`
    const ch = new IpcChannel(id)
    let alive = true
    let shown = false // 화면이 한 번이라도 떴는지
    let rfb: RFB | null = null
    const offData = window.api.onVncData((i, d) => {
      if (i === id) ch.receive(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer)
    })
    const offClose = window.api.onVncClose((i) => {
      if (i === id) {
        ch.readyState = 3
        ch.onclose?.({ code: 1006 })
      }
    })
    setState('connecting')
    setMsg('')
    window.api
      .vncOpen(connId, hostId, id)
      .then(() => {
        if (!alive || !box.current) return window.api.vncClose(id) // 여는 중에 화면을 떠났음 → 열린 터널을 닫음
        rfb = new RFB(box.current, ch)
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfbRef.current = rfb
        rfb.addEventListener('credentialsrequired', () => alive && setState('password'))
        rfb.addEventListener('connect', () => {
          shown = true
          if (alive) setState('connected')
        })
        rfb.addEventListener('securityfailure', (e) => alive && (setMsg(((e as CustomEvent).detail?.reason as string) || tr('비밀번호가 맞지 않아요')), setPw('')))
        rfb.addEventListener('disconnect', () => {
          if (!alive) return
          setState('ended')
          if (!shown) setMsg((m) => m || tr('연결이 끊겼어요'))
        })
      })
      .catch(async (e) => {
        if (!alive) return
        setMsg(errText(e))
        try {
          setGuide(await window.api.vncGuide(connId, hostId))
          if (alive) setState('guide')
        } catch (e2) {
          if (alive) (setMsg(errText(e2)), setState('ended'))
        }
      })
    return () => {
      alive = false
      offData()
      offClose()
      try {
        rfb?.disconnect()
      } catch {
        /* 이미 닫힘 */
      }
      ch.close()
      rfbRef.current = null
    }
  }, [connId, hostId, online, tries])

  const send = () => {
    rfbRef.current?.sendCredentials({ password: pw })
    setPw('')
    setMsg('')
    setState('connecting')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelHead title={tr('Device 화면')} desc={<Desc>{tr('SSH로 Device의 데스크톱을 봐요. Device에 따로 설치하는 것은 없어요 (VNC 서버는 Device에 켜져 있어야 해요).')}</Desc>}>
        {onClose && <Button size={36} onClick={onClose}>{tr('닫기')}</Button>}
        {remote && onExternal && (
          <Button size={36} onClick={onExternal} disabled={!online} title={tr('{0} 원격 화면을 PC의 {1}로 열기', remote.toUpperCase(), remote === 'rdp' ? tr('원격 데스크톱(mstsc)') : tr('VNC 뷰어'))}>
            {tr('PC 뷰어로 열기 ({0})', remote.toUpperCase())}
          </Button>
        )}
        <Button size={36} onClick={() => setTries((n) => n + 1)} disabled={!online || state === 'connecting'}>
          {state === 'connected' ? tr('다시 연결') : tr('연결')}
        </Button>
      </PanelHead>
      {!online && <Note>{tr('연결되면 화면을 볼 수 있어요.')}</Note>}
      {online && state === 'connecting' && <Note>{tr('연결하는 중…')}</Note>}
      {online && state === 'password' && (
        <form
          className="callout"
          style={{ margin: 20, flexDirection: 'column', gap: 8, maxWidth: 420 }}
          onSubmit={(e) => (e.preventDefault(), send())}
        >
          <b>{tr('VNC 비밀번호')}</b>
          <span>{tr('Device에서 정한 VNC 비밀번호예요. JetDeck은 저장하지 않아요.')}</span>
          <input className="input" type="password" autoFocus aria-label={tr('VNC 비밀번호')} value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button variant="primary" size={40} type="submit">{tr('접속하기')}</Button>
        </form>
      )}
      {online && msg && state !== 'guide' && <Note err>{msg}</Note>}
      {online && state === 'guide' && guide && (
        <div className="callout" style={{ margin: 20, flexDirection: 'column', gap: 10 }}>
          <b>{guide.title}</b>
          <span>{guide.text}</span>
          {msg && <span className="dim">({msg})</span>}
          {guide.steps.map((s, i) => (
            <div key={s.cmd} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>{i + 1}. {s.text}</span>
              <div className="hk-code" style={{ userSelect: 'all' }}>{s.cmd}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size={36} onClick={() => navigator.clipboard.writeText(s.cmd)}>{tr('복사')}</Button>
                <Button size={36} onClick={() => onLaunch(s.cmd, tr('아래 명령은 Device 설정을 바꿔요 (설치·화면 공유 켜기).'))}>{tr('새 터미널에서 실행')}</Button>
              </div>
            </div>
          ))}
          <span className="dim">{tr('끝나면 위의 "연결"을 누르세요.')}</span>
        </div>
      )}
      {/* 화면 칸은 항상 두어 noVNC가 그릴 자리를 유지 (연결 전에는 비어 있음) */}
      <div ref={box} style={{ flex: 1, minHeight: 0, background: '#000', display: state === 'connected' ? 'block' : 'none' }} />
    </div>
  )
}
