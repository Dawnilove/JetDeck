import { app, ipcMain, shell } from 'electron'
import { tr } from './i18n.mts'
import { spawn } from 'child_process'
import { createServer, type Server } from 'net'
import type { Client } from 'ssh2'
import { forwardOut, pipe } from './forward'
import { buildLaunch, DEFAULT_PORT } from './remotecfg.mts'
import { getClient } from './session'
import { getHost } from './store'

// 원격 화면용 SSH 터널: 내 PC 127.0.0.1의 임의 포트 → 젯슨의 RDP·VNC 포트. 같은 연결·포트면 다시 열지 않고 재사용
// 터널은 SSH 연결이 닫힐 때 함께 닫힘 (뷰어를 닫아도 남아 있지만 127.0.0.1에만 열려 있고 연결이 없으면 자원을 안 씀)
type Tunnel = { client: Client; server: Server; port: number }
const tunnels = new Map<string, Tunnel>() // `${connId}:${젯슨 포트}`

function openTunnel(connId: string, remotePort: number): Promise<number> {
  const client = getClient(connId)
  if (!client) return Promise.reject(new Error(tr('Device에 연결되어 있지 않아요. 연결된 뒤에 눌러 주세요')))
  const key = `${connId}:${remotePort}`
  const old = tunnels.get(key)
  if (old?.client === client) return Promise.resolve(old.port)
  old?.server.close() // 다시 연결되어 연결 객체가 바뀐 경우
  const server = createServer((sock) => {
    sock.on('error', () => {})
    const c = getClient(connId) // 접속할 때마다 현재 연결을 찾음 (재연결해도 같은 터널 사용 가능)
    if (!c) return sock.destroy()
    forwardOut(c, sock, '127.0.0.1', remotePort, (stream) => pipe(sock, stream))
  })
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error(tr('터널을 열 수 없어요: {0}', e.message))))
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      tunnels.set(key, { client, server, port })
      client.once('close', () => {
        server.close()
        if (tunnels.get(key)?.server === server) tunnels.delete(key)
      })
      resolve(port)
    })
  })
}

export type RemoteResult = { address: string; launched: boolean }

export function registerRemoteIpc(): void {
  ipcMain.handle('remote:open', async (_e, connId: string, hostId: string): Promise<RemoteResult> => {
    const h = getHost(String(hostId))
    if (!h?.remote) throw new Error(tr('이 기기에는 원격 화면이 설정되어 있지 않아요 (연결 관리에서 수정)'))
    const remotePort = h.remotePort ?? DEFAULT_PORT[h.remote]
    const [host, port] = h.remoteTunnel === false ? [h.host, remotePort] : ['127.0.0.1', await openTunnel(String(connId), remotePort)]
    const address = `${host}:${port}`
    const l = buildLaunch(h.remote, host, port, process.platform)
    if ('cmd' in l) {
      // mstsc가 없으면(Windows Home 등은 있음, 사실상 항상 있음) 'error' 이벤트로 알려 줌
      await new Promise<void>((resolve, reject) => {
        const p = spawn(l.cmd, l.args, { detached: true, stdio: 'ignore' })
        p.once('error', () => reject(new Error(tr('{0}를 실행할 수 없어요', l.cmd))))
        p.once('spawn', () => (p.unref(), resolve()))
      })
      return { address, launched: true }
    }
    // 처리할 프로그램이 없으면 실패 대신 주소만 돌려줘서 화면이 안내하게 함
    const scheme = l.url.slice(0, l.url.indexOf(':'))
    let handler = ''
    try {
      handler = app.getApplicationNameForProtocol(`${scheme}://`)
    } catch {
      /* 지원하지 않는 OS면 그냥 열어 봄 */
      handler = 'unknown'
    }
    if (!handler) return { address, launched: false }
    await shell.openExternal(l.url)
    return { address, launched: true }
  })
}
