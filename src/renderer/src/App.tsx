import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { HostKeyInfo } from '../../main/ssh'
import type { HostInfo } from '../../main/store'
import type { UpdateState } from '../../main/update'
import Guide, { guideSeen } from './components/Guide'
import WhatsNew from './components/WhatsNew'
import HostKeyDialog from './components/HostKeyDialog'
import { McpApprove, McpSetup, type McpAsk } from './components/McpDialogs'
import Tabs, { MAX_PANES, TAB_DRAG } from './components/Tabs'
import { terms } from './components/Terminal'
import Dashboard from './screens/Dashboard'
import Main from './screens/Main'
import SerialView from './screens/SerialView'
import Workspace, { dropTerm, unsaved, type Sess } from './screens/Workspace'
import { switchLang } from './lang'
import { applyTheme, currentTheme } from './themes'
import { errText, pwBlocked, PW_HELP } from './util'
import { tr } from '../../main/i18n.mts'
import { RELEASES, releasesSince, type Release } from '../../main/changelog.mts'

export default function App() {
  // 호스트 키 질문은 줄 세워 하나씩 (두 곳에 동시에 접속해도 앞의 질문이 묻히지 않게)
  const [hostKeys, setHostKeys] = useState<HostKeyInfo[]>([])
  const hostKey = hostKeys[0] ?? null
  const [update, setUpdate] = useState<UpdateState | null>(null) // 새 버전 알림 (설치판에서만 옴)
  const [asks, setAsks] = useState<McpAsk[]>([])
  const [mcpSetup, setMcpSetup] = useState(false)
  const [sessions, setSessions] = useState<Sess[]>([])
  const [view, setView] = useState('main') // 'main' 또는 세션 id
  // 분할 화면: 같이 보는 SSH 연결들(2~4개)과 배열. view가 그 안의 연결이면 분할로 보이고, 밖의 탭을 고르면 그 연결만 보임
  const [split, setSplit] = useState<{ ids: string[] } | null>(null)
  const [grid, setGrid] = useState(false) // 분할 배열: false = 좌우로 나열, true = 바둑판
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const [theme, setTheme] = useState(currentTheme)
  const [guide, setGuide] = useState(() => !guideSeen()) // 첫 실행이면 사용 가이드부터
  const [news, setNews] = useState<Release[] | null>(null) // 업데이트 내용 창
  // 업데이트 뒤 첫 실행이면 바뀐 점을 보여 줌 (처음 설치·가이드를 막 보는 중이면 조용히 기록만)
  useEffect(() => {
    const KEY = 'jetdeck.lastVersion'
    window.api.appVersion().then((v) => {
      let last: string | null = null
      try {
        last = localStorage.getItem(KEY)
        localStorage.setItem(KEY, v)
      } catch {
        return
      }
      if (last === v || (!last && !guideSeen())) return
      const list = releasesSince(last, v)
      if (list.length) setNews(list)
    }, () => {})
  }, [])
  const changeTheme = (id: string) => {
    applyTheme(id)
    setTheme(id)
  }

  const patch = (id: string, p: Partial<Sess>) => setSessions((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))
  // 연결 상태 안내는 그 세션의 모든 터미널에 노란색 줄로 표시
  const note = (id: string, text: string) =>
    sessionsRef.current.find((x) => x.id === id)?.terms.forEach((t) => terms.get(t)?.write(`\r\n\x1b[33m[${text}]\x1b[0m\r\n`))

  useEffect(() => {
    const offs = [
      // 어느 화면에서 접속하든 호스트 키 확인은 여기서 한 번에 처리
      window.api.onHostKey((k) => setHostKeys((q) => [...q, k])),
      window.api.onUpdate(setUpdate),
      // Claude(MCP) 요청: 위험한 명령 승인은 줄 세워 하나씩, 연결 요청은 그 호스트로 작업 공간 탭을 엶
      window.api.onMcpApprove((a) => setAsks((q) => [...q, a])),
      window.api.onMcpOpen(({ id, hostId }) =>
        window.api.listHosts().then((list) => {
          const h = list.find((x) => x.id === hostId)
          if (h) openRef.current(h, id)
        })
      ),
      window.api.onSessionData((termId, data) => terms.get(termId)?.write(data)),
      // 예기치 않게 끊김 (사용자가 직접 해제하면 이 이벤트가 오지 않음) → 자동 재연결 예약
      window.api.onSessionClosed((id, reason) => {
        patch(id, { status: 'offline' })
        note(id, reason)
        scheduleRetry(id)
      }),
      // exit 등으로 셸이 끝나면 그 탭만 닫음
      window.api.onTermClosed((termId) => setSessions((list) => list.map((s) => (s.terms.includes(termId) ? dropTerm(s, termId) : s))))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // 자동 재연결: 2→4→8→16→30초 간격으로 최대 10번. 인증·호스트 키 문제는 다시 해도 안 되므로 바로 멈춤
  const MAX_RETRY = 10
  const retry = useRef(new Map<string, { n: number; timer: number }>())
  const cancelRetry = (id: string) => {
    clearTimeout(retry.current.get(id)?.timer)
    retry.current.delete(id)
  }
  const scheduleRetry = (id: string) => {
    const s = sessionsRef.current.find((x) => x.id === id)
    if (!s?.host.autoReconnect) return
    const n = (retry.current.get(id)?.n ?? 0) + 1
    if (n > MAX_RETRY) {
      retry.current.delete(id)
      return note(id, tr('자동 재연결을 멈췄어요. Device 상태를 확인하고 "다시 연결"을 눌러 주세요'))
    }
    const sec = Math.min(30, 2 ** n)
    note(id, tr('{0}초 뒤 다시 연결해요 ({1}/{2})', sec, n, MAX_RETRY))
    const timer = window.setTimeout(() => restart(id, true), sec * 1000)
    retry.current.set(id, { n, timer })
  }

  // 터미널 크기는 열려 있는 xterm에서 읽어 넘김 (다시 연결해도 vim·htop 화면 크기가 맞게)
  // extra = 다시 연결할 때 첫 터미널 말고 더 열어 둔 터미널들 → 연결되면 셸을 새로 붙여 탭을 그대로 살림
  const start = (id: string, host: HostInfo, auto = false, extra?: string[]) => {
    patch(id, { status: 'connecting' })
    window.api
      .openSession(id, host.id, terms.get(id)?.cols ?? 120, terms.get(id)?.rows ?? 32)
      .then((info) => {
        patch(id, { status: 'online', ...info })
        for (const t of extra ?? [])
          window.api.openTerm(id, t, terms.get(t)?.cols ?? 80, terms.get(t)?.rows ?? 24).catch((e) => terms.get(t)?.write(`\r\n\x1b[33m[${tr('터미널을 다시 열 수 없어요: {0}', errText(e))}]\x1b[0m\r\n`))
        if (auto) note(id, tr('다시 연결됐어요'))
        // 다시 연결되면 보고 있던 터미널에 바로 입력할 수 있게 포커스 (화면에 보이는 세션일 때만 — 다른 탭 작업을 방해하지 않게)
        const active = terms.get(sessionsRef.current.find((x) => x.id === id)?.activeTerm ?? '')
        if (extra && active?.element?.offsetParent) active.focus()
        retry.current.delete(id)
      })
      .catch((e) => {
        const msg = errText(e)
        if (msg === tr('취소됨')) return
        patch(id, { status: 'offline' })
        note(id, tr('연결 실패: {0}', msg))
        if (pwBlocked(msg)) {
          const help = '\r\n' + tr('해결 방법') + '\r\n' + PW_HELP.map((h) => h.text + (h.cmd ? `\r\n     ${h.cmd}` : '')).join('\r\n') + '\r\n'
          sessionsRef.current.find((x) => x.id === id)?.terms.forEach((t) => terms.get(t)?.write(help))
        }
        if (auto && ![tr('인증 실패: 사용자 이름과 비밀번호/키를 확인하세요'), tr('호스트 키를 확인하지 않아 연결을 취소했어요')].some((k) => msg.includes(k))) scheduleRetry(id)
        else retry.current.delete(id)
      })
  }

  // 다시 연결: 끊기면 main 쪽 셸이 모두 사라지지만 화면의 터미널 탭(지난 출력 포함)은 그대로 두고 셸만 다시 붙임
  // 첫 터미널(id = 세션 id)은 접속과 함께 열리므로, 닫아 두었으면 다시 앞에 추가
  const restart = (id: string, auto = false) => {
    const s = sessionsRef.current.find((x) => x.id === id)
    if (!s) return
    const keep = s.terms.includes(id) ? s.terms : [id, ...s.terms]
    patch(id, { terms: keep, activeTerm: keep.includes(s.activeTerm) ? s.activeTerm : id })
    start(id, s.host, auto, keep.filter((t) => t !== id))
  }

  // id: Claude(MCP)가 연결을 요청하면 main이 정한 id로 열어 연결 완료를 확인할 수 있게
  const open = (host: HostInfo, id: string = crypto.randomUUID()) => {
    setSessions((list) => [...list, { id, host, status: 'connecting', terms: [id], activeTerm: id }])
    setView(id)
    start(id, host)
  }
  const openRef = useRef(open) // 처음 한 번 등록하는 IPC 리스너가 최신 open을 부르도록
  openRef.current = open

  const close = (id: string) => {
    const n = unsaved.get(id)?.() ?? 0
    if (n && !confirm(tr('저장하지 않은 파일이 {0}개 있어요. 연결을 닫으면 변경 내용이 사라져요. 닫을까요?', n))) return
    // 연결된 세션은 실행 중인 명령도 같이 끊기므로 한 번 확인 (이미 끊긴 세션은 바로 닫음)
    const s = sessions.find((x) => x.id === id)
    if (!n && s && s.status !== 'offline' && !confirm(tr("'{0}' 연결을 끊을까요? 터미널에서 실행 중인 명령도 함께 종료돼요.", s.host.name))) return
    cancelRetry(id)
    window.api.closeSession(id)
    const rest = sessions.filter((x) => x.id !== id)
    setSessions(rest)
    const left = (split?.ids ?? []).filter((x) => x !== id)
    setSplit(left.length > 1 && split ? { ...split, ids: left } : null)
    if (view === id) setView((left.length > 1 ? left[0] : undefined) ?? rest.at(-1)?.id ?? 'main')
  }

  // 언어 전환은 화면을 새로 불러오므로 열린 연결·저장 안 한 파일이 있으면 먼저 묻고, 연결을 정리한 뒤 전환
  const changeLang = async () => {
    const n = [...unsaved.values()].reduce((sum, f) => sum + f(), 0)
    const live = sessionsRef.current.length
    if ((n || live) && !confirm(tr('언어를 바꾸면 화면을 다시 불러와요.\n열린 연결 {0}개가 끊기고, 저장하지 않은 파일 {1}개의 변경 내용은 사라져요. 바꿀까요?', live, n))) return
    retry.current.forEach((r) => clearTimeout(r.timer))
    retry.current.clear()
    await Promise.all(sessionsRef.current.map((x) => window.api.closeSession(x.id).catch(() => {})))
    switchLang()
  }

  const tabs = sessions.map((x) => ({ id: x.id, name: x.host.name, status: x.status, splittable: x.host.kind !== 'serial' }))

  const sshIds = sessions.filter((x) => x.host.kind !== 'serial').map((x) => x.id)
  const splitView = !!split && view !== 'main' && split.ids.includes(view)
  const paneIds = splitView ? split.ids : []
  const gridView = splitView && grid
  // 연결을 분할에 넣음: side가 있으면 그쪽 끝에 (끌어다 놓을 때), 분할이 아직 없으면 지금 보는 연결이 첫 칸
  const addPane = (id: string, side: 'start' | 'end' = 'end') => {
    if (!sshIds.includes(id)) return
    const base = split ?? { ids: sshIds.includes(view) ? [view] : [] }
    if (base.ids.includes(id) || base.ids.length >= MAX_PANES) return setView(id)
    const ids = side === 'start' ? [id, ...base.ids] : [...base.ids, id]
    if (ids.length > 1) setSplit({ ...base, ids })
    setView(id)
  }
  // 분할 화면에서 칸 순서(order)와, 바둑판 3칸일 때 마지막 칸이 아래 줄 전체를 쓰게 함
  const paneStyle = (id: string): CSSProperties | undefined => {
    if (!splitView) return undefined
    const i = paneIds.indexOf(id)
    return { order: i, ...(gridView && paneIds.length === 3 && i === 2 ? { gridColumn: '1 / -1' } : {}) }
  }
  const removePane = (id: string) => {
    const ids = (split?.ids ?? []).filter((x) => x !== id)
    setSplit(ids.length > 1 && split ? { ...split, ids } : null)
    if (view === id && ids.length) setView(ids[0])
  }
  const togglePane = (id: string) => (split?.ids.includes(id) ? removePane(id) : addPane(id))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {update && (
        <div className="update-bar" role="status">
          {update.state === 'downloading' ? (
            <span>{tr('새 버전 {0}을(를) 받고 있어요…', update.version)}</span>
          ) : (
            <>
              <span>{tr('새 버전 {0}이(가) 준비됐어요. 다시 시작하면 설치돼요 (안 누르면 다음에 종료할 때 설치).', update.version)}</span>
              <button type="button" className="ws-mini" onClick={() => window.api.installUpdate()}>{tr('다시 시작해서 업데이트')}</button>
            </>
          )}
          <button type="button" className="ws-icon-btn" aria-label={tr('업데이트 알림 닫기')} onClick={() => setUpdate(null)}>×</button>
        </div>
      )}
      {/* 호스트 탭: 여러 젯슨에 접속했을 때, 또는 연결 관리 화면에서 작업 공간으로 돌아갈 때 표시 */}
      {(sessions.length > 1 || (view === 'main' && sessions.length > 0)) &&<Tabs tabs={tabs} activeId={view} onSelect={setView} onClose={close} splitIds={split?.ids ?? []} grid={grid} onToggleSplit={togglePane} onGrid={setGrid} onUnsplit={() => setSplit(null)} onAdd={() => setView('main')} />}
      {view === 'main' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Main
            onConnect={(h) => open(h)}
            theme={theme}
            onTheme={changeTheme}
            onGuide={() => setGuide(true)}
            onNews={() => setNews(RELEASES.slice(0, 1))}
            onMcp={() => setMcpSetup(true)}
            onLang={changeLang}
            top={(hosts) => sessions.length > 0 && <Dashboard hosts={hosts} sessions={sessions} onGo={setView} onConnect={(h) => open(h)} />}
          />
        </div>
      )}
      <div
        className={`panes ${splitView ? 'split' : ''} ${gridView ? 'grid' : ''}`}
        data-n={paneIds.length}
        style={{ display: view === 'main' ? 'none' : undefined }}
        onDragOver={(e) => e.dataTransfer.types.includes(TAB_DRAG) && e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(TAB_DRAG)
          if (!id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          addPane(id, e.clientX < r.left + r.width / 2 ? 'start' : 'end')
        }}
      >
        {sessions.map((s) =>
          s.host.kind === 'serial' ? (
            <SerialView
              key={s.id}
              sess={s}
              active={view === s.id}
              onHosts={() => setView('main')}
              onGuide={() => setGuide(true)}
              onDisconnect={() => close(s.id)}
              onReconnect={() => {
                cancelRetry(s.id)
                restart(s.id)
              }}
            />
          ) : (
          <Workspace
            key={s.id}
            sess={s}
            active={splitView ? paneIds.includes(s.id) : view === s.id}
            focused={view === s.id}
            compact={splitView && paneIds.includes(s.id)}
            paneStyle={paneStyle(s.id)}
            onFocus={() => view !== s.id && setView(s.id)}
            onUnsplit={() => removePane(s.id)}
            onLang={changeLang}
            onPatch={(p) => patch(s.id, p)}
            onGuide={() => setGuide(true)}
            onNews={() => setNews(RELEASES.slice(0, 1))}
            onMcp={() => setMcpSetup(true)}
            onTheme={changeTheme}
            onHosts={() => setView('main')}
            onDisconnect={() => close(s.id)}
            onReconnect={() => {
              cancelRetry(s.id) // 직접 누르면 예약된 자동 재연결은 취소하고 바로 시도
              restart(s.id)
            }}
          />
          )
        )}
      </div>
      {guide && <Guide onClose={() => setGuide(false)} />}
      {news && !guide && <WhatsNew releases={news} onClose={() => setNews(null)} />}
      {mcpSetup && <McpSetup onClose={() => setMcpSetup(false)} />}
      {asks[0] && (
        <McpApprove
          key={asks[0].id}
          ask={asks[0]}
          onAnswer={(ok) => {
            window.api.mcpAnswer(asks[0].id, ok)
            setAsks((q) => q.slice(1))
          }}
        />
      )}
      {hostKey && (
        <HostKeyDialog
          key={hostKey.id}
          info={hostKey}
          onAnswer={(a) => {
            window.api.answerHostKey(hostKey.id, a)
            setHostKeys((q) => q.slice(1))
          }}
        />
      )}
    </div>
  )
}
