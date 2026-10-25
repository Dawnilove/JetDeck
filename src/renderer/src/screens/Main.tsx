import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Found } from '../../../main/discover'
import type { PortInfo } from '../../../main/serial'
import type { RemoteKind } from '../../../main/remotecfg.mts'
import type { Host, HostInfo } from '../../../main/store'
import Button from '../components/Button'
import Input from '../components/Input'
import Logo from '../components/Logo'
import { useMcpClients } from '../components/McpDialogs'
import Segment from '../components/Segment'
import { currentMascot, currentTheme, mascotHidden, setMascotHidden, themeList, useThemeTick } from '../themes'
import { parseSnippets } from './snippets.mts'
import { mergeSnippets } from '../../../main/settingsio.mts'
import ThemePicker from '../components/ThemePicker'
import { MascotOr } from '../components/Mascot'
import { errText, pwBlocked, PW_HELP, trNode } from '../util'
import { getLang, tr } from '../../../main/i18n.mts'

type Form = Omit<Host, 'port' | 'remote' | 'remotePort'> & { port: string; remote: '' | RemoteKind; remotePort: string } // 입력 중엔 문자열로 들고 있다가 저장 때 숫자로
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] // main/store.ts BAUDS와 같게
const empty: Form = { id: '', name: '', kind: 'ssh', serialPath: '', baud: 115200, host: '', port: '22', username: '', auth: 'password', keyPath: '', keepalive: true, autoReconnect: true, x11: false, remote: '', remotePort: '', remoteTunnel: true }
const formOf = (h: Host): Form => ({ ...h, port: String(h.port), remote: h.remote ?? '', remotePort: h.remotePort ? String(h.remotePort) : '', remoteTunnel: h.remoteTunnel ?? true })
const toHost = (f: Form): Host => ({ ...f, port: Number(f.port), remote: f.remote || undefined, remotePort: f.remotePort ? Number(f.remotePort) : undefined })

// shortcut: 주소만 보고 연결 방식 추정 (Wi-Fi/유선 구분 불가), 정확히 하려면 연결된 PC 인터페이스까지 확인
const linkOf = (host: string) => (host.startsWith('192.168.55.') ? 'USB' : host.endsWith('.local') ? 'mDNS' : tr('네트워크'))

type Props = {
  onConnect: (host: HostInfo) => void
  theme: string
  onTheme: (id: string) => void
  onGuide: () => void
  onNews: () => void
  onMcp: () => void
  onLang: () => void // 언어 전환 (열린 연결이 있으면 App이 먼저 확인)
  top?: (hosts: HostInfo[]) => ReactNode // 머리말 아래에 끼워 넣을 것 (대시보드, 저장된 호스트 목록을 같이 씀)
}

