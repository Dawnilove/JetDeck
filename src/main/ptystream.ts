import type { WebContents } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { LiveSet } from './liveset.mts'
import { shq as q } from './shq.mts'
import { requireClient as client } from './session'

// 명령을 pty로 실행해 출력을 화면에 흘려 보냄 (ROS echo/hz·빌드가 같이 씀)
// pty로 실행해야 채널을 닫을 때 원격 프로세스도 같이 끝남(SIGHUP). ROS 환경은 사용자의 ~/.bashrc에서 오므로 interactive bash(-i)
// 시작 직후 멈춤을 눌러도(채널이 열리기 전) 열리자마자 닫아서 Device에 남지 않게 LiveSet을 거침
export function ptyStream(wc: WebContents, connId: string, id: string, cmd: string, set: LiveSet<ClientChannel>, dataChannel: string, endChannel: string): Promise<void> {
  const c = client(connId)
  set.begin(id)
  return new Promise<void>((resolve, reject) =>
    c.exec(`bash -ic ${q(cmd)}`, { pty: { cols: 200, rows: 50, term: 'dumb' } }, (err, ch) => {
      if (err) return set.fail(id), reject(err)
      ch.on('error', () => {})
      if (!set.attach(id, ch)) return resolve()
      // 출력이 빠른 명령이 화면을 막지 않게 0.2초마다 모아서 보냄
      let buf = ''
      const flush = () => {
        if (buf && !wc.isDestroyed()) wc.send(dataChannel, id, buf)
        buf = ''
      }
      const timer = setInterval(flush, 200)
      ch.on('data', (d: Buffer) => {
        buf += d.toString('utf8')
        if (buf.length > 64_000) buf = buf.slice(-64_000) // 못 따라가면 오래된 것부터 버림
      })
      ch.on('close', () => {
        clearInterval(timer)
        flush()
        set.remove(id, ch)
        if (!wc.isDestroyed()) wc.send(endChannel, id)
      })
      resolve()
    })
  ).catch((err) => {
    set.fail(id) // 연결이 막 끊겨 exec가 예외를 던진 경우
    throw err
  })
}
