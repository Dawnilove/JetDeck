import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import type { MonitorInfo } from '../../../main/monitor'
import type { HostInfo } from '../../../main/store'
import type { Stats } from '../../../main/tegrastats.mts'
import Editor, { type EditorApi, type EditorStatus } from '../components/Editor'
import Explorer from '../components/Explorer'
import Activity, { type ActTab } from './Activity'
import Button from '../components/Button'
import Segment from '../components/Segment'
import Docker from './Docker'
import Services from './Services'
import Manage from './Manage'
import HealthView, { useHealth } from './Health'
import Camera from './Camera'
import Screen from './Screen'
import Ros from './Ros'
import Files from './Files'
import Search from './Search'
import Build from './Build'
import Forward, { type FwdRule } from './Forward'
import Mascot, { MascotOr, MascotTip, MascotToast } from '../components/Mascot'
import Monitor, { SUSPEND_ASK, suspendCommand } from '../components/Monitor'
import { bufferRows } from '../components/TermSearch'
import Terminal, { terms as xterms } from '../components/Terminal'
import TermSearch from '../components/TermSearch'
import { toLog } from './termsearch.mts'
import Logo from '../components/Logo'
import { useMcpClients } from '../components/McpDialogs'
import Palette, { type PaletteItem } from '../components/Palette'
import { currentMascot, currentTheme, groupOf, mascotHidden, setMascotHidden, themeLabel, themeList } from '../themes'
import SnippetDialog from '../components/SnippetDialog'
import { errText, STATUS_TEXT, trNode } from '../util'
import { DANGER, keystrokes, parseSnippets, SNIPPET_DEFAULT, type Snippet } from './snippets.mts'
import { shq } from '../../../main/shq.mts'
import { tr } from '../../../main/i18n.mts'

export type Sess = {
  id: string // 연결 id = 첫 터미널 id
  host: HostInfo
  status: 'online' | 'connecting' | 'offline'
  hostKeyType?: string
  ms?: number | null
  terms: string[] // 터미널 탭(셸) id 목록
  activeTerm: string
  splitTerm?: string // 오른쪽에 나란히 보이는 터미널
}

// 탭 하나를 목록에서 빼고 활성/분할 탭을 정리
export function dropTerm(s: Sess, t: string): Sess {
  const terms = s.terms.filter((x) => x !== t)
  const split = s.splitTerm === t ? undefined : s.splitTerm
  const active = s.activeTerm === t ? (split ?? terms.at(-1) ?? '') : s.activeTerm
  return { ...s, terms, activeTerm: active, splitTerm: active === split ? undefined : split }
}

type Props = {
  sess: Sess
  active: boolean // 숨겨진 작업 공간도 터미널 내용을 유지하려고 마운트된 채로 둠
  onPatch: (p: Partial<Sess>) => void
  onHosts: () => void
  onDisconnect: () => void
  onReconnect: (cols?: number, rows?: number) => void
  onTheme: (id: string) => void
  onGuide: () => void
  onNews: () => void
  onMcp: () => void
  paneStyle?: CSSProperties // 분할 화면에서 칸 순서·배치
  focused: boolean // 분할 화면에서 지금 선택한 칸 (단축키·키보드 포커스는 이 칸만)
  compact: boolean // 분할 화면의 한 칸: 터미널 중심으로 탐색기·편집기·모니터를 접어 둠
  onFocus: () => void
  onUnsplit: () => void
  onLang: () => void // 언어 전환 (App이 열린 연결·저장 안 한 파일을 먼저 확인)
}

// 아이콘 경로는 design/Workspace.dc.html 그대로
const ICONS: Record<string, ReactNode> = {
  explorer: (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></>),
  hosts: (<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><line x1="7" y1="7.5" x2="7.01" y2="7.5" /><line x1="7" y1="16.5" x2="7.01" y2="16.5" /></>),
  forward: (<><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>),
  monitor: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  ros: (<><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M11 7.2 6.3 15.8M13 7.2l4.7 8.6M7.5 18h9" /></>),
  activity: (<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>),
  services: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>),
  health: (<path d="M3 12h4l2-6 4 12 2-6h6" />),
  docker: (<><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>),
  screen: (<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>),
  camera: (<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
  build: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  search: (<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></>),
  transfer: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>)
}

// toggle: 켜고 끄는 패널(아이콘 색만 강조), 아니면 현재 보는 화면(배경 채움)
function ActBtn({ icon, label, selected, toggle, disabled, onClick }: { icon: string; label: string; selected?: boolean; toggle?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`act-btn ${toggle ? 'toggle' : ''}`} aria-label={label} title={label} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
    </button>
  )
}

// 세션별 "저장 안 된 파일 수" — App(탭 닫기·연결 해제)과 main(앱 종료)이 확인
export const unsaved = new Map<string, () => number>()

// 시작 화면의 최근 파일: 호스트마다 최근 8개를 이 PC에만 기억
const RECENT_MAX = 8
const recentKey = (hostId: string) => `recent:${hostId}`
function loadRecent(hostId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(hostId)) ?? '[]')
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

// 명령 스니펫(예전 '빠른 명령'): 이 PC에만 저장되면 충분해서 localStorage 사용
const SNIP_KEY = 'snippets'
const QUICK_KEY = 'quick-commands' // 2.2 이하에서 쓰던 키: 처음 한 번 스니펫으로 이어받음
function loadSnippets(): Snippet[] {
  try {
    return parseSnippets(localStorage.getItem(SNIP_KEY), localStorage.getItem(QUICK_KEY))
  } catch {
    return SNIPPET_DEFAULT
  }
}

