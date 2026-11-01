import type { Client } from 'ssh2'
import type { Socket } from 'net'

// SSH로 대상에 연결. 연결이 이미 끊겼으면 ssh2가 예외를 던지므로(앱 main 프로세스가 죽음) 잡아서 그 소켓만 닫음
export function forwardOut(client: Client, sock: Socket, host: string, port: number, ok: (stream: NodeJS.ReadWriteStream & { destroy?: () => void }) => void): void {
  try {
    client.forwardOut('127.0.0.1', sock.remotePort ?? 0, host, port, (err, stream) => {
      if (err) return sock.destroy()
      if (sock.destroyed) return (stream as { destroy?: () => void }).destroy?.() // 콜백 전에 소켓이 닫힘: 채널이 남지 않게 닫음
      ok(stream)
    })
  } catch {
    sock.destroy()
  }
}
