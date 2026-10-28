import { app, BrowserWindow, ipcMain, Notification, type WebContents } from 'electron'
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { track } from './activity'
import { exitStatus, redact, type ToolResult } from './activitylog.mts'
import { tr } from './i18n.mts'
import { dangerous } from './danger.mts'
import { checkInitialAutopilot, isAutopilot, loadAutopilotConfig, requiresApproval, saveAutopilotConfig, setAutopilot } from './autopilot.mts'
import { latest } from './monitor'
import { getClient, listConns, listShells } from './session'
import { call, listDir, readText, sftpOf, writeText } from './sftp'
import { isSerial, listHosts } from './store'
import { cleanTerm, rawTerm, tailLines } from './termbuf.mts'

// Claude(MCP) 연결: 켜 둔 JetDeck이 127.0.0.1에만 작은 HTTP 서버를 열고, `JetDeck.exe --mcp` 브리지(mcp-bridge.ts)가
// Claude의 stdio 요청을 여기로 넘김. 주소·토큰은 사용자 폴더의 mcp.json (같은 Windows 계정만 읽을 수 있는 위치)
// 보통은 %APPDATA%가 아닌 홈 폴더(~/.jetdeck)에 둠: Microsoft Store판 Claude Desktop 안에서 도는 브리지는 %APPDATA%를 가짜 복사본으로 보고
// 옛 값을 읽어 JetDeck을 못 찾았음. --user-data-dir로 따로 켠 시험용 실행은 그 폴더 안에 둬서 실제 앱과 섞이지 않게 함
export const mcpFile = () => (app.commandLine.hasSwitch('user-data-dir') ? join(app.getPath('userData'), 'mcp.json') : join(app.getPath('home'), '.jetdeck', 'mcp.json'))
// 포터블판·AppImage는 임시 폴더에 풀려 실행되므로 원래 파일 경로를 씀 (electron-builder가 넣어 주는 환경 변수)
export const appExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath

export const INSTRUCTIONS =
  'JetDeck에 저장된 Device(NVIDIA Jetson 등)에 SSH로 접속해 명령 실행·파일 읽기/쓰기·상태 확인을 합니다. 먼저 list_hosts로 호스트를 보고, 연결이 없으면 connect를 호출하세요. 위험한 명령은 사용자가 JetDeck 화면에서 허용해야 실행됩니다 (오토파일럿 모드 활성화 시 자동 허용).'

export const TOOLS = [
  { name: 'list_hosts', description: 'JetDeck에 저장된 Device 호스트 목록과 지금 연결 상태', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'connect',
    description: '저장된 호스트에 연결 (이미 연결돼 있으면 그 세션을 돌려줌). JetDeck 화면에 작업 공간 탭이 열림',
    inputSchema: { type: 'object', properties: { host: { type: 'string', description: '호스트 이름 또는 IP' } }, required: ['host'] }
  },
  {
    name: 'run_command',
    description:
      '연결된 Device에서 셸 명령을 실행하고 출력(stdout·stderr)과 종료 코드를 돌려줌. 대화형 명령(vim, top)은 안 됨. rm·sudo·reboot 같은 위험한 명령은 JetDeck 화면에서 사용자가 허용해야 실행됨 (오토파일럿 모드 활성화 시 자동 허용)',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        session: { type: 'string', description: '세션 id 또는 호스트 이름. 연결이 하나뿐이면 생략 가능' },
        timeout_sec: { type: 'number', description: '기본 60, 최대 600' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Device의 텍스트 파일 읽기 (UTF-8, 5MB 이하). ~ 는 홈 폴더',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, session: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    description: 'Device에 텍스트 파일 쓰기 (있으면 덮어씀, 원자적 저장). ~ 는 홈 폴더',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, session: { type: 'string' } }, required: ['path', 'content'] }
  },
  {
    name: 'list_dir',
    description: 'Device 폴더의 파일 목록 (기본: 홈 폴더)',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, session: { type: 'string' } } }
  },
  {
    name: 'read_terminal',
    description:
      'JetDeck에 열려 있는 터미널 탭의 최근 출력을 읽음 (비밀번호·토큰처럼 보이는 값은 가려서 줌). 처음 읽을 때 사용자가 JetDeck 화면에서 허용해야 함. 터미널이 여러 개면 terminal(1부터, 탭 순서)을 지정',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        terminal: { type: 'number', description: '터미널 번호 (1부터, 탭 순서). 하나뿐이면 생략 가능' },
        lines: { type: 'number', description: '마지막 몇 줄 (기본 100, 최대 500)' }
      }
    }
  },
  {
    name: 'get_status',
    description: '젯슨 시스템 상태: CPU 코어별 사용률, GPU, 메모리, 온도, 소비 전력, 전원 모드, 디스크, ROS·Python 버전 (tegrastats)',
    inputSchema: { type: 'object', properties: { session: { type: 'string' } } }
  }
] as const

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const OUT_MAX = 100_000 // Claude에게 돌려줄 출력 최대 글자 수
// MCP는 SSH로 명령을 실행하는 용도라 시리얼 호스트는 뺌
const sshHosts = () => listHosts().filter((h) => !isSerial(h))