// 작업 공간 위에 덮는 화면들: 왼쪽 활동 막대 버튼과 명령 팔레트 항목을 이 목록 하나로 만듦 (한쪽에만 빠지는 일이 없게)
type View = 'code' | 'search' | 'build' | 'files' | 'forward' | 'ros' | 'docker' | 'services' | 'health' | 'manage' | 'screen' | 'camera' | 'activity'
const VIEWS: { id: Exclude<View, 'code'>; icon: string; label: string; cmd: string }[] = [
  { id: 'search', icon: 'search', label: tr('파일 검색·바꾸기'), cmd: tr('파일 검색·바꾸기 열기') },
  { id: 'build', icon: 'build', label: tr('빌드 도구'), cmd: tr('빌드 도구 열기 (colcon·catkin_make)') },
  { id: 'forward', icon: 'forward', label: tr('포트 포워딩'), cmd: tr('포트 포워딩 열기') },
  { id: 'files', icon: 'transfer', label: tr('파일 전송'), cmd: tr('파일 전송 열기') },
  { id: 'activity', icon: 'activity', label: tr('활동 (모니터 기록)'), cmd: tr('활동 (모니터 기록 그래프) 열기') },
  { id: 'services', icon: 'services', label: tr('서비스'), cmd: tr('서비스 (systemd) 열기') },
  { id: 'health', icon: 'health', label: tr('기기 점검'), cmd: tr('기기 점검 (온도·Wi-Fi·디스크) 열기') },
  { id: 'manage', icon: 'services', label: tr('업데이트·디스크·전원'), cmd: tr('업데이트·디스크·전원 (기기 관리 도구) 열기') },
  { id: 'docker', icon: 'docker', label: 'Docker', cmd: tr('Docker 컨테이너·이미지 열기') },
  { id: 'screen', icon: 'screen', label: tr('Device 화면'), cmd: tr('Device 화면 열기') },
  { id: 'camera', icon: 'camera', label: tr('영상 입력'), cmd: tr('영상 입력 열기') },
  { id: 'ros', icon: 'ros', label: 'ROS2', cmd: tr('ROS2 도구 열기 (토픽·노드·launch)') }
]

// 왼쪽 활동 막대는 묶음 단위. 묶음 안 화면은 화면 위쪽 탭으로 오가고, 화면이 하나뿐인 묶음은 탭 줄이 없음
const GROUPS: { id: string; icon: string; label: string; views: Exclude<View, 'code'>[] }[] = [
  { id: 'dev', icon: 'search', label: tr('개발 도구'), views: ['search', 'build'] },
  { id: 'link', icon: 'transfer', label: tr('연결·전송'), views: ['forward', 'files'] },
  { id: 'activity', icon: 'activity', label: tr('활동 (모니터 기록)'), views: ['activity'] },
  { id: 'manage', icon: 'services', label: tr('기기 관리'), views: ['services', 'health', 'manage'] },
  { id: 'docker', icon: 'docker', label: 'Docker', views: ['docker'] },
  { id: 'media', icon: 'screen', label: tr('화면·영상'), views: ['screen', 'camera'] },
  { id: 'ros', icon: 'ros', label: 'ROS2', views: ['ros'] }
]

// 접힌 패널은 펴고, 펴진 패널은 접기
const toggle = (p: PanelImperativeHandle | null) => (p?.isCollapsed() ? p.expand() : p?.collapse())