export default function Main({ onConnect, theme, onTheme, onGuide, onNews, onMcp, onLang, top }: Props) {
  useThemeTick() // 마스코트 숨기기 체크 상태 반영
  const mcp = useMcpClients()
  const [hosts, setHosts] = useState<HostInfo[]>([])
  const [online, setOnline] = useState<Record<string, number | null>>({})
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<Form>(empty)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [xUp, setXUp] = useState<boolean | null>(null) // 이 PC에 X 서버가 떠 있는지 (X11 화면을 켰을 때만 확인)

  const [ports, setPorts] = useState<PortInfo[] | null>(null)
  const loadPorts = () => window.api.listSerial().then((p) => (setPorts(p), p), () => (setPorts([]), []))
  const refresh = async () => {
    const list = await window.api.listHosts()
    setHosts(list)
    // 온라인 여부는 목록을 먼저 보여준 뒤 하나씩 채움. 시리얼은 포트가 꽂혀 있으면 온라인
    const serial = list.filter((h) => h.kind === 'serial')
    if (serial.length) loadPorts().then((p) => serial.forEach((h) => setOnline((o) => ({ ...o, [h.id]: p.some((x) => x.path === h.serialPath) ? 0 : null }))))
    list.forEach((h) => h.kind !== 'serial' && window.api.probe(h.host, h.port).then((ms) => setOnline((o) => ({ ...o, [h.id]: ms }))))
  }
  useEffect(() => {
    refresh().catch((e) => setMsg({ text: errText(e), ok: false }))
  }, [])
  useEffect(() => {
    if (form.x11) window.api.x11Check().then(setXUp)
  }, [form.x11, form.id])
  // 버그 신고·업데이트 확인용으로 머리말에 앱 버전 표시
  const [version, setVersion] = useState('')
  useEffect(() => void window.api.appVersion().then(setVersion, () => {}), [])

  // 깨우기(Wake-on-LAN): 매직 패킷을 보낸 뒤 최대 90초 동안 3초마다 SSH 포트로 응답 확인
  const wake = async (h: HostInfo) => {
    try {
      await window.api.wakeHost(h.id)
    } catch (e) {
      return setMsg({ text: errText(e), ok: false })
    }
    setMsg({ text: tr("'{0}'에 깨우기 신호를 보냈어요. 응답을 기다리는 중…", h.name), ok: true })
    setOnline(({ [h.id]: _, ...rest }) => rest) // 확인 중(노란 점)으로 표시
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const ms = await window.api.probe(h.host, h.port)
      if (ms !== null) {
        setOnline((o) => ({ ...o, [h.id]: ms }))
        return setMsg({ text: tr("'{0}'이(가) 깨어났어요 · {1} ms", h.name, ms), ok: true })
      }
    }
    setOnline((o) => ({ ...o, [h.id]: null }))
    setMsg({ text: tr("'{0}'이(가) 90초 안에 응답하지 않았어요. 완전히 꺼져 있다면 전원 버튼을 눌러 주세요", h.name), ok: false })
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const selected = hosts.find((h) => h.id === form.id)
  const serial = form.kind === 'serial'
  const q = query.trim().toLowerCase()
  const shown = hosts.filter((h) => h.name.toLowerCase().includes(q) || h.host.toLowerCase().includes(q))

  const edit = (h: HostInfo | null) => {
    setForm(h ? formOf(h) : empty)
    if (h?.kind === 'serial') loadPorts()
    setPassword('')
    setMsg(null)
  }
  // 입력 중인 내용을 버리기 전에 확인 (다른 호스트 선택·접속·새 호스트)
  const base: Form = selected ? formOf(selected) : empty
  const dirty = password !== '' || (Object.keys(empty) as (keyof Form)[]).some((k) => (form[k] ?? '') !== (base[k] ?? ''))
  const leave = () => !dirty || confirm(tr('입력 중인 내용이 사라져요. 계속할까요?'))

  const [busy, setBusy] = useState(false)
  // 실제 SSH 접속·인증까지 해보고 끊음 (호스트 키가 처음이거나 바뀌었으면 다이얼로그가 뜸)
  const test = async (h: Host, pw: string) => {
    setBusy(true)
    setMsg({ text: tr('연결 중...'), ok: true })
    try {
      setMsg({ text: await window.api.testSsh(h, pw || undefined), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  // SSH 키 마법사: 지금 비밀번호로 접속해 이 PC의 공개 키를 Device에 등록하고, 성공하면 인증 방식을 'SSH 키'로 바꿈
  const installKey = async () => {
    if (!confirm(tr('이 PC의 SSH 키(~/.ssh/id_ed25519, 없으면 새로 만들어요)를 Device의 ~/.ssh/authorized_keys에 등록해요.\n등록 뒤에는 비밀번호 없이 키로 접속할 수 있어요. 진행할까요?'))) return
    setBusy(true)
    setMsg({ text: tr('키를 등록하는 중...'), ok: true })
    try {
      const text = await window.api.installKey(toHost(form),password || undefined)
      setForm((f) => ({ ...f, auth: 'key', keyPath: '' }))
      setPassword('')
      setMsg({ text: tr('{0}. 인증 방식을 SSH 키로 바꿨어요. 저장 후 연결하세요.', text), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    let saved: HostInfo
    try {
      saved = await window.api.saveHost(toHost(form),password || undefined)
    } catch (e) {
      return setMsg({ text: errText(e), ok: false })
    }
    onConnect(saved)
  }

  // 주변 기기 검색: 누를 때만 실행 (같은 /24 대역 + USB 주소의 22번 포트)
  const [found, setFound] = useState<Found[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const scan = async () => {
    setScanning(true)
    try {
      setFound(await window.api.scanJetsons())
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    } finally {
      setScanning(false)
    }
  }
  // 찾은 기기를 누르면: 저장된 호스트면 그 호스트를, 아니면 주소를 채운 새 연결 폼을 엶
  const pick = (f: Found) => {
    if (!leave()) return
    const saved = hosts.find((h) => h.host === f.host)
    if (saved) return edit(saved)
    edit(null)
    setForm({ ...empty, host: f.host, name: f.usb ? 'jetson-usb' : `jetson-${f.host.split('.').pop()}` })
  }

  // 설정 내보내기·가져오기: 스니펫·테마는 이 PC 화면 저장소(localStorage)에 있어 화면이 읽고 씀
  const readSnips = () => {
    try {
      return parseSnippets(localStorage.getItem('snippets'), localStorage.getItem('quick-commands'))
    } catch {
      return parseSnippets(null, null)
    }
  }
  const exportCfg = async () => {
    try {
      const r = await window.api.exportSettings(readSnips(), currentTheme())
      if (r) setMsg({ text: tr('설정을 저장했어요: {0} (호스트 {1}개, 스니펫 {2}개). 비밀번호는 들어 있지 않아요.', r.path, r.hosts, r.snippets) + (r.masked ? ' ' + tr('비밀처럼 보이는 스니펫 값 {0}개는 가렸어요.', r.masked) : ''), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    }
  }
  const saveDiag = async () => {
    try {
      const p = await window.api.saveDiagnostics()
      if (p) setMsg({ text: tr('진단 정보를 저장했어요: {0}. 기기 이름·주소·비밀번호는 들어 있지 않아서 문제 신고에 붙여도 돼요.', p), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    }
  }
  const settingsPop = useRef<HTMLDivElement>(null)
  const [overwriteCfg, setOverwriteCfg] = useState(false) //가져올 때 같은 기기·스니펫을 덮어쓸지 (기본은 새 것만 추가)
  const importCfg = async () => {
    try {
      const r = await window.api.importSettings(overwriteCfg)
      if (r.canceled) return
      const m = mergeSnippets(readSnips(), r.snippets, overwriteCfg)
      if (m.added || m.updated) localStorage.setItem('snippets', JSON.stringify(m.list))
      if (r.theme && themeList().some((t) => t.id === r.theme)) onTheme(r.theme)
      await refresh()
      setMsg({ text: tr('가져왔어요: 호스트 {0}개 추가 (이미 있어서 {1}개 건너뜀, 올바르지 않은 {2}개), 스니펫 {3}개 추가. 비밀번호 방식 호스트는 호스트를 눌러 비밀번호를 다시 입력하세요.', r.added, r.skipped, r.invalid, m.added) + (overwriteCfg ? ' ' + tr('덮어쓴 것: 호스트 {0}개, 스니펫 {1}개.', r.updated, m.updated) + (m.kept ? ' ' + tr('비밀이 가려진 스니펫 {0}개는 원래 것을 그대로 뒀어요.', m.kept) : '') : ''), ok: true })
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    }
  }

  const remove = async () => {
    if (!selected || !confirm(tr("'{0}' 호스트를 삭제할까요?", selected.name))) return
    await window.api.deleteHost(selected.id)
    edit(null)
    await refresh()
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--header)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MascotOr status="online" size={32}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center' }}>
              <Logo size={20} />
            </div>
          </MascotOr>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="display" style={{ fontWeight: 600, fontSize: 16 }}>JetDeck</span>
            <span className="dim" style={{ fontSize: 12 }}>{tr('Jetson에 특화된, 모든 리눅스 기기를 위한 SSH 클라이언트')}{version && ` · v${version}`}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button size={40} onClick={onMcp} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} title={mcp.length ? tr('{0} 연결됨', mcp.join(', ')) : tr('Claude·Cursor·Codex 등 AI에서 JetDeck을 쓰도록 설정 (아직 연결된 AI 없음)')}>
          <span className={mcp.length ? 'dot' : 'dot offline'} aria-hidden />
          {tr('MCP 연결')}
        </Button>
        <Button size={40} onClick={onGuide}>{tr('도움말')}</Button>
        <Button size={40} onClick={onNews}>{tr('업데이트 내용')}</Button>
        {/* 언어·테마·설정 파일·진단은 설정 메뉴 하나로 (바깥 클릭·Esc로 닫힘) */}
        <Button size={40} className="settings-btn" popoverTarget="settings-pop" aria-haspopup="dialog">{tr('환경 설정')} <span aria-hidden="true">▾</span></Button>
        <div id="settings-pop" ref={settingsPop} popover="auto" className="settings-pop" role="dialog" aria-label={tr('환경 설정')}>
          <div className="settings-row">
            <span>{tr('언어')}</span>
            <Button size={36} onClick={onLang} title="English / 한국어">{getLang() === 'ko' ? 'English' : '한국어'}</Button>
          </div>
          <div className="settings-row">
            <span>{tr('테마')}</span>
            <ThemePicker value={theme} onChange={onTheme} />
          </div>
          {currentMascot() && (
            <label className="check"><input type="checkbox" checked={mascotHidden()} onChange={(e) => setMascotHidden(e.target.checked)} />{tr('마스코트 숨기기')}</label>
          )}
          <span className="caption">{tr('설정 내보내기/가져오기')}</span>
          <div className="settings-row">
            <Button size={36} style={{ flex: 1 }} onClick={() => { settingsPop.current?.hidePopover(); exportCfg() }} title={tr('호스트 목록·스니펫·테마를 파일로 저장 (비밀번호 제외)')}>{tr('내보내기')}</Button>
            <Button size={36} style={{ flex: 1 }} onClick={() => { settingsPop.current?.hidePopover(); importCfg() }} title={tr('내보낸 설정 파일에서 호스트·스니펫·테마를 가져와요')}>{tr('가져오기')}</Button>
          </div>
          <label className="check dim" title={tr('같은 주소·사용자의 호스트와 이름이 같은 스니펫을 가져온 것으로 바꿔요 (저장된 비밀번호는 그대로)')}>
            <input type="checkbox" checked={overwriteCfg} onChange={(e) => setOverwriteCfg(e.target.checked)} />
            {tr('같은 것은 덮어쓰기')}
          </label>
          <Button size={36} onClick={() => { settingsPop.current?.hidePopover(); saveDiag() }} title={tr('문제 신고용 정보(버전·OS·호스트 개수·최근 오류)를 파일로 저장. 이름·주소·비밀은 빼요')}>{tr('진단 정보 저장')}</Button>
        </div>
        </div>
      </header>
      {top?.(hosts)}

      <div style={{ flexGrow: 1, display: 'flex', flexWrap: 'wrap' }}>
        <aside style={{ flex: '1 1 260px', maxWidth: '100%', padding: '20px 16px', borderRight: '1px solid var(--border)', background: 'var(--header)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="field" style={{ fontSize: 12 }}>
            {tr('호스트 검색')}
            <input className="input" style={{ height: 40 }} placeholder={tr('이름 또는 IP')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="caption">{tr('저장된 호스트')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shown.map((h) => (
              <div key={h.id} className="host-row">
                {/* 클릭하면 바로 접속, 수정은 옆 연필 버튼 */}
                <button type="button" className="host-item" aria-current={h.id === form.id} title={tr('{0}에 접속', h.name)} onClick={() => leave() && onConnect(h)}>
                  <span
                    className={`dot dot-lg ${online[h.id] === undefined ? 'connecting' : online[h.id] === null ? 'offline' : ''}`}
                    title={online[h.id] === undefined ? tr('확인 중') : online[h.id] === null ? (h.kind === 'serial' ? tr('포트 없음') : tr('오프라인')) : h.kind === 'serial' ? tr('포트 연결됨') : tr('온라인 · {0} ms', online[h.id])}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{h.name}</span>
                    <span className="mono dim" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.kind === 'serial' ? `${h.serialPath} · ${h.baud}` : h.host}</span>
                  </span>
                  <span className="tag">{h.kind === 'serial' ? tr('시리얼') : linkOf(h.host)}</span>
                </button>
                {/* 꺼져(응답 없음) 있고 MAC을 알 때만 깨우기 버튼 */}
                {h.wake && online[h.id] === null && (
                  <Button variant="ghost" size={40} aria-label={tr('{0} 깨우기', h.name)} title={tr('깨우기 (Wake-on-LAN, 같은 유선망에서만)')} onClick={() => wake(h)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 2v10" />
                      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
                    </svg>
                  </Button>
                )}
                <Button variant="ghost" size={40} aria-label={tr('{0} 수정', h.name)} onClick={() => leave() && edit(h)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </Button>
              </div>
            ))}
            {hosts.length === 0 && <p className="dim" style={{ fontSize: 13 }}>{tr('저장된 호스트가 없어요.')}</p>}
          </div>
          <Button variant="dashed" onClick={() => leave() && edit(null)}>{tr('+ 새 호스트')}</Button>
        </aside>

        {/* 세로 여백은 기본 창(1280×800)에 세션 탭 줄까지 있어도 버튼이 잘리지 않게 맞춘 값 */}
        <main style={{ flex: '999 1 560px', minWidth: 0, padding: '14px 40px', display: 'flex', flexWrap: 'wrap', gap: 24, alignContent: 'flex-start' }}>
          <section className="card" style={{ flex: '2 1 480px', minWidth: 0, padding: '18px 28px', gap: 16 }}>
            {/* 연결 종류 버튼은 제목 줄 오른쪽에 둬서 폼 높이를 줄임 (기본 창 + 세션 탭 줄에서도 '저장 후 연결'이 화면 안에 보이게) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 style={{ fontSize: 24, fontWeight: 600 }}>{selected ? selected.name : tr('새 연결')}</h1>
              <p className="dim">{serial ? tr('USB 시리얼 케이블로 연결된 포트와 속도를 고르세요.') : tr('Device의 IP 주소와 계정 정보를 입력하세요.')}</p>
            </div>
              <Segment
                label={tr('연결 종류')}
                value={serial ? 'serial' : 'ssh'}
                onChange={(v) => {
                  set('kind', v)
                  if (v === 'serial' && !ports) loadPorts()
                }}
                options={[{ value: 'ssh', label: 'SSH' }, { value: 'serial', label: tr('시리얼') }]}
              />
            </div>

            {serial ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                <Input label={tr('이름')} placeholder={tr('예: jetson-serial')} value={form.name} onChange={(e) => set('name', e.target.value)} />
                <label className="field">
                  {tr('속도 (baud)')}
                  <select className="input" value={form.baud} onChange={(e) => set('baud', Number(e.target.value))}>
                    {BAUDS.map((b) => <option key={b} value={b}>{b}{b === 115200 ? tr(' (젯슨 기본)') : ''}</option>)}
                  </select>
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <label className="field" style={{ flexGrow: 1 }}>
                    {tr('포트')}
                    <select className="input mono" value={form.serialPath} onChange={(e) => set('serialPath', e.target.value)}>
                      <option value="">{ports === null ? tr('불러오는 중…') : ports.length ? tr('포트 선택') : tr('연결된 포트가 없어요')}</option>
                      {/* 저장된 포트가 지금 안 꽂혀 있어도 선택값이 사라지지 않게 */}
                      {form.serialPath && !ports?.some((p) => p.path === form.serialPath) && <option value={form.serialPath}>{form.serialPath} {tr('(연결 안 됨)')}</option>}
                      {ports?.map((p) => <option key={p.path} value={p.path}>{p.label === p.path ? p.path : `${p.path} — ${p.label}`}</option>)}
                    </select>
                  </label>
                  <Button variant="filled" style={{ padding: '0 16px' }} onClick={() => loadPorts()}>{tr('새로고침')}</Button>
                </div>
              </div>
            ) : (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
              {/* 예시 글자가 입력값처럼 보이지 않게 '예:'를 붙임 */}
              <Input label={tr('이름')} placeholder={tr('예: jetson-nano')} value={form.name} onChange={(e) => set('name', e.target.value)} />
              <Input label={tr('호스트')} mono placeholder={tr('예: 192.168.0.42')} value={form.host} onChange={(e) => set('host', e.target.value)} />
              <Input label={tr('사용자 이름')} placeholder={tr('Device를 처음 설정할 때 만든 계정')} value={form.username} onChange={(e) => set('username', e.target.value)} />
              <Input label={tr('포트')} mono inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 13 }} className="dim">{tr('인증 방식')}</span>
              <div style={{ alignSelf: 'flex-start' }}>
                <Segment
                  label={tr('인증 방식')}
                  value={form.auth}
                  onChange={(v) => set('auth', v)}
                  options={[{ value: 'password', label: tr('비밀번호') }, { value: 'key', label: tr('SSH 키') }]}
                />
              </div>
              {form.auth === 'password' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Input
                    label={tr('비밀번호')}
                    type="password"
                    placeholder={selected?.hasPassword ? tr('저장된 비밀번호 사용 (바꾸려면 입력)') : ''}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <div>
                    <Button variant="filled" size={36} disabled={busy || !form.host.trim() || !form.username.trim()} onClick={installKey} title={tr('이 PC의 키를 Device에 등록하고 비밀번호 없이 접속하게 바꿔요')}>
                      {tr('SSH 키로 바꾸기 (키 등록 마법사)')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flexGrow: 1 }}>
                    <Input label={tr('개인 키 파일')} mono placeholder={tr('비우면 ~/.ssh 기본 키 사용')} value={form.keyPath} onChange={(e) => set('keyPath', e.target.value)} />
                  </div>
                  <Button variant="filled" style={{ padding: '0 16px' }} onClick={async () => { const p = await window.api.pickKey(); if (p) set('keyPath', p) }}>
                    {tr('찾아보기')}
                  </Button>
                </div>
              )}
            </div>

            {/* 원격 화면(RDP·VNC): 작업 공간 위쪽의 '원격 화면' 버튼이 PC의 mstsc·VNC 뷰어를 열어 줌 (내장 뷰어는 없음) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 13 }} className="dim">{tr('원격 화면 (RDP·VNC)')}</span>
                <Segment
                  label={tr('원격 화면 종류')}
                  value={form.remote}
                  onChange={(v) => set('remote', v)}
                  options={[{ value: '', label: tr('사용 안 함') }, { value: 'rdp', label: 'RDP' }, { value: 'vnc', label: 'VNC' }]}
                />
              </div>
              {form.remote && (
                <>
                  <div style={{ width: 130 }}>
                    <Input label={tr('Device 포트')} mono inputMode="numeric" placeholder={form.remote === 'rdp' ? '3389' : '5900'} value={form.remotePort} onChange={(e) => set('remotePort', e.target.value)} />
                  </div>
                  <label className="check" title={tr('켜면 SSH 연결 위에 터널을 열어 암호화해서 연결해요. 끄면 Device 주소로 바로 연결해요')}>
                    <input type="checkbox" checked={form.remoteTunnel} onChange={(e) => set('remoteTunnel', e.target.checked)} />{tr('SSH 터널로 연결')}
                  </label>
                </>
              )}
            </div>

            </>
            )}

            <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
              <legend className="dim" style={{ fontSize: 13, marginBottom: 10, padding: 0 }}>{tr('옵션')}</legend>
              {!serial && <label className="check"><input type="checkbox" checked={form.keepalive} onChange={(e) => set('keepalive', e.target.checked)} />{tr('연결 유지 (keepalive)')}</label>}
              <label className="check"><input type="checkbox" checked={form.autoReconnect} onChange={(e) => set('autoReconnect', e.target.checked)} />{tr('끊기면 자동 재연결')}</label>
              {!serial && <label className="check"><input type="checkbox" checked={form.x11} onChange={(e) => set('x11', e.target.checked)} />{tr('X11 화면 (rviz·rqt 같은 GUI를 이 PC에 표시)')}</label>}
            </fieldset>
            {!serial && form.x11 && xUp === false && (
              <div className="callout" style={{ flexDirection: 'column', gap: 8 }}>
                <b>{tr('이 PC에 X 서버가 필요해요')}</b>
                <span>{tr('X11 화면은 Device의 GUI 창을 이 PC의 X 서버에 띄워요. JetDeck은 설치하지 않으니 직접 설치하세요 (PowerShell):')}</span>
                <div className="hk-code" style={{ userSelect: 'all' }}>winget install marha.VcXsrv</div>
                {/* JetDeck은 SSH로 받은 X 연결을 이 PC 안(127.0.0.1)에서만 넘기므로 방화벽을 열 필요가 없음. 열면 접근 제어를 끈 X 서버가 같은 네트워크에 드러남 */}
                <span>{tr(`설치 후 시작 메뉴의 XLaunch에서 "Multiple windows → Display number 0 → Start no client → 'Disable access control' 체크" 순서로 실행하세요. Windows 방화벽 허용 창이 뜨면 허용하지 말고 "취소"를 누르세요 (JetDeck은 이 PC 안에서만 연결해서 방화벽을 열 필요가 없고, 열면 같은 네트워크의 다른 기기가 이 PC 화면에 접근할 수 있어요). 실행했으면 아래 버튼으로 다시 확인하세요.`)}</span>
                <div><Button size={36} onClick={() => window.api.x11Check().then(setXUp)}>{tr('X 서버 다시 확인')}</Button></div>
              </div>
            )}
            {!serial && form.x11 && xUp && <p className="dim" style={{ fontSize: 13 }}>{tr('이 PC의 X 서버가 켜져 있어요. 연결 후 터미널에서 GUI 명령(예: xeyes)을 실행하세요.')}</p>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, background: 'var(--panel)' }}> {/* 창이 낮아도 버튼 줄이 잘리지 않게 */}
              {selected && <Button variant="warn" onClick={remove}>{tr('삭제')}</Button>}
              <span role="status" className={msg?.ok ? 'msg-ok' : 'msg-err'} style={{ flexGrow: 1, fontSize: 13 }}>{msg?.text}</span>
              {msg && !msg.ok && pwBlocked(msg.text) && (
                <div className="callout" style={{ flexBasis: '100%', flexDirection: 'column', gap: 6 }}>
                  <b>{tr('해결 방법')}</b>
                  {PW_HELP.map((h) => (
                    <div key={h.text}>
                      {h.text}
                      {h.cmd && <div className="hk-code" style={{ marginTop: 4, userSelect: 'all' }}>{h.cmd}</div>}
                    </div>
                  ))}
                </div>
              )}
              {!serial && <Button onClick={() => test(toHost(form), password)} disabled={busy}>{tr('연결 테스트')}</Button>}
              <Button variant="primary" onClick={save} disabled={busy}>{tr('저장 후 연결')}</Button>
            </div>
          </section>

          {serial ? (
            // 시리얼 모드: 주변 기기 찾기(SSH 전용) 대신 시리얼 연결 안내
            <section className="card" style={{ flex: '1 1 300px', minWidth: 0 }}>
              <h2>{tr('시리얼로 연결하기')}</h2>
              <div className="callout" style={{ flexDirection: 'column', gap: 8 }}>
                <p>{trNode('젯슨의 {0}를 PC에 꽂으면 COM 포트가 생겨요. USB-TTL 변환기를 디버그 UART 핀에 연결해도 돼요.', <b>{tr('Micro-USB 포트')}</b>)}</p>
                <p>{trNode('포트가 안 보이면 장치 관리자 → {0}에서 드라이버를 확인하고 새로고침을 누르세요.', <b>{tr('포트(COM & LPT)')}</b>)}</p>
                <p>{trNode('속도는 보통 {0}이에요. 네트워크가 안 될 때도 로그인할 수 있어요.', <span className="mono" style={{ color: 'var(--text)' }}>115200</span>)}</p>
              </div>
            </section>
          ) : (
          <section className="card" style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2>{tr('주변 Device 찾기')}</h2>
              <Button variant="ghost" aria-label={tr('새로고침')} title={tr('같은 네트워크와 USB 연결에서 SSH 기기 다시 찾기')} disabled={scanning} onClick={scan}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
                </svg>
              </Button>
            </div>
            <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {scanning && <p className="dim" style={{ fontSize: 13 }}>{tr('찾는 중… (10초쯤 걸려요)')}</p>}
              {!scanning && found === null && <p className="dim" style={{ fontSize: 13 }}>{tr('새로고침 버튼을 누르면 SSH가 열린 기기를 찾아요.')}</p>}
              {!scanning && found?.length === 0 && <p className="dim" style={{ fontSize: 13 }}>{tr('찾은 기기가 없어요. Device가 켜져 있고 같은 공유기에 연결됐는지 확인해 주세요.')}</p>}
              {found?.map((f) => {
                const saved = hosts.find((h) => h.host === f.host)
                return (
                  <button key={f.host} type="button" className="host-item" title={f.banner || tr('SSH 응답')} onClick={() => pick(f)}>
                    <span className="dot dot-lg" />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                      <span className="mono" style={{ fontSize: 13 }}>{f.host}</span>
                      <span className="dim" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.banner || 'SSH'} · {f.ms} ms</span>
                    </span>
                    <span className="tag">{saved ? tr('저장됨') : f.usb ? 'USB' : f.nvidia ? 'NVIDIA' : tr('SSH 기기')}</span>
                  </button>
                )
              })}
            </div>
            <div className="callout">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <p>
                {trNode('Micro-USB 케이블로 PC와 직접 연결했다면 {0} 주소로 바로 접속할 수 있어요.', <span className="mono" style={{ color: 'var(--text)' }}>192.168.55.1</span>)}
              </p>
            </div>
          </section>
          )}
        </main>
      </div>
    </div>
  )
}
