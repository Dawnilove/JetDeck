import { ipcMain, type WebContents } from 'electron'
import type { SerialPort } from 'serialport'
import type { Client, ClientChannel } from 'ssh2'
import { StringDecoder } from 'string_decoder'
import { startSavedForwards } from './forward'
import { relayX11 } from './x11'
import { clearHistory } from './history'
import { startMonitor } from './monitor'
import { startObserver } from './observe'
import { openSerial } from './serial'
import { connect } from './ssh'
import { getHost, isSerial, probe, type Host } from './store'
import { tr } from './i18n.mts'
import { dropTerm, pushTerm } from './termbuf.mts'

// 연결(SSH 클라이언트) 하나에 셸(터미널) 여러 개. 첫 셸의 id = 연결 id
// 시리얼 연결은 client 대신 serial, 터미널은 하나뿐 (SFTP·모니터·포워딩 없음)
type Conn = { wc: WebContents; hostId: string; client?: Client; serial?: SerialPort }
type Stream = Pick<ClientChannel, 'write' | 'close'> & { setWindow?: ClientChannel['setWindow'] }
type Shell = { connId: string; cols: number; rows: number; stream?: Stream }
export type SessionInfo = { hostKeyType: string; ms: number | null }

// id는 화면이 만들어서 넘김 → 접속 전에 터미널을 먼저 띄워 두고 데이터를 받을 수 있음
const conns = new Map<string, Conn>()
const shells = new Map<string, Shell>()
const size = (n: number, max: number) => Math.max(1, Math.min(max, Math.floor(Number(n)) || 1))
const send = (c: Conn, channel: string, ...args: unknown[]) => {
  if (!c.wc.isDestroyed()) c.wc.send(channel, ...args)
}

// SFTP 등 다른 채널이 같은 연결을 쓰도록
export const getClient = (connId: string) => conns.get(connId)?.client
// 화면 요청용: 연결이 없으면 알기 쉬운 오류 (Docker·ROS·카메라·프로세스 등이 같이 씀)
export function requireClient(connId: string): Client {
  const c = getClient(String(connId))
  if (!c) throw new Error(tr('Device에 연결되어 있지 않아요'))
  return c
}

// 연결 하나를 닫음 (화면이 닫기를 눌렀거나 화면이 새로 불러와짐)
function closeConn(id: string): void {
  clearHistory(id)
  const c = conns.get(id)
  conns.delete(id)
  dropShells(id)
  c?.client?.end()
  if (c?.serial?.isOpen) c.serial.close()
}
// 화면이 새로고침(언어 전환 등)되면 그 화면이 열었던 연결은 주인이 없어짐 → 모두 닫아 포워딩 포트·모니터 채널이 남지 않게
export function closeConnsOf(wc: WebContents): void {
  for (const [id, c] of [...conns]) if (c.wc === wc) closeConn(id)
}
// MCP용: 지금 열려 있는 연결 목록 (client가 있으면 연결됨)
// MCP용: 연결의 터미널 id 목록 (열린 순서 = 탭 순서)
export const listShells = (connId: string) => [...shells].filter(([, sh]) => sh.connId === connId).map(([id]) => id)
export const listConns = () => [...conns].map(([id, c]) => ({ id, hostId: c.hostId, online: !!c.client }))

function dropShells(connId: string): void {
  for (const [id, sh] of shells) if (sh.connId === connId) (shells.delete(id), dropTerm(id))
}

// 크기는 접속 중에 들어온 resize도 반영되도록 항목을 먼저 만들어 둠
function shellEntry(termId: string, connId: string, cols: number, rows: number): Shell {
  let sh = shells.get(termId)
  if (!sh) shells.set(termId, (sh = { connId, cols: size(cols, 500), rows: size(rows, 200) }))
  return sh
}

async function openShell(termId: string, sh: Shell): Promise<void> {
  const c = conns.get(sh.connId)
  if (c?.serial) throw new Error(tr('시리얼 연결은 터미널을 하나만 열 수 있어요'))
  if (!c?.client) throw new Error(tr('연결되어 있지 않아요'))
  const client = c.client
  const stream = await new Promise<ClientChannel>((resolve, reject) =>
    client.shell({ term: 'xterm-256color', cols: sh.cols, rows: sh.rows, ...(getHost(c.hostId)?.x11 ? { x11: true } : {}) }, (err, s) => (err ? reject(err) : (s.on('error', () => {}), resolve(s)))) // 채널 오류 리스너 없으면 main이 죽음
  )
  if (shells.get(termId) !== sh) return void stream.close() // 여는 중에 탭을 닫았음
  sh.stream = stream
  stream.setWindow(sh.rows, sh.cols, 0, 0)
  stream.setEncoding('utf8') // 한글이 데이터 조각 경계에서 잘려도 안 깨지게
  stream.on('data', (d: string) => (pushTerm(termId, d), send(c, 'session:data', termId, d)))
  // exit 등으로 셸만 끝나면 그 탭만 닫고 연결은 유지
  // 연결 자체가 끊길 때도 셸 종료가 먼저 올 수 있음 → 잠깐 기다려 연결이 살아 있을 때만 '탭 닫기'로 처리
  // (연결이 끊긴 거면 탭과 터미널 내용을 남겨 두고 자동 재연결에 맡김)
  stream.on('close', () =>
    setTimeout(() => {
      if (shells.get(termId) !== sh || conns.get(sh.connId) !== c) return
      shells.delete(termId)
      dropTerm(termId)
      send(c, 'term:closed', termId)
    }, 300)
  )
}