// 접속한 MCP 프로그램(브리지 pid → 이름). 브리지가 살아 있는 동안만 "연결됨"
const clients = new Map<number, string>()
const alive = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch {
    return false
  }
}

let wc: WebContents | null = null
const waits = new Map<string, (ok: boolean) => void>()

// 세션 고르기: id → 호스트 이름/IP → 연결이 하나뿐이면 그것
function pick(session: unknown): string {
  const online = listConns().filter((c) => c.online)
  const hosts = sshHosts()
  const s = str(session)
  const byName = (id: string) => hosts.find((h) => h.id === id)
  const hit = s ? online.find((c) => c.id === s || byName(c.hostId)?.name === s || byName(c.hostId)?.host === s) : online.length === 1 ? online[0] : undefined
  if (hit) return hit.id
  if (!online.length) throw new Error('연결된 Device가 없어요. connect 도구로 먼저 연결하세요')
  throw new Error(`세션을 골라 주세요: ${online.map((c) => `${byName(c.hostId)?.name ?? c.hostId} (${c.id})`).join(', ')}`)
}

// ~ 를 홈 폴더로
async function abs(connId: string, path: string): Promise<string> {
  if (!path || path === '~') {
    const s = await sftpOf(connId)
    return call<string>((cb) => s.realpath('.', cb))
  }
  if (path.startsWith('~/')) return (await abs(connId, '~')).replace(/\/$/, '') + path.slice(1)
  return path
}

export const autopilotFile = () => join(dirname(mcpFile()), 'autopilot.json')
export const loadAutopilotState = (): boolean =>
  loadAutopilotConfig(autopilotFile(), process.env, (sw) => app?.commandLine?.hasSwitch(sw))
export const saveAutopilotState = (enabled: boolean): void => saveAutopilotConfig(autopilotFile(), enabled)

// 승인 팝업이 뜰 때 사용자에게 OS 데스크톱 알림(소리 및 토스트) 발송
function notifyApproval(host: string, command: string, reason: string, kind?: 'terminal'): Notification | null {
  try {
    if (!Notification.isSupported()) return null
    const isTerm = kind === 'terminal'
    const title = isTerm ? tr('AI 터미널 읽기 승인 필요') : tr('JetDeck 명령 실행 승인 필요')
    const body = isTerm
      ? tr('{0} 기기의 터미널 화면 읽기 요청', host)
      : reason
        ? tr('{0} ({1}): {2}', host, reason, command)
        : tr('{0}: {1}', host, command)

    // Windows Toast XML은 PNG/JPEG 형식을 권장함 (ico는 Windows 알림 센터에서 누락될 수 있음)
    const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
    const notif = new Notification({
      title,
      body: body.length > 250 ? body.slice(0, 250) + '…' : body,
      icon: existsSync(iconPath) ? iconPath : undefined,
      silent: false
    })

    notif.on('click', () => {
      if (wc && !wc.isDestroyed()) {
        const win = BrowserWindow.fromWebContents(wc)
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
          try {
            win.flashFrame(false)
          } catch {}
        }
      }
      try {
        notif.close()
      } catch {}
    })

    notif.show()
    return notif
  } catch (e) {
    console.error('승인 요청 데스크톱 알림 표시 실패:', (e as Error).message)
    return null
  }
}

// 위험한 명령: 화면에 승인 창을 띄우고 답을 기다림 (2분 안에 답이 없으면 거부)
// 오토파일럿 모드가 켜져 있으면 대화형 승인 창 및 데스크톱 알림 없이 즉시 승인(true)
function approve(host: string, command: string, reason: string, kind?: 'terminal'): Promise<boolean> {
  if (isAutopilot()) return Promise.resolve(true)
  if (!wc || wc.isDestroyed()) return Promise.resolve(false)
  const id = randomUUID()
  wc.send('mcp:approve', { id, host, command, reason, kind })
  const notif = notifyApproval(host, command, reason, kind)
  const win = BrowserWindow.fromWebContents(wc)
  try {
    win?.flashFrame(true)
  } catch {}
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(t)
      waits.delete(id)
      try {
        notif?.close()
      } catch {}
      try {
        win?.flashFrame(false)
      } catch {}
      resolve(ok)
    }
    const t = setTimeout(() => finish(false), 120_000)
    waits.set(id, finish)
  })
}


