import { tr } from './i18n.mts'

// Wake-on-LAN 매직 패킷 = FF 6바이트 + MAC 주소 16번 반복 (102바이트)
export function magicPacket(mac: string): Buffer {
  const b = Buffer.from(mac.split(':').map((h) => parseInt(h, 16)))
  if (b.length !== 6 || b.some((x) => Number.isNaN(x))) throw new Error(tr('MAC 주소 형식이 아니에요: {0}', mac))
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(b)])
}
