import { ipcMain } from 'electron'
import { Socket } from 'net'
import type { Client } from 'ssh2'

// X11 화면(rviz·rqt 등): Device가 여는 X 연결을 이 PC의 X 서버(VcXsrv 등, 127.0.0.1:6000 = 디스플레이 :0)로 중계
// shortcut: 디스플레이 :0 고정 (X 서버를 :1 이상으로 띄우는 경우는 아직 지원 안 함), 인증은 X 서버를 -ac(접근 제어 끔)로 띄운다고 가정
export const X_PORT = 6000

export function relayX11(client: Client): void {
  client.on('x11', (_info, accept, reject) => {
    const xserver = new Socket()
    xserver.on('error', () => reject()) // X 서버가 없으면 그 창만 거부
    xserver.on('connect', () => {
      xserver.removeAllListeners('error')
      xserver.on('error', () => {})
      const ch = accept()
      ch.on('error', () => {})
      ch.pipe(xserver).pipe(ch)
      ch.on('close', () => xserver.destroy())
      xserver.on('close', () => ch.close())
    })
    xserver.connect(X_PORT, '127.0.0.1')
  })
}

// 이 PC에 X 서버가 떠 있는지 (연결 설정 화면의 안내용)
function xServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket()
    const done = (ok: boolean) => (s.destroy(), resolve(ok))
    s.setTimeout(1500, () => done(false))
    s.once('error', () => done(false))
    s.connect(X_PORT, '127.0.0.1', () => done(true))
  })
}

export function registerX11Ipc(): void {
  ipcMain.handle('x11:check', () => xServerUp())
}