// 화면이 새로 불러와지면 승인 창이 사라지므로 기다리던 요청은 거부로 끝냄
export function cancelApprovals(): void {
  for (const answer of [...waits.values()]) answer(false)
}

function exec(connId: string, command: string, timeoutSec: number): Promise<ToolResult> {
  const client = getClient(connId)
  if (!client) throw new Error('연결이 끊겼어요')
  return new Promise((resolve, reject) =>
    client.exec(command, (err, ch) => {
      if (err) return reject(err)
      let out = ''
      let errOut = ''
      const cut = (s: string) => (s.length > OUT_MAX ? s.slice(0, OUT_MAX) + `\n…(${s.length - OUT_MAX}자 생략)` : s)
      const timer = setTimeout(() => {
        errOut += `\n[${timeoutSec}초가 지나 중단했어요]`
        ch.close()
      }, timeoutSec * 1000)
      ch.on('error', () => {})
      ch.on('data', (d: Buffer) => out.length <= OUT_MAX && (out += d.toString('utf8')))
      ch.stderr.on('data', (d: Buffer) => errOut.length <= OUT_MAX && (errOut += d.toString('utf8')))
      ch.on('close', (code: number | null) => {
        clearTimeout(timer)
        resolve({ text: `종료 코드: ${code ?? '없음'}\n--- stdout ---\n${cut(out)}${errOut ? `\n--- stderr ---\n${cut(errOut)}` : ''}`, status: exitStatus(code) })
      })
    })
  )
}

async function connectHost(target: string): Promise<string> {
  const h = sshHosts().find((x) => x.name === target || x.host === target || x.id === target)
  if (!h) throw new Error(`저장된 호스트가 없어요: ${target}. list_hosts로 이름을 확인하세요`)
  const already = listConns().find((c) => c.hostId === h.id && c.online)
  if (already) return `이미 연결돼 있어요 · 세션 ${already.id}`
  if (!wc || wc.isDestroyed()) throw new Error('JetDeck 창이 없어요')
  const id = randomUUID()
  wc.send('mcp:open', { id, hostId: h.id }) // 화면이 작업 공간 탭을 열고 접속 (호스트 키 확인도 화면에서)
  // 최대 60초 (호스트 키 확인을 사용자가 누르는 시간 포함)
  let seen = false
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 300))
    if (getClient(id)) return `연결됐어요 · 세션 ${id} (${h.name} ${h.host})`
    const exists = listConns().some((c) => c.id === id)
    if (seen && !exists) break // 접속 실패로 연결 항목이 사라짐
    seen ||= exists
  }
  throw new Error(`'${h.name}'에 연결하지 못했어요. JetDeck 화면의 터미널에 이유가 표시돼요`)
}

// 기록에 쓸 연결·기기 이름 (찾지 못하면 비움)
function targetOf(name: string, a: Args): { connId: string; host: string } {
  if (name === 'connect') return { connId: '', host: str(a.host) }
  if (name === 'list_hosts') return { connId: '', host: '' }
  try {
    const connId = pick(a.session)
    const hostId = listConns().find((c) => c.id === connId)?.hostId
    return { connId, host: sshHosts().find((h) => h.id === hostId)?.name ?? '' }
  } catch {
    return { connId: '', host: str(a.session) }
  }
}
// 요청을 보낸 AI 도구 이름: 연결 프로그램이 보낸 pid로 찾고, 옛 연결 프로그램(pid 없음)은 접속한 도구가 하나뿐일 때만 그것으로 봄
const clientOf = (pid: unknown) => clients.get(Number(pid)) ?? (clients.size === 1 ? [...clients.values()][0] : tr('AI 도구'))

// 상태(status)를 따로 알려 주는 것은 run_command뿐, 나머지는 결과 글자만
async function runTool(name: string, a: Args, client = ''): Promise<ToolResult> {
  const text = await toolText(name, a, client)
  return typeof text === 'string' ? { text } : text
}

// 터미널 읽기를 이미 허용한 'AI 도구|연결' 조합 (앱을 닫으면 초기화)
const termOk = new Set<string>()

