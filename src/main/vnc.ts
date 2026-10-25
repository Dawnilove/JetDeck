import { ipcMain, type WebContents } from 'electron'
import type { ClientChannel } from 'ssh2'
import { tr } from './i18n.mts'
import { LiveSet } from './liveset.mts'
import { run } from './monitor'
import { requireClient } from './session'
import { getHost } from './store'
import { makeGuide, parseProbe, probeCmd, VNC_PORT, type Guide } from './vncparse.mts'

// 젯슨 화면 뷰어: 화면의 noVNC가 보내는 바이트를 SSH 연결로 Device의 VNC 포트에 그대로 전달 (내 PC에 포트를 열지 않음)
const streams = new LiveSet<ClientChannel>() // 화면이 정한 id → 연결
const vncPort = (hostId: string) => {
  const h = getHost(String(hostId))
  return h?.remote === 'vnc' && h.remotePort ? h.remotePort : VNC_PORT
}

export function registerVncIpc(): void {
  ipcMain.handle('vnc:open', (e, connId: string, hostId: string, rawId: string) => {
    const id = String(rawId)
    const client = requireClient(connId)
    const port = vncPort(hostId)
    const wc: WebContents = e.sender
    return new Promise<void>((resolve, reject) => {
      streams.begin(id)
      try {
        client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (err, stream) => {
          if (err) return streams.fail(id), reject(new Error(tr('Device의 VNC 포트({0})에 연결하지 못했어요', port)))
          stream.on('error', () => {})
          // 연결하는 중에 화면을 떠났으면 바로 닫음 (터널이 남지 않게)
          if (!streams.attach(id, stream)) return resolve()
          stream.on('data', (d: Buffer) => !wc.isDestroyed() && wc.send('vnc:data', id, d))
          stream.on('close', () => {
            streams.remove(id, stream)
            if (!wc.isDestroyed()) wc.send('vnc:close', id)
          })
          resolve()
        })
      } catch {
        streams.fail(id)
        reject(new Error(tr('Device에 연결되어 있지 않아요'))) // 연결이 막 끊긴 경우 ssh2가 예외를 던짐
      }
    })
  })
  ipcMain.on('vnc:send', (_e, id: string, data: Uint8Array) => {
    streams.get(String(id))?.write(Buffer.from(data))
  })
  ipcMain.on('vnc:close', (_e, id: string) => streams.stop(String(id)))
  // VNC 포트가 닫혀 있을 때 켜는 방법 안내를 만들기 위한 Device 점검 (읽기만 함). 포트는 연결 설정에서 바꾼 값
  ipcMain.handle('vnc:guide', async (_e, connId: string, hostId: string): Promise<Guide> => {
    const port = vncPort(hostId)
    return makeGuide(parseProbe(await run(requireClient(connId), `timeout 15 ${probeCmd(port)}`)), port)
  })
}
