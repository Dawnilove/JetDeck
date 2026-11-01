// 팩 터널의 이 PC 쪽 (6.0.0, 설계안 §2-5): 127.0.0.1에만 서버를 열고 들어온 연결을 connect()로 넘긴다. 로컬 포워딩(L)만, 시간 제한, 정지하면 열린 연결까지 모두 닫는다.
// SSH는 모른다 (connect가 forward.ts의 forwardOut·pipe로 Device에 이음). Electron 없이 시험 (packappcore.test.mts)
import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'

export const TUNNEL_HOST = '127.0.0.1'
const MAX_SOCKETS = 32 // 한 터널에 동시에 열 수 있는 연결 수 (폭주 방지)

// 빈 포트 하나를 골라 번호만 돌려줌. 확인 창에 보여 줄 번호를 정하는 용도이고 서버는 닫는다 (확인 전에는 아무것도 열려 있지 않음)
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, TUNNEL_HOST, () => {
      const port = (s.address() as AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

export type TunnelHandle = { port: number; endsAt: number; stop: (why?: string) => void }
export type TunnelOptions = {
  port: number // 확인 창에서 보여 준 번호. 그 사이 다른 프로그램이 썼으면 새 빈 번호로 바뀜
  ms: number // 열어 둘 시간
  connect: (sock: Socket) => void // 들어온 연결을 Device로 이음
  onEnd: (why: string) => void // 닫힘 (stop·timeout·error). 한 번만 불림
}

export function listenTunnel(o: TunnelOptions): Promise<TunnelHandle> {
  const sockets = new Set<Socket>()
  let timer: NodeJS.Timeout | undefined
  let ended = false
  const server: Server = createServer((sock) => {
    sock.on('error', () => {})
    if (sockets.size >= MAX_SOCKETS) return void sock.destroy()
    sockets.add(sock)
    sock.once('close', () => sockets.delete(sock))
    try {
      o.connect(sock)
    } catch {
      sock.destroy() // 연결이 막 끊긴 경우 등: 이 소켓만 닫고 앱은 계속
    }
  })
  const stop = (why = 'stop') => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    server.close() // 새 연결 막기
    for (const s of sockets) s.destroy() // 열려 있는 연결도 닫음 (close()는 기존 연결을 안 닫음)
    sockets.clear()
    o.onEnd(why)
  }
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, TUNNEL_HOST, () => (server.off('error', reject), resolve())) // 127.0.0.1에만 (다른 PC·같은 망에서 못 들어옴)
    })
  return listen(o.port)
    .catch((e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? listen(0) : Promise.reject(e)))
    .then(() => {
      server.on('error', () => stop('error'))
      timer = setTimeout(() => stop('timeout'), o.ms)
      timer.unref?.()
      return { port: (server.address() as AddressInfo).port, endsAt: Date.now() + o.ms, stop }
    })
}