async function toolText(name: string, a: Args, client: string): Promise<string | ToolResult> {
  switch (name) {
    case '__hello': // 브리지가 접속을 알림 (TOOLS에는 없음)
      clients.set(Number(a.pid), str(a.client).slice(0, 40) || 'MCP')
      return 'ok'
    case 'list_hosts': {
      const conns = listConns()
      return JSON.stringify(
        sshHosts().map((h) => ({ name: h.name, host: h.host, port: h.port, user: h.username, sessions: conns.filter((c) => c.hostId === h.id).map((c) => ({ id: c.id, online: c.online })) })),
        null,
        1
      )
    }
    case 'connect':
      return connectHost(str(a.host))
    case 'run_command': {
      const id = pick(a.session)
      const command = str(a.command).trim()
      if (!command) throw new Error('command가 비어 있어요')
      const reason = dangerous(command)
      if (reason && requiresApproval(command)) {
        const host = sshHosts().find((h) => h.id === listConns().find((c) => c.id === id)?.hostId)?.name ?? id
        if (!(await approve(host, command, reason))) return { text: `사용자가 실행을 허용하지 않았어요 (${reason}). 이 명령은 실행되지 않았어요`, status: 'denied' }
      }
      return exec(id, command, Math.min(600, Math.max(1, Number(a.timeout_sec) || 60)))
    }
    case 'read_file': {
      const id = pick(a.session)
      const r = await readText(id, await abs(id, str(a.path)))
      return r.text.length > OUT_MAX ? r.text.slice(0, OUT_MAX) + `\n…(${r.text.length - OUT_MAX}자 생략)` : r.text
    }
    case 'write_file': {
      const id = pick(a.session)
      const path = await abs(id, str(a.path))
      await writeText(id, path, str(a.content), null, true)
      return `저장했어요: ${path}`
    }
    case 'list_dir': {
      const id = pick(a.session)
      const dir = await abs(id, str(a.path))
      const list = await listDir(id, dir)
      return `${dir}\n` + list.map((e) => `${e.dir ? 'd' : '-'} ${e.perm.padEnd(10)} ${String(e.size).padStart(10)}  ${e.name}${e.dir ? '/' : ''}`).join('\n')
    }
    case 'read_terminal': {
      const id = pick(a.session)
      const ids = listShells(id)
      if (!ids.length) throw new Error('열린 터미널이 없어요')
      if (a.terminal === undefined && ids.length > 1) throw new Error(`터미널을 골라 주세요 (terminal: 1~${ids.length})`)
      const n = a.terminal === undefined ? 1 : Math.floor(Number(a.terminal))
      const tid = ids[n - 1]
      if (!tid) throw new Error(`터미널 ${n}번이 없어요 (1~${ids.length})`)
      const key = `${client}|${id}`
      if (!termOk.has(key)) {
        const host = sshHosts().find((h) => h.id === listConns().find((c) => c.id === id)?.hostId)?.name ?? id
        if (!(await approve(host, tr('터미널 {0}번의 최근 출력', n), '', 'terminal'))) return { text: '사용자가 터미널 읽기를 허용하지 않았어요. 터미널 내용은 전달되지 않았어요', status: 'denied' }
        termOk.add(key)
      }
      return redact(tailLines(cleanTerm(rawTerm(tid)), Number(a.lines) || 100)) || '(터미널 출력이 비어 있어요)'
    }
    case 'get_status': {
      const id = pick(a.session)
      const l = latest.get(id)
      if (!l?.stats && l?.info.tegrastats === false) return 'tegrastats가 없는 기기예요 (Jetson이 아닐 수 있어요)\n' + JSON.stringify(l.info)
      return JSON.stringify({ stats: l?.stats ?? '아직 받는 중', ...l?.info }, null, 1)
    }
  }
  throw new Error(`없는 도구예요: ${name}`)
}