export default function Workspace({ sess, active, onPatch, onHosts, onDisconnect, onReconnect, onTheme, onGuide, onNews, onMcp, focused, compact, paneStyle, onFocus, onUnsplit, onLang }: Props) {
  const mcp = useMcpClients()
  const { host } = sess
  // 패널 크기·접힘 상태는 호스트별로 저장
  const outer = useDefaultLayout({ id: `ws-${host.id}`, storage: localStorage })
  const inner = useDefaultLayout({ id: `ws-${host.id}-center`, storage: localStorage })
  const explorerRef = usePanelRef()
  const monitorRef = usePanelRef()
  const editorRef = usePanelRef()
  const terminalRef = usePanelRef()
  const [open, setOpen] = useState({ explorer: true, monitor: true, full: false })
  const [sizes, setSizes] = useState<Record<string, { cols: number; rows: number }>>({})
  const [snips, setSnips] = useState(loadSnippets)
  const [editing, setEditing] = useState<{ index: number | null } | null>(null) // 스니펫 편집 창 (index null = 새로 만들기)
  const [home, setHome] = useState('')
  const [recent, setRecent] = useState(() => loadRecent(host.id))
  const remember = (p: string) =>
    setRecent((list) => {
      const next = [p, ...list.filter((x) => x !== p)].slice(0, RECENT_MAX)
      try {
        localStorage.setItem(recentKey(host.id), JSON.stringify(next))
      } catch {
        /* 저장 실패해도 이번 실행 동안은 보임 */
      }
      return next
    })
  const [edStatus, setEdStatus] = useState<EditorStatus>(null)
  const codeRef = useRef<EditorApi>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [info, setInfo] = useState<MonitorInfo>({})
  // 포트 포워딩 규칙: 포워딩 화면과 모니터의 '포워딩 중' 목록이 같이 씀
  const [rules, setRules] = useState<FwdRule[]>([])
  const loadRules = () => window.api.fwdList(sess.id, host.id).then(setRules, () => {})
  useEffect(() => {
    if (sess.status === 'online') loadRules()
    else setRules((rs) => rs.map((r) => ({ ...r, active: false })))
  }, [sess.status])
  useEffect(
    () =>
      window.api.onFwdStatus((s) => {
        if (s.connId === sess.id) setRules((rs) => rs.map((r) => (r.id === s.ruleId ? { ...r, active: s.active, error: s.error } : r)))
      }),
    [sess.id]
  )

  // 이 세션의 모니터 값만 받음. 다시 연결하면 처음부터
  // 안 보이는 탭은 값만 받아 두고 화면은 다시 그리지 않음 (여러 대 연결 시 CPU 절약) → 다시 보이면 최신 값으로 채움
  // 수집은 main(monitor.ts)이 계속 하므로 MCP get_status 등은 영향 없음
  const lastStats = useRef<Stats | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    if (sess.status === 'connecting') {
      lastStats.current = null
      setStats(null)
      setInfo({})
    }
  }, [sess.status])
  useEffect(() => {
    if (active && lastStats.current) setStats(lastStats.current)
  }, [active])
  useEffect(
    () =>
      window.api.onMonitor((connId, e) => {
        if (connId !== sess.id) return
        if (e.kind === 'stats') {
          lastStats.current = e.stats
          if (activeRef.current) setStats(e.stats)
        } else setInfo((i) => ({ ...i, ...e.info }))
      }),
    [sess.id]
  )

  // AI 도구가 이 연결에서 실행 중인 요청이 있으면 제목줄에 'AI 작업 중' 표시 (기록 화면은 활동 버튼)
  const [aiBusy, setAiBusy] = useState(0)
  useEffect(() => {
    const running = new Set<number>()
    const upd = (a: { id: number; connId: string; status: string; tool: string }) => {
      if (a.connId !== sess.id || a.tool.startsWith('external')) return // 다른 접속의 활동은 AI라고 단정할 수 없어 표시 안 함
      if (a.status === 'running') running.add(a.id)
      else running.delete(a.id)
      setAiBusy(running.size)
    }
    window.api.activityList().then((l) => l.forEach(upd), () => {})
    return window.api.onActivity(upd)
  }, [sess.id])

  // sudo 명령(전원 모드·재부팅)은 터미널에 입력 → 비밀번호를 사용자가 직접 입력
  const runInTerminal = (cmd: string) => {
    if (!sess.activeTerm) return
    terminalRef.current?.expand()
    window.api.writeSession(sess.activeTerm, cmd + '\r')
    xterms.get(sess.activeTerm)?.focus()
  }

  useEffect(() => {
    unsaved.set(sess.id, () => codeRef.current?.dirtyCount() ?? 0)
    return () => void unsaved.delete(sess.id)
  }, [sess.id])
  // 연결되면 SFTP로 홈 폴더 경로를 받아 탐색기 루트로
  useEffect(() => {
    // 홈 경로를 못 받으면 / 에서 시작 (탐색기 오류 문구·파일 찾기가 '불러오는 중'에 멈추지 않게)
    if (sess.status === 'online') window.api.fsHome(sess.id).then(setHome, () => setHome('/'))
  }, [sess.status, sess.id])

  // 탐색기 "터미널에서 이 폴더 열기": 작은따옴표로 감싸 공백·특수문자 경로도 안전하게
  const cdInTerminal = (dir: string) => {
    if (!sess.activeTerm) return
    // 폴더 이름에 Ctrl-C(\x03)·Enter(\r) 같은 제어문자가 있으면 따옴표 밖에서 명령이 실행될 수 있어 거부
    if (/[\x00-\x1f\x7f]/.test(dir)) return void xterms.get(sess.activeTerm)?.write(`\r\n\x1b[33m[${tr('이름에 제어문자가 있는 폴더라 열지 않았어요')}]\x1b[0m\r\n`)
    terminalRef.current?.expand()
    window.api.writeSession(sess.activeTerm, `cd ${shq(dir)}\r`)
    xterms.get(sess.activeTerm)?.focus()
  }

  // 접기/펴기 후 다음 프레임에 실제 상태를 읽어 버튼 선택 표시를 맞춤 (저장된 레이아웃으로 열릴 때도)
  const sync = () => {
    requestAnimationFrame(() =>
      setOpen({ explorer: !explorerRef.current?.isCollapsed(), monitor: !monitorRef.current?.isCollapsed(), full: !!editorRef.current?.isCollapsed() })
    )
  }
  useEffect(sync, [])
  // 분할 화면의 칸이 되면 탐색기·편집기·모니터를 접어 터미널 자리를 확보하고, 칸에서 빠지면 원래 열려 있던 것만 다시 폄
  const before = useRef<{ explorer: boolean; editor: boolean; monitor: boolean } | null>(null)
  useEffect(() => {
    const panels = { explorer: explorerRef.current, editor: editorRef.current, monitor: monitorRef.current }
    if (compact) {
      before.current = { explorer: !panels.explorer?.isCollapsed(), editor: !panels.editor?.isCollapsed(), monitor: !panels.monitor?.isCollapsed() }
      Object.values(panels).forEach((p) => p?.collapse())
    } else if (before.current) {
      for (const k of Object.keys(panels) as (keyof typeof panels)[]) if (before.current[k]) panels[k]?.expand()
      before.current = null
    }
    sync()
  }, [compact])
  // 창이 좁아지면(1100px 미만) 모니터를 한 번 접어 편집기·터미널 자리를 확보. 다시 넓어져도 자동으로 펴지는 않음 (사용자 선택 존중)
  useEffect(() => {
    let wide = true
    const fit = () => {
      const w = innerWidth >= 1100
      if (w === wide) return
      wide = w
      if (!w && !monitorRef.current?.isCollapsed()) {
        monitorRef.current?.collapse()
        sync()
      }
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])
  const toggleSide = (ref: typeof explorerRef) => {
    toggle(ref.current)
    sync()
  }
  // 전체 터미널 모드 = 탐색기·편집기를 접고 터미널을 키움 (모니터는 그대로, design/Session.dc.html 구성)
  const toggleFull = () => {
    const panels = [explorerRef.current, editorRef.current]
    if (open.full) panels.forEach((p) => p?.expand())
    else {
      panels.forEach((p) => p?.collapse())
      terminalRef.current?.expand()
    }
    sync()
  }

  // 터미널 출력 검색·로그 저장 (4.4.0): 지금 선택한 터미널이 대상
  const [termFind, setTermFind] = useState(false)
  const saveTermLog = async () => {
    const t = xterms.get(sess.activeTerm)
    if (!t) return
    const note = (msg: string) => t.write(`
[33m[${msg}][0m
`)
    try {
      const path = await window.api.saveTermLog(toLog(bufferRows(t)), host.name)
      if (path) note(`${tr('터미널 로그를 저장했어요')}: ${path}`)
    } catch (e) {
      note(errText(e))
    }
  }
  const newTerm = (split = false) => {
    const termId = crypto.randomUUID()
    const size = sizes[sess.activeTerm] ?? { cols: 80, rows: 24 }
    onPatch(split ? { terms: [...sess.terms, termId], splitTerm: termId } : { terms: [...sess.terms, termId], activeTerm: termId, splitTerm: undefined })
    return window.api.openTerm(sess.id, termId, size.cols, size.rows).then(
      () => termId,
      (e) => void xterms.get(termId)?.write(`\x1b[33m[${tr('터미널을 열 수 없어요: {0}', errText(e))}]\x1b[0m\r\n`)
    )
  }
  // ROS2 launch: 노드가 모터·카메라 같은 하드웨어를 움직일 수 있어 한 번 확인한 뒤, 새 터미널 탭에서 실행하고 바로 입력할 수 있게 포커스
  const launchInNewTerm = (cmd: string, warn = tr('노드가 모터·카메라 같은 장치를 움직일 수 있어요.')) => {
    if (!confirm(tr('Device에서 실행할까요? {0}\n\n{1}\n\n멈추려면 그 터미널에서 Ctrl+C를 누르세요.', warn, cmd))) return
    setView('code')
    terminalRef.current?.expand()
    newTerm().then((t) => {
      if (!t) return
      window.api.writeSession(t, cmd + '\r')
      setTimeout(() => xterms.get(t)?.focus(), 100) // 새 xterm이 그려진 뒤 포커스
    })
  }
  const closeTerm = (t: string) => {
    window.api.closeTerm(t)
    onPatch(dropTerm(sess, t))
  }

  const saveSnips = (list: Snippet[]) => {
    setSnips(list)
    try {
      localStorage.setItem(SNIP_KEY, JSON.stringify(list))
    } catch {
      /* 저장 실패해도 이번 실행 동안은 사용 가능 */
    }
  }
  // 되돌릴 수 없는 명령(sudo·재부팅·삭제 등)은 한 번 확인. 팔레트에서 열 때도 터미널 패널을 펴 줌
  const runSnippet = (s: Snippet) => {
    if (!sess.activeTerm || (DANGER.test(s.cmd) && !confirm(tr("'{0}'을(를) 실행할까요?\n\n{1}", s.name, s.cmd)))) return
    terminalRef.current?.expand()
    window.api.writeSession(sess.activeTerm, keystrokes(s))
    xterms.get(sess.activeTerm)?.focus()
  }

  // 명령 팔레트 (Ctrl+Shift+P) / 파일 열기 (Ctrl+P). 파일 목록은 처음 열 때 한 번 받아 둠
  const [palette, setPalette] = useState<{ mode: 'cmd' | 'file'; query?: string } | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [actTab, setActTab] = useState<ActTab>('history') // 팔레트로 열 때 처음 보일 활동 탭
  const [centerScreen, setCenterScreen] = useState(false) // 열린 파일이 없을 때 가운데 영역에 Device 화면 표시 (파일을 열면 파일이 가려 줌)
  const [view, setView] = useState<View>('code') // 작업 공간 위에 덮는 화면 (VIEWS)
  const views = VIEWS.filter((v) => v.id !== 'screen' || host.remote === 'vnc') // 앱 안 뷰어는 VNC만 되므로 VNC 연결에만 Device 화면 탭
  const groups = GROUPS.map((g) => ({ ...g, views: g.views.filter((id) => views.some((v) => v.id === id)) })).filter((g) => g.views.length)
  const curGroup = groups.find((g) => g.views.includes(view as never))
  const tabGroup = curGroup && curGroup.views.length > 1 ? curGroup : null // 탭 줄은 화면이 둘 이상인 묶음에서만
  const lastIn = useRef<Record<string, View>>({}) // 묶음을 다시 누르면 마지막에 보던 화면으로
  if (curGroup) lastIn.current[curGroup.id] = view
  const openGroup = (g: (typeof groups)[number]) => setView(curGroup?.id === g.id ? 'code' : (lastIn.current[g.id] ?? g.views[0]))
  const openPalette = (mode: 'cmd' | 'file', query?: string) => {
    setPalette({ mode, query })
    if (mode === 'file' && !files && home) window.api.fsFind(sess.id, home).then(setFiles, () => setFiles([]))
  }
  // 원격 화면: SSH 터널을 열고 mstsc·VNC 뷰어 실행. 뷰어를 못 열면 주소를 알려 줘서 직접 입력하게 함
  const openRemote = async () => {
    try {
      const r = await window.api.remoteOpen(sess.id, host.id)
      if (!r.launched) alert(tr('이 PC에 {0}:// 주소를 열어 줄 뷰어 프로그램이 없어요.\nVNC라면 RealVNC Viewer·TigerVNC 등을 설치한 뒤 다시 누르거나, 뷰어에 직접 입력하세요.\n\n주소: {1}\n(SSH 연결을 닫을 때까지 이 주소가 유지돼요)', host.remote, r.address))
    } catch (e) {
      alert(errText(e))
    }
  }
  // 검색 결과·빌드 오류에서 파일을 그 줄로 열기: 작업 공간으로 돌아와 편집기를 펴고 엶
  const openAt = (path: string, line?: number) => {
    setView('code')
    editorRef.current?.expand()
    codeRef.current?.open(path, line)
  }
  const shortDir = (p: string) => {
    const d = p.slice(0, p.lastIndexOf('/')) || '/'
    return d === home ? '~' : d.startsWith(home + '/') ? '~' + d.slice(home.length) : d
  }
  const reconnect = () => onReconnect(sizes[sess.id]?.cols, sizes[sess.id]?.rows)
  const ask = (msg: string, cmd: string) => () => confirm(msg) && runInTerminal(cmd)

  const openActivity = (t: ActTab) => {
    setActTab(t)
    setView(view === 'activity' && actTab === t ? 'code' : 'activity')
  }

  const commands = (): PaletteItem[] => {
    const modes = info.modes ?? []
    const needLink: PaletteItem[] = [
      ...modes
        .filter((m) => m.id !== info.mode?.id)
        .map((m) => ({
          id: `mode-${m.id}`,
          title: tr('전원 모드 변경: {0}', m.name),
          detail: `sudo nvpmodel -m ${m.id}`,
          run: ask(tr('전원 모드를 바꿀까요? 바꿀 모드: {0}\n터미널에서 sudo 비밀번호를 물어볼 수 있고, 모드에 따라 재부팅을 요청할 수 있어요.', m.name), `sudo nvpmodel -m ${m.id}`)
        })),
      ...(modes.length ? [{ id: 'mode-q', title: tr('전원 모드: 현재 상태 보기'), detail: 'nvpmodel -q', run: () => runInTerminal('nvpmodel -q') }] : []),
      { id: 'suspend', title: tr('Device 절전'), detail: tr('깨우기: 연결 관리 화면'), run: ask(SUSPEND_ASK, suspendCommand(info.wake?.iface)) },
      { id: 'reboot', title: tr('Device 재부팅'), detail: 'sudo reboot', run: ask(tr('Device를 재부팅할까요? 연결이 끊겨요.'), 'sudo reboot') },
      { id: 'poweroff', title: tr('Device 종료'), detail: 'sudo poweroff', run: ask(tr('Device를 종료할까요? 다시 켜려면 전원을 직접 눌러야 해요.'), 'sudo poweroff') },
      { id: 'new-term', title: tr('새 터미널 열기'), shortcut: 'Ctrl+Shift+`', run: () => newTerm() },
      { id: 'split', title: tr('터미널 분할'), run: () => !sess.splitTerm && newTerm(true) },
      { id: 'snip-new', title: tr('스니펫 추가'), run: () => setEditing({ index: null }) },
      { id: 'open-file', title: tr('파일 열기…'), shortcut: 'Ctrl+P', run: () => openPalette('file') },
      ...snips.map((s, i) => ({ id: `snip-${i}`, title: tr('스니펫: {0}', s.name), detail: s.cmd.split('\n')[0], run: () => runSnippet(s) }))
    ]
    // 스니펫 추가·편집은 연결과 상관없이 (스니펫 막대는 '터미널만 크게'에서만 보여서 여기서도 할 수 있게)
    const snipEdit: PaletteItem[] = [
      { id: 'snip-add', title: tr('+ 스니펫 추가'), run: () => setEditing({ index: null }) },
      ...snips.map((s, i) => ({ id: `snip-edit-${i}`, title: tr('스니펫 편집: {0}', s.name), detail: s.cmd.split('\n')[0], run: () => setEditing({ index: i }) }))
    ]
    return [
      ...(online ? needLink : []),
      { id: 'toggle-term', title: tr('터미널 패널 접기/펴기'), shortcut: 'Ctrl+`', run: () => toggle(terminalRef.current) },
      ...(sess.activeTerm ? [{ id: 'term-find', title: tr('터미널 출력 검색'), run: () => setTermFind(true) }, { id: 'term-log', title: tr('터미널 로그 저장…'), run: saveTermLog }] : []),
      { id: 'full', title: open.full ? tr('작업 공간으로 돌아가기') : tr('터미널만 크게'), run: toggleFull },
      ...views.map((v) => ({ id: v.id, title: view === v.id ? tr('작업 공간으로 돌아가기') : v.cmd, run: () => setView(view === v.id ? 'code' : v.id) })),
      { id: 'proc', title: view === 'activity' && actTab === 'proc' ? tr('작업 공간으로 돌아가기') : tr('프로세스 목록 열기'), run: () => openActivity('proc') },
      { id: 'ai', title: view === 'activity' && actTab === 'ai' ? tr('작업 공간으로 돌아가기') : tr('AI 활동 열기'), run: () => openActivity('ai') },
      ...(host.remote && online ? [{ id: 'remote', title: tr('원격 화면 열기 ({0})', host.remote.toUpperCase()), run: openRemote }] : []),
      ...snipEdit,
      { id: 'explorer', title: tr('탐색기 보이기/숨기기'), run: () => toggleSide(explorerRef) },
      { id: 'monitor', title: tr('시스템 모니터 보이기/숨기기'), run: () => toggleSide(monitorRef) },
      ...themeList().map((t) => ({ id: `theme-${t.id}`, title: tr('테마: {0}', themeLabel(t)) + (t.id === currentTheme() ? ' ✓' : ''), detail: tr('{0} 테마', groupOf(t)), run: () => onTheme(t.id) })),
      ...(currentMascot() ? [{ id: 'mascot', title: mascotHidden() ? tr('마스코트 보이기') : tr('마스코트 숨기기'), run: () => setMascotHidden(!mascotHidden()) }] : []),
      sess.status === 'offline' ? { id: 'reconnect', title: tr('다시 연결'), run: reconnect } : { id: 'disconnect', title: tr('연결 해제'), run: onDisconnect },
      { id: 'hosts', title: tr('연결 관리 열기'), run: onHosts },
      { id: 'mcp', title: tr('MCP 연결 열기 (AI 연결)'), run: onMcp },
      { id: 'lang', title: tr('언어 전환 (English / 한국어)'), run: onLang },
      { id: 'guide', title: tr('도움말 (사용 가이드)'), run: onGuide },
      { id: 'news', title: tr('업데이트 내용 보기'), run: onNews }
    ]
  }
  const fileItems = (): PaletteItem[] =>
    (files ?? []).map((p) => ({
      id: p,
      title: p.slice(p.lastIndexOf('/') + 1),
      detail: p.startsWith(home + '/') ? '~' + p.slice(home.length) : p,
      run: () => codeRef.current?.open(p)
    }))

  // 단축키: Ctrl+` 터미널 패널, Ctrl+Shift+` 새 터미널, Ctrl+Shift+P 팔레트, Ctrl+P 파일 열기
  // 캡처 단계에서 가로채 편집기(Monaco)·터미널(xterm)이 같은 키를 처리하지 않게 함
  useEffect(() => {
    if (!active || !focused || palette) return
    const onKey = (e: KeyboardEvent) => {
      // ROS·파일 전송·포트 포워딩 화면은 Esc로 닫고 작업 공간으로 (확인 창이 떠 있을 땐 그 창이 Esc를 받음)
      if (e.key === 'Escape' && view !== 'code' && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        return setView('code')
      }
      if (!e.ctrlKey || (e.code !== 'Backquote' && e.code !== 'KeyP' && !(e.code === 'KeyF' && e.shiftKey))) return
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'KeyF') setView('search')
      else if (e.code === 'KeyP') openPalette(e.shiftKey ? 'cmd' : 'file')
      else if (e.shiftKey) newTerm()
      else toggle(terminalRef.current)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const online = sess.status === 'online'
  const health = useHealth(sess.id, online, host.name)
  const screenProps = { connId: sess.id, hostId: host.id, online, onLaunch: launchInNewTerm, remote: host.remote, onExternal: openRemote }
  const visible = [sess.activeTerm, sess.splitTerm].filter(Boolean)
  const size = sizes[sess.activeTerm]

  return (
    <div
      className={`ws ${compact ? 'ws-compact' : ''}`}
      data-status={sess.status}
      data-focused={focused}
      style={{ display: active ? undefined : 'none', ...paneStyle }}
      onMouseDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <header className="ws-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MascotOr status={sess.status} size={28}>
            <div className="ws-logo">
              <Logo size={15} />
            </div>
          </MascotOr>
          <span className="display" style={{ fontWeight: 600 }}>JetDeck</span>
          <span className="dim">— {host.name}</span>
        </div>
        <button type="button" className="ws-search" onClick={() => openPalette('cmd')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.6" y2="16.6" />
            </svg>
            {tr('명령 또는 파일 검색')}
          </span>
          <kbd>Ctrl+Shift+P</kbd>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ws-badge">
            <span className={`dot ${sess.status}`} style={{ width: 7, height: 7 }} />
            {STATUS_TEXT[sess.status]} · <span className="mono" style={{ fontSize: 12 }}>{host.host}</span>
            {online && sess.ms != null && ` · ${sess.ms} ms`}
          </span>
          {/* 디자인엔 없음: 명령 팔레트(8단계) 전까지 연결 해제/재연결 수단 */}
          {sess.status === 'offline' && (
            <button type="button" className="ws-mini" onClick={reconnect}>{tr('다시 연결')}</button>
          )}
          {aiBusy > 0 && (
            <button type="button" className="ws-mini" onClick={() => setView('activity')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={tr('AI 도구가 이 Device에서 작업 중이에요 (눌러서 활동 보기)')}>
              <span className="dot connecting" style={{ width: 7, height: 7 }} aria-hidden />{tr('AI 작업 중')}
            </button>
          )}
          <button type="button" className="ws-mini" onClick={onMcp}style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={mcp.length ? tr('{0} 연결됨', mcp.join(', ')) : tr('연결된 AI 없음 (눌러서 연결 방법 보기)')}>
            <span className={mcp.length ? 'dot' : 'dot offline'} style={{ width: 7, height: 7 }} aria-hidden />MCP
          </button>
          {compact && <button type="button" className="ws-mini" onClick={onUnsplit} title={tr('이 칸을 분할에서 빼기 (연결은 그대로 유지)')}>{tr('칸 닫기')}</button>}
          <button type="button" className="ws-mini" onClick={onDisconnect}>{sess.status === 'offline' ? tr('닫기') : tr('연결 해제')}</button>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', ['--xf-top' as string]: tabGroup ? '56px' : '0px' }}>
        <nav className="ws-activity" aria-label={tr('활동')}>
          {/* 파일 전송 화면에 있을 때 탐색기를 누르면 작업 공간으로 돌아옴 */}
          <ActBtn icon="explorer" label={tr('탐색기')} selected={view === 'code' && open.explorer} onClick={() => (view !== 'code' ? setView('code') : toggleSide(explorerRef))} />
          <ActBtn icon="hosts" label={tr('연결 관리')} onClick={onHosts} />
          <ActBtn icon="monitor" label={tr('시스템 모니터')} toggle selected={open.monitor} onClick={() => toggleSide(monitorRef)} />
          {groups.map((g) => (
            <ActBtn key={g.id} icon={g.icon} label={g.label} selected={curGroup?.id === g.id} onClick={() => openGroup(g)} />
          ))}
        </nav>
        {tabGroup && (
          <div className="xf-tabs">
            <Segment label={tabGroup.label} value={view} onChange={(v) => setView(v)} options={tabGroup.views.map((id) => ({ value: id, label: views.find((x) => x.id === id)!.label }))} />
          </div>
        )}

        {/* 파일 전송 화면은 작업 공간 위에 덮어서 표시 → 터미널·편집기 상태와 패널 크기가 그대로 유지됨 */}
        <div className="xf-overlay" style={{ display: view === 'forward' ? undefined : 'none' }}>
          <Forward
            rules={rules}
            online={online}
            target={`${host.username}@${host.host}`}
            onAdd={async (r) => {
              try {
                await window.api.fwdAdd(sess.id, host.id, r)
              } finally {
                loadRules() // 시작에 실패해도 규칙은 꺼진 채 저장됨
              }
            }}
            onToggle={async (id, on) => {
              try {
                await window.api.fwdToggle(sess.id, host.id, id, on)
              } finally {
                loadRules()
              }
            }}
            onDelete={(id) => window.api.fwdDelete(sess.id, host.id, id).then(loadRules)}
          />
        </div>
        {/* 검색 결과는 파일을 열러 갔다 와도 남도록 숨기기만 함 */}
        <div className="xf-overlay" style={{ display: view === 'search' ? undefined : 'none' }}>
          <Search connId={sess.id} online={online} home={home} onOpen={openAt} />
        </div>
        {/* 빌드는 오류 줄을 눌러 파일을 열러 갔다 와도 계속 돌고 출력이 남도록 숨기기만 함 */}
        <div className="xf-overlay" style={{ display: view === 'build' ? undefined : 'none' }}>
          <Build connId={sess.id} hostId={host.id} online={online} visible={view === 'build'} home={home} onOpen={openAt} onLaunch={launchInNewTerm} />
        </div>
        {/* ROS2 화면은 열 때만 그림 (닫으면 젯슨 쪽 echo·hz도 끝냄) */}
        {view === 'activity' && (
          <div className="xf-overlay">
            <Activity key={actTab} connId={sess.id} online={online} initialTab={actTab} />
          </div>
        )}
        {view === 'services' && (
          <div className="xf-overlay">
            <Services connId={sess.id} online={online} onLaunch={launchInNewTerm} />
          </div>
        )}
        {view === 'health' && (
          <div className="xf-overlay">
            <HealthView online={online} state={health} />
          </div>
        )}
        {view === 'manage' && (
          <div className="xf-overlay">
            <Manage connId={sess.id} online={online} onLaunch={launchInNewTerm} />
          </div>
        )}
        {view === 'docker' && (
          <div className="xf-overlay">
            <Docker connId={sess.id} online={online} onLaunch={launchInNewTerm} />
          </div>
        )}
        {/* Device 화면·카메라는 보이는 동안만 받음 (다른 기기 탭으로 가면 끊고, 돌아오면 다시 연결) */}
        {view === 'screen' && active && (
          <div className="xf-overlay" style={{ overflow: 'hidden' }}>
            <Screen {...screenProps} />
          </div>
        )}
        {view === 'camera' && active && (
          <div className="xf-overlay" style={{ overflow: 'hidden' }}>
            <Camera connId={sess.id} online={online} />
          </div>
        )}
        {view === 'ros' && (
          <div className="xf-overlay">
            <Ros connId={sess.id} online={online} onLaunch={launchInNewTerm} />
          </div>
        )}
        <div className="xf-overlay" style={{ display: view === 'files' ? undefined : 'none' }}>
          <Files connId={sess.id} online={online} home={home} hostName={host.name} />
        </div>

        <Group id={`ws-${host.id}`} orientation="horizontal" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged} style={{ flex: 1, minWidth: 0 }}>
          <Panel id="explorer" panelRef={explorerRef} defaultSize={240} minSize={160} collapsible collapsedSize={0} className="ws-side">
            <Explorer
              connId={sess.id}
              online={online}
              home={home}
              title={host.name}
              onOpen={(p) => codeRef.current?.open(p)}
              onCd={cdInTerminal}
              onRenamed={(a, b) => codeRef.current?.renamed(a, b)}
              onDeleted={(p) => codeRef.current?.deleted(p)}
            />
            <MascotTip status={sess.status} />
          </Panel>
          <Separator className="ws-sep" />

          <Panel id="center" minSize="30">
            <Group id={`ws-${host.id}-center`} orientation="vertical" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
              <Panel id="editor" panelRef={editorRef} minSize="15" collapsible collapsedSize={0} className="ws-editor">
                <Editor ref={codeRef} connId={sess.id} home={home} onStatus={setEdStatus} onOpened={remember}>
                {/* 가운데 영역의 화면은 작업 공간이 보일 때만 (위에 다른 화면을 덮으면 끊어서 Device 화면이 두 개 연결되지 않게) */}
                {centerScreen ? (
                  <div style={{ height: '100%' }}>
                    {view === 'code' && active && <Screen {...screenProps} onClose={() => setCenterScreen(false)} />}
                  </div>
                ) : (
                <div className="ws-welcome">
                  <Mascot status={sess.status} size={90} />
                  <p className="display" style={{ fontSize: 16, color: 'var(--text)' }}>{tr('열린 파일이 없어요')}</p>
                  <p>{trNode('왼쪽 탐색기에서 파일을 열면 여기에 표시돼요. 저장은 {0}', <kbd>Ctrl+S</kbd>)}</p>
                  <div className="start-grid">
                    <section aria-label={tr('최근 파일')}>
                      <h2>{tr('최근 파일')}</h2>
                      {recent.length === 0 && <p className="dim">{tr('아직 연 파일이 없어요')}</p>}
                      {recent.map((p) => (
                        <button key={p} type="button" className="start-item" title={p} disabled={!online} onClick={() => openAt(p)}>
                          <span className="mono">{p.slice(p.lastIndexOf('/') + 1)}</span>
                          <span className="dim mono">{shortDir(p)}</span>
                        </button>
                      ))}
                    </section>
                    <section aria-label={tr('자주 쓰는 도구')}>
                      <h2>{tr('자주 쓰는 도구')}</h2>
                      <div className="start-tools">
                        <Button size={36} onClick={() => newTerm()} disabled={!online}>{tr('새 터미널')}</Button>
                        <Button size={36} onClick={() => setView('build')}>{tr('빌드 도구')}</Button>
                        <Button size={36} onClick={() => setView('search')}>{tr('파일 검색·바꾸기')}</Button>
                        <Button size={36} onClick={() => setView('ros')}>ROS2</Button>
                        <Button size={36} onClick={() => setView('docker')}>Docker</Button>
                        <Button size={36} onClick={() => setCenterScreen(true)} disabled={!online}>{tr('Device 화면 보기')}</Button>
                      </div>
                    </section>
                    <section aria-label={tr('바로가기')}>
                      <h2>{tr('바로가기')}</h2>
                      <div className="start-keys">
                        <kbd>Ctrl+Shift+P</kbd><span>{tr('명령 팔레트 (모든 기능 검색)')}</span>
                        <kbd>Ctrl+P</kbd><span>{tr('파일 이름으로 찾아 열기')}</span>
                        <kbd>Ctrl+Shift+F</kbd><span>{tr('파일 안의 글자 찾기·바꾸기')}</span>
                        <kbd>Ctrl+`</kbd><span>{tr('터미널 패널 접기/펴기')}</span>
                        <kbd>Ctrl+Shift+`</kbd><span>{tr('새 터미널')}</span>
                      </div>
                    </section>
                  </div>
                </div>
                )}
                </Editor>
              </Panel>
              <Separator className="ws-sep ws-sep-h" />
              <Panel id="terminal" panelRef={terminalRef} defaultSize="35" minSize={120} collapsible collapsedSize={0} className="ws-term">
                <div className="ws-term-head">
                  <div role="tablist" aria-label={tr('터미널')} style={{ display: 'flex', minWidth: 0, overflowX: 'auto' }}>
                    {sess.terms.map((t, i) => (
                      <div key={t} className={`ws-term-tab ${visible.includes(t) ? 'active' : ''}`}>
                        <button type="button" role="tab" aria-selected={t === sess.activeTerm} onClick={() => onPatch({ activeTerm: t, splitTerm: t === sess.splitTerm ? sess.activeTerm : sess.splitTerm })}>
                          {tr('터미널 {0}', i + 1)}{t === sess.splitTerm ? ` ${tr('(분할)')}` : ''}
                        </button>
                        <button type="button" className="ws-term-x" aria-label={tr('터미널 {0} 닫기', i + 1)} onClick={() => closeTerm(t)}>×</button>
                      </div>
                    ))}
                    <button type="button" className="ws-term-tab ws-link" onClick={toggleFull}>
                      {open.full ? tr('작업 공간으로 ↙') : tr('터미널만 크게 ↗')}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button type="button" className="ws-icon-btn" aria-label={tr('새 터미널')} title={tr('새 터미널 (Ctrl+Shift+`)')} disabled={!online} onClick={() => newTerm()}>+</button>
                    <button type="button" className="ws-icon-btn" aria-label={tr('터미널 출력 검색')} title={tr('터미널 출력 검색')} disabled={!sess.activeTerm} onClick={() => setTermFind((v) => !v)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <circle cx="11" cy="11" r="6" />
                        <line x1="16" y1="16" x2="21" y2="21" />
                      </svg>
                    </button>
                    <button type="button" className="ws-icon-btn" aria-label={tr('터미널 로그 저장')} title={tr('터미널 로그 저장…')} disabled={!sess.activeTerm} onClick={saveTermLog}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
                      </svg>
                    </button>
                    <button type="button" className="ws-icon-btn" aria-label={tr('터미널 분할')} title={tr('터미널 분할')} disabled={!online || !!sess.splitTerm || !sess.activeTerm} onClick={() => newTerm(true)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <line x1="12" y1="4" x2="12" y2="20" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="ws-term-body">
                  {sess.terms.map((t) => (
                    <Terminal
                      key={t}
                      id={t}
                      active={active && visible.includes(t)}
                      focus={focused}
                      className={`term-panel ${t === sess.splitTerm ? 'term-split' : ''}`}
                      onResize={(cols, rows) => setSizes((s) => ({ ...s, [t]: { cols, rows } }))}
                    />
                  ))}
                  {termFind && sess.activeTerm && <TermSearch key={sess.activeTerm} id={sess.activeTerm} onClose={() => setTermFind(false)} />}
                  {sess.status === 'connecting' && sess.terms.length > 0 && <div className="ws-connecting" role="status">{tr('{0}에 연결 중…', host.name)}</div>}
                  {sess.terms.length === 0 && (
                    <div className="ws-welcome">
                      <p>{tr('열린 터미널이 없어요')}</p>
                      <button type="button" className="ws-mini" disabled={!online} onClick={() => newTerm()}>{tr('+ 새 터미널')}</button>
                    </div>
                  )}
                </div>

                {open.full && (
                  <div className="ws-quick">
                    <span className="dim" style={{ fontSize: 12, marginRight: 4 }}>{tr('스니펫')}</span>
                    {snips.map((sn, i) => {
                      const del = () => confirm(tr("스니펫 '{0}'을(를) 삭제할까요?", sn.name)) && saveSnips(snips.filter((_, j) => j !== i))
                      return (
                        <button
                          key={i}
                          type="button"
                          className="chip"
                          title={`${sn.cmd}\n\n${tr('클릭: 실행 · 우클릭 또는 F2: 편집 · Delete: 삭제')}`}
                          disabled={!online || !sess.activeTerm}
                          onClick={() => runSnippet(sn)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setEditing({ index: i })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Delete') del()
                            if (e.key === 'F2') setEditing({ index: i })
                          }}
                        >
                          {sn.name}
                        </button>
                      )
                    })}
                    <button type="button" className="btn btn-dashed btn-36" onClick={() => setEditing({ index: null })}>{tr('+ 스니펫 추가')}</button>
                  </div>
                )}
              </Panel>
            </Group>
          </Panel>

          <Separator className="ws-sep" />
          <Panel id="monitor" panelRef={monitorRef} defaultSize={260} minSize={220} collapsible collapsedSize={0} className="ws-side ws-monitor">
            <Monitor stats={stats} info={info} online={online} onRun={runInTerminal} forwards={rules.filter((r) => r.active && r.kind === 'L')} />
          </Panel>
        </Group>
      </div>

      <MascotToast status={sess.status} />
      <footer className="ws-status">
        <div className="ws-status-group">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mascot status={sess.status} size={18} />
            <span className={`dot ${sess.status}`} style={{ width: 7, height: 7 }} />
            {host.name} · {STATUS_TEXT[sess.status]}
          </span>
          {online && info.ros && <span>ROS {info.ros}</span>}
          {online && info.python && <span>Python {info.python}</span>}
        </div>
        <div className="ws-status-group mono">
          {/* 편집기 커서·터미널 크기는 작업 공간(편집기·터미널)이 보일 때만 — ROS·파일 전송·포워딩 화면에선 관계없는 정보 */}
          {view === 'code' && edStatus && !open.full && <span>Ln {edStatus.ln}, Col {edStatus.col}</span>}
          {view === 'code' && size && <span>{size.cols} × {size.rows}</span>}
          <span>UTF-8</span>
          <span>{edStatus?.eol ?? 'LF'}</span>
          {/* 전원 모드 클릭 → 팔레트에 전원 모드 명령만 */}
          {online && info.mode && (
            <button type="button" className="status-btn" title={tr('전원 모드 바꾸기')} onClick={() => openPalette('cmd', tr('전원 모드'))}>
              {info.mode.name}
            </button>
          )}
          {online && stats && (stats.temps.cpu != null || stats.temps.gpu != null) && (
            <span>CPU {stats.temps.cpu != null ? Math.round(stats.temps.cpu) : '-'}°C · GPU {stats.temps.gpu != null ? Math.round(stats.temps.gpu) : '-'}°C</span>
          )}
        </div>
      </footer>

      {editing && (
        <SnippetDialog
          initial={editing.index === null ? null : snips[editing.index]}
          onCancel={() => setEditing(null)}
          onSave={(sn) => {
            saveSnips(editing.index === null ? [...snips, sn] : snips.map((x, j) => (j === editing.index ? sn : x)))
            setEditing(null)
          }}
          onDelete={editing.index === null ? undefined : () => {
            const i = editing.index!
            if (confirm(tr("스니펫 '{0}'을(를) 삭제할까요?", snips[i].name))) saveSnips(snips.filter((_, j) => j !== i))
            setEditing(null)
          }}
        />
      )}
      {palette && (
        <Palette
          key={palette.mode}
          mode={palette.mode}
          initialQuery={palette.query}
          items={palette.mode === 'file' ? fileItems() : commands()}
          loading={palette.mode === 'file' && !files}
          onClose={() => setPalette(null)}
        />
      )}
    </div>
  )
}
