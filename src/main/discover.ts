import { execFile } from 'child_process'
import { ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { connect } from 'net'
import { networkInterfaces } from 'os'
import { parseArp } from './arp.mts'

export type Found = { host: string; ms: number; banner: string; mac: string; nvidia: boolean; usb: boolean }

// 젯슨 USB 연결(L4T USB 기기 모드)의 고정 주소
const USB_HOST = '192.168.55.1'
// shortcut: NVIDIA 개발 키트 유선 MAC 앞자리만 확인, Wi-Fi 동글은 제조사가 달라 '일반 SSH 기기'로 보임
const NVIDIA_OUI = ['00-04-4b', '48-b0-2d']

// 22번 포트에 붙어 SSH 첫 줄(배너)을 읽음. 닫혀 있으면 null
function knock(host: string, timeout = 400): Promise<Omit<Found, 'mac' | 'nvidia' | 'usb'> | null> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let ms = 0
    let banner = ''
    const s = connect({ host, port: 22, timeout })
    const done = (ok: boolean) => {
      s.destroy()
      resolve(ok ? { host, ms, banner: banner.split('\r\n')[0].slice(0, 80) } : null)
    }
    s.once('connect', () => {
      ms = Date.now() - t0
      setTimeout(() => done(true), 300) // 배너가 안 와도 포트가 열렸으면 기기로 표시
    })
    s.on('data', (d) => {
      banner += d.toString('latin1')
      if (banner.includes('\n')) done(true)
    })
    s.once('timeout', () => done(ms > 0))
    s.once('error', () => done(false))
  })
}

// PC가 붙어 있는 IPv4 네트워크마다 같은 /24 대역(최대 254개) 주소
export function candidates(): string[] {
  const set = new Set<string>([USB_HOST])
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const base = a.address.split('.').slice(0, 3).join('.')
      for (let i = 1; i < 255; i++) if (`${base}.${i}` !== a.address) set.add(`${base}.${i}`)
    }
  }
  return [...set]
}

// Linux는 arp 명령이 없는 배포판이 많아 커널 표를 바로 읽음
const arp = () =>
  process.platform === 'linux'
    ? readFile('/proc/net/arp', 'utf8').catch(() => '')
    : new Promise<string>((resolve) => execFile('arp', ['-a'], { windowsHide: true }, (_err, out) => resolve(out ?? '')))

let running: Promise<Found[]> | null = null
export function scan(): Promise<Found[]> {
  // 두 번 눌러도 검색은 한 번만
  running ??= (async () => {
    const hosts = candidates()
    const hits: Omit<Found, 'mac' | 'nvidia' | 'usb'>[] = []
    // 동시에 64개씩: 너무 많이 열면 공유기·백신이 막을 수 있음
    for (let i = 0; i < hosts.length; i += 64) {
      const r = await Promise.all(hosts.slice(i, i + 64).map((h) => knock(h)))
      hits.push(...r.filter((x) => x !== null))
    }
    const macs = parseArp(await arp()) // 방금 접속해 본 주소는 ARP 표에 MAC이 남음
    // 젯슨은 Ubuntu(L4T)라 Windows SSH 서버는 빼고, 순서: USB·NVIDIA → Ubuntu → 나머지, 같은 등급은 빠른 순
    const rank = (f: Found) => (f.usb || f.nvidia ? 0 : /ubuntu/i.test(f.banner) ? 1 : 2)
    return hits
      .filter((h) => !/windows/i.test(h.banner))
      .map((h) => {
        const mac = macs.get(h.host) ?? ''
        return { ...h, mac, nvidia: NVIDIA_OUI.some((o) => mac.startsWith(o)), usb: h.host === USB_HOST }
      })
      .sort((a, b) => rank(a) - rank(b) || a.ms - b.ms)
  })().finally(() => (running = null))
  return running
}

export function registerDiscoverIpc(): void {
  ipcMain.handle('discover:scan', () => scan())
}