export function startMcp(target: WebContents): void {
  wc = target
  setAutopilot(loadAutopilotState())
  if (!wc.isDestroyed()) wc.send('mcp:autopilot', isAutopilot())
  const token = randomBytes(24).toString('hex')
  const server = createServer((req, res) => {
    const done = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    // 브라우저(웹페이지)가 보내는 요청은 Origin이 붙음 → 거부. 토큰은 시간 차 공격을 막는 비교로 확인
    const auth = Buffer.from(String(req.headers.authorization ?? ''))
    const want = Buffer.from(`Bearer ${token}`)
    if (req.method !== 'POST' || req.url !== '/call' || req.headers.origin || auth.length !== want.length || !timingSafeEqual(auth, want)) return done(403, { error: '거부됨' })
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > 20_000_000) req.destroy() // write_file 내용 포함 20MB까지
    })
    req.on('end', async () => {
      try {
        const { name, arguments: a, pid } = JSON.parse(body)
        const args = (a ?? {}) as Args
        const tool = String(name)
        // 연결 알림(__hello)은 기록하지 않고, 나머지 도구 요청은 AI 활동 기록에 남김
        const text = tool.startsWith('__') ? (await runTool(tool, args)).text : await track(wc, { tool, args, client: clientOf(pid), ...targetOf(tool, args) }, () => runTool(tool, args, clientOf(pid)))
        done(200, { text })
      } catch (e) {
        done(200, { text: (e as Error).message, isError: true })
      }
    })
  })
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port
    // 쓰기가 한 번 실패하거나 파일이 옛 값으로 남아도 브리지가 이 앱을 찾도록, 5초마다 내용이 다르면 다시 씀
    const info = JSON.stringify({ port, token, pid: process.pid })
    const sync = () => {
      try {
        if (!existsSync(mcpFile()) || readFileSync(mcpFile(), 'utf8') !== info) {
          mkdirSync(dirname(mcpFile()), { recursive: true, mode: 0o700 })
          writeFileSync(mcpFile(), info, { mode: 0o600 })
        }
      } catch (e) {
        console.error('mcp.json 쓰기 실패:', (e as Error).message)
      }
    }
    sync()
    ensureBridgeFiles()
    setInterval(sync, 5000).unref()
  })
}

// Windows: AI가 실행할 PowerShell 연결 프로그램(resources/mcp-bridge.ps1)을 최신으로 ~/.jetdeck에 둠.
// JetDeck.exe가 아니라서 업데이트 설치 때 종료되지 않아 AI 연결이 유지됨. 도구 목록·안내문은 이 파일에 박아 넣음
export const bridgeScript = () => join(dirname(mcpFile()), 'mcp-bridge.ps1')
export function ensureBridgeFiles(): void {
  if (process.platform !== 'win32') return
  try {
    const dir = dirname(mcpFile())
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const src = readFileSync(join(app.getAppPath(), 'resources', 'mcp-bridge.ps1'), 'utf8')
      .replace('__TOOLS_JSON__', () => JSON.stringify(TOOLS))
      .replace('__INSTRUCTIONS__', () => INSTRUCTIONS)
    const text = '\ufeff' + src.replace(/\r?\n/g, '\r\n') // BOM이 있어야 Windows PowerShell 5.1이 한글을 바르게 읽음
    if (!existsSync(bridgeScript()) || readFileSync(bridgeScript(), 'utf8') !== text) writeFileSync(bridgeScript(), text)
    const exe = JSON.stringify({ exe: appExe() })
    const f = join(dir, 'app.json')
    if (!existsSync(f) || readFileSync(f, 'utf8') !== exe) writeFileSync(f, exe)
  } catch (e) {
    console.error('MCP 연결 프로그램 파일 쓰기 실패:', (e as Error).message)
  }
}

export function registerMcpIpc(): void {
  ipcMain.on('mcp:answer', (_e, id: string, ok: boolean) => waits.get(String(id))?.(ok === true))
  // Claude 설정에 넣을 실행 명령: 설치판은 JetDeck.exe --mcp, 개발 중엔 electron.exe <앱 폴더> --mcp
  // 포터블판은 임시 폴더에 풀려 실행되므로 원래 exe 경로(PORTABLE_EXECUTABLE_FILE, electron-builder가 넣어 줌)를 씀
  ipcMain.handle('mcp:status', (): string[] => {
    for (const pid of clients.keys()) if (!alive(pid)) clients.delete(pid)
    return [...new Set(clients.values())]
  })
  ipcMain.handle('mcp:info', () => {
    if (process.platform === 'win32') {
      ensureBridgeFiles()
      return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridgeScript()], persists: true }
    }
    return { command: appExe(), args: app.isPackaged ? ['--mcp'] : [app.getAppPath(), '--mcp'], persists: false }
  })
  ipcMain.handle('mcp:get-autopilot', (): boolean => isAutopilot())
  ipcMain.handle('mcp:set-autopilot', (_e, enabled: boolean): boolean => {
    const next = setAutopilot(enabled === true)
    saveAutopilotState(next)
    if (wc && !wc.isDestroyed()) wc.send('mcp:autopilot', next)
    return next
  })
}
