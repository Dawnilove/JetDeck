import { useEffect, useRef, useState } from 'react'
import Button from './Button'
import Segment from './Segment'
import { tr } from '../../../main/i18n.mts'

export type McpAsk = { id: string; host: string; command: string; reason: string; kind?: 'terminal' }

// <dialog>.showModal() 공통: 열고 나서 data-autofocus 버튼으로 포커스 (HostKeyDialog와 같은 방식)
function useModal() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])
  return ref
}

// Claude가 위험한 명령을 실행하려 할 때. 기본 포커스는 '거부', Esc도 거부
export function McpApprove({ ask, onAnswer }: { ask: McpAsk; onAnswer: (ok: boolean) => void }) {
  const ref = useModal()
  return (
    <dialog
      ref={ref}
      className="hk"
      aria-labelledby="mcp-title"
      onCancel={(e) => {
        e.preventDefault()
        onAnswer(false)
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div className="hk-icon warn">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 id="mcp-title" style={{ fontSize: 20, fontWeight: 600 }}>{ask.kind === 'terminal' ? tr('AI가 터미널 화면을 읽으려고 해요') : tr('Claude가 위험할 수 있는 명령을 실행하려고 해요')}</h1>
          <p style={{ lineHeight: 1.6, color: 'var(--text-dim)' }}>
            {ask.kind === 'terminal'
              ? tr('이 터미널의 최근 출력을 AI에게 보내요. 비밀번호·토큰처럼 보이는 값은 가려서 보내지만 완벽하지는 않아요. 허용하면 앱을 닫을 때까지 이 AI 도구는 이 기기의 터미널을 다시 묻지 않고 읽어요. 2분 안에 답하지 않으면 거부돼요.')
              : tr('{0}이 들어 있어요. 내용을 확인하고 괜찮을 때만 허용하세요. 2분 안에 답하지 않으면 거부돼요.', ask.reason)}
          </p>
        </div>
      </div>
      <dl>
        <dt>Device</dt>
        <dd>{ask.host}</dd>
        <dt>{ask.kind === 'terminal' ? tr('읽을 내용') : tr('명령')}</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{ask.command}</dd>
      </dl>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
        <Button style={{ padding: '0 18px' }} data-autofocus onClick={() => onAnswer(false)}>{tr('거부')}</Button>
        <Button variant="warn" style={{ padding: '0 18px' }} onClick={() => onAnswer(true)}>{ask.kind === 'terminal' ? tr('읽기 허용') : tr('실행 허용')}</Button>
      </div>
    </dialog>
  )
}


// 프로그램이 MCP로 보내는 이름(clientInfo.name) → 화면 이름. 모르는 이름은 그대로
const CLIENT_NAMES: Record<string, string> = {
  'claude-ai': 'Claude Desktop',
  'claude-code': 'Claude Code',
  'cursor-vscode': 'Cursor',
  'Visual Studio Code': 'VS Code',
  'codex-mcp-client': 'Codex CLI',
  'gemini-cli-mcp-client': 'Gemini CLI'
}

// 지금 JetDeck에 접속해 있는 MCP 프로그램 이름들 (2초마다 확인). 연결 불·설정 창이 같이 씀
export function useMcpClients(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    const tick = () => window.api.mcpStatus().then((n) => setNames([...new Set(n.map((x) => CLIENT_NAMES[x] ?? x))]), () => {})
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [])
  return names
}

type Ai = 'desktop' | 'code' | 'cursor' | 'vscode' | 'codex' | 'gemini' | 'other'
const AIS: { value: Ai; label: string }[] = [
  { value: 'desktop', label: 'Claude Desktop' },
  { value: 'code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'gemini', label: 'Gemini CLI' },
  { value: 'other', label: tr('기타') }
]
const AI_KEY = 'mcp-ai' // 마지막으로 고른 탭 (다시 열면 그 탭부터)

// MCP 지원 프로그램에 JetDeck을 등록하는 설정 안내 (AI별 탭 + 복사 버튼)
export function McpSetup({ onClose }: { onClose: () => void }) {
  const ref = useModal()
  const clients = useMcpClients()
  const [info, setInfo] = useState<{ command: string; args: string[]; persists: boolean } | null>(null)
  const [ai, setAi] = useState<Ai>(() => AIS.find((a) => a.value === localStorage.getItem(AI_KEY))?.value ?? 'desktop')
  const [copied, setCopied] = useState(false)
  useEffect(() => void window.api.mcpInfo().then(setInfo), [])

  // PowerShell·cmd 둘 다에서 되게 경로를 큰따옴표로
  const q = (s: string) => (s.includes(' ') ? `"${s}"` : s)
  const cli = info && `"${info.command}" ${info.args.map(q).join(' ')}`
  const servers = (key: string, extra: object = {}) => info && JSON.stringify({ [key]: { jetdeck: { ...extra, command: info.command, args: info.args } } }, null, 2)
  const guide: Record<Ai, { desc: string; text: string | null }> = {
    desktop: {
      desc: tr('설정 → 개발자 → 구성 편집으로 claude_desktop_config.json을 열고, 아래 내용을 붙여 넣은 뒤 Claude를 완전히 다시 켜세요. 이미 다른 mcpServers가 있으면 "jetdeck" 항목만 그 안에 추가하세요.'),
      text: servers('mcpServers')
    },
    code: { desc: tr('터미널(PowerShell)에서 한 번 실행하면 모든 프로젝트에서 쓸 수 있어요.'), text: cli && `claude mcp add jetdeck --scope user -- ${cli}` },
    cursor: {
      desc: tr('사용자 폴더의 .cursor\\mcp.json 파일에 붙여 넣고 Cursor를 다시 켜세요. (설정 → MCP 에서 직접 추가해도 돼요.) 이미 다른 mcpServers가 있으면 "jetdeck" 항목만 추가하세요.'),
      text: servers('mcpServers', { type: 'stdio' })
    },
    vscode: {
      desc: tr('VS Code에서 Ctrl+Shift+P → "MCP: Open User Configuration"으로 mcp.json을 열고 붙여 넣으세요. (프로젝트에만 쓰려면 .vscode/mcp.json) 이미 servers가 있으면 "jetdeck" 항목만 추가하세요. Copilot 채팅의 에이전트 모드에서 쓸 수 있어요.'),
      text: servers('servers', { type: 'stdio' })
    },
    codex: { desc: tr('터미널에서 한 번 실행하세요. 등록 뒤 codex 안에서 /mcp 로 확인할 수 있어요.'), text: cli && `codex mcp add jetdeck -- ${cli}` },
    gemini: {
      desc: tr('사용자 폴더의 .gemini\\settings.json에 붙여 넣고 Gemini CLI를 다시 켜세요. 이미 다른 mcpServers가 있으면 "jetdeck" 항목만 추가하세요.'),
      text: servers('mcpServers')
    },
    other: {
      desc: tr('MCP(stdio)를 지원하는 프로그램이면 다음 실행 명령과 인자를 설정에 넣으면 돼요. 이름은 jetdeck 으로 하세요.'),
      text: info && `command: ${info.command}\nargs: ${info.args.join(' ')}`
    }
  }
  const g = guide[ai]
  const copy = () =>
    g.text &&
    navigator.clipboard.writeText(g.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  const pick = (v: Ai) => {
    setAi(v)
    setCopied(false)
    localStorage.setItem(AI_KEY, v)
  }
  return (
    <dialog
      ref={ref}
      className="hk"
      aria-labelledby="mcp-setup-title"
      style={{ margin: '5vh auto auto', maxHeight: '90vh' }} // 위에 고정: 탭마다 높이가 달라도 탭 줄이 움직이지 않게
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 id="mcp-setup-title" style={{ fontSize: 20, fontWeight: 600 }}>{tr('MCP 연결 (Claude · Cursor · Codex 등)')}</h1>
          <p className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {tr('AI가 JetDeck에 저장된 Device에 접속해 명령 실행·파일 읽기/쓰기·상태 확인을 할 수 있어요. rm·sudo·reboot 같은 위험한 명령은 이 화면에서 허용해야 실행돼요.')}
          </p>
        </div>
        <button type="button" className="tab-close" aria-label={tr('닫기')} onClick={onClose}>×</button>
      </div>
      <p style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }} role="status">
        <span className={clients.length ? 'dot' : 'dot offline'} aria-hidden />
        {clients.length ? tr('연결됨: {0}', clients.join(', ')) : tr('아직 연결된 AI가 없어요. 아래 설정을 넣은 프로그램을 다시 켜거나, 그 AI가 JetDeck 도구를 한 번 쓰면 여기에 표시돼요.')}
      </p>
      <Segment options={AIS} value={ai} onChange={pick} label={tr('연결할 AI 선택')} />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{AIS.find((a) => a.value === ai)?.label}</h2>
          <button type="button" className="ws-mini" onClick={copy}>{copied ? tr('복사했어요') : tr('복사')}</button>
        </div>
        <p className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>{g.desc}</p>
        <pre className="hk-code" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{g.text ?? tr('불러오는 중…')}</pre>
      </section>
      <p className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>{tr('JetDeck이 꺼져 있으면 AI가 처음 도구를 쓸 때 자동으로 켜져요. 설치 위치를 옮기면 설정을 다시 복사하세요.')}</p>
      <p className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>{info?.persists
          ? tr('JetDeck을 업데이트하는 동안에도 AI와의 연결은 유지돼요 (AI가 JetDeck이 다시 켜질 때까지 기다려요). 예전 방식(JetDeck.exe)으로 등록했다면 위 설정으로 한 번 다시 등록하세요.')
          : tr('JetDeck을 업데이트할 때 AI와의 연결이 끊길 수 있어요. 끊기면 Claude Code는 /mcp에서 다시 연결하고, Claude Desktop·Cursor 등은 그 프로그램을 다시 켜세요. 연결 불은 다시 연결되면 자동으로 켜져요.')}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" data-autofocus onClick={onClose}>{tr('닫기')}</Button>
      </div>
    </dialog>
  )
}
