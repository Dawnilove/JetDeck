import { createSocket } from 'dgram'
import { magicPacket } from './wolpacket.mts'

// 같은 망의 브로드캐스트 주소로 보냄 (공유기 밖으로는 기본적으로 안 나감). 놓칠 수 있어 포트 9·7로 3번씩
export async function sendMagic(mac: string, broadcast: string): Promise<void> {
  const pkt = magicPacket(mac)
  const s = createSocket('udp4')
  await new Promise<void>((r) => s.bind(0, r))
  s.setBroadcast(true)
  const targets = [broadcast, '255.255.255.255'].filter(Boolean)
  try {
    for (let i = 0; i < 3; i++)
      for (const t of targets) for (const port of [9, 7]) await new Promise((r) => s.send(pkt, port, t, () => r(null))) // 한 경로가 막혀도 나머지는 계속
  } finally {
    s.close()
  }
}