async function openSerialSession(id: string, c: Conn, sh: Shell, host: Host): Promise<SessionInfo> {
  const port = await openSerial(host.serialPath!, host.baud!)
  if (conns.get(id) !== c) {
    port.close()
    throw new Error(tr('취소됨'))
  }
  c.serial = port
  const dec = new StringDecoder('utf8') // 한글이 데이터 조각 경계에서 잘려도 안 깨지게
  sh.stream = { write: (d: string) => port.write(d), close: () => port.isOpen && port.close() } as Stream
  port.on('data', (b: Buffer) => {
    const t = dec.write(b)
    pushTerm(id, t)
    send(c, 'session:data', id, t)
  })
  const end = (reason: string) => {
    if (conns.get(id) !== c) return
    conns.delete(id)
    dropShells(id)
    send(c, 'session:closed', id, reason)
    if (port.isOpen) port.close()
  }
  port.on('error', (err) => end(tr('시리얼 오류: {0}', err.message)))
  port.on('close', () => end(tr('시리얼 포트가 닫혔어요. USB 케이블을 확인하세요')))
  return { hostKeyType: '', ms: null }
}

export function registerSessionIpc(): void {
  ipcMain.handle('session:open', async (e, id: string, hostId: string, cols: number, rows: number): Promise<SessionInfo> => {
    const host = getHost(hostId)
    if (!host) throw new Error(tr('저장된 호스트를 찾을 수 없어요'))
    const c: Conn = { wc: e.sender, hostId: String(hostId) }
    conns.set(id, c)
    const sh = shellEntry(id, id, cols, rows)
    try {
      if (isSerial(host)) return await openSerialSession(id, c, sh, host)
      const { client, hostKeyType } = await connect(e.sender, host)
      if (conns.get(id) !== c) {
        // 접속 중에 닫았음
        client.end()
        throw new Error(tr('취소됨'))
      }
      c.client = client
      const end = (reason: string) => {
        if (conns.get(id) !== c) return
        conns.delete(id)
        dropShells(id)
        send(c, 'session:closed', id, reason)
        client.end()
      }
      // 접속 후 생기는 오류(keepalive 실패 등)에 리스너가 없으면 main 프로세스가 죽음
      client.on('error', (err) => end(tr('연결 오류: {0}', err.message)))
      client.on('close', () => end(tr('연결이 끊겼어요')))
      if (host.x11) relayX11(client)
      await openShell(id, sh)
      startMonitor(id, host.id, client, e.sender)
      startObserver(id, host.name, client, e.sender)
      startSavedForwards(id, host.id, client, e.sender)
      // shortcut: 지연 시간은 접속 직후 TCP 응답 1회만 측정, 주기 측정은 모니터(7단계) 때 검토
      return { hostKeyType, ms: await probe(host.host, host.port) }
    } catch (err) {
      if (conns.get(id) === c) {
        conns.delete(id)
        dropShells(id)
        c.client?.end()
        if (c.serial?.isOpen) c.serial.close()
      }
      throw err
    }
  })

  // 같은 연결에 새 셸 추가 (새 터미널 / 분할)
  ipcMain.handle('term:open', (_e, connId: string, termId: string, cols: number, rows: number) =>
    openShell(termId, shellEntry(termId, connId, cols, rows)).catch((err) => {
      shells.delete(termId)
      throw err
    })
  )

  ipcMain.on('session:write', (_e, termId: string, data: string) => {
    shells.get(termId)?.stream?.write(String(data))
  })

  // 터미널 창 크기가 바뀌면 젯슨 쪽 PTY에도 알려야 vim·htop 화면이 맞게 그려짐
  ipcMain.on('session:resize', (_e, termId: string, cols: number, rows: number) => {
    const sh = shells.get(termId)
    if (!sh) return
    sh.cols = size(cols, 500)
    sh.rows = size(rows, 200)
    sh.stream?.setWindow?.(sh.rows, sh.cols, 0, 0)
  })

  ipcMain.handle('term:close', (_e, termId: string) => {
    const sh = shells.get(termId)
    shells.delete(termId)
    dropTerm(termId)
    sh?.stream?.close()
  })

  ipcMain.handle('session:close', (_e, id: string) => closeConn(String(id)))
}
