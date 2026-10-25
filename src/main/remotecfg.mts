// 원격 화면(RDP·VNC) 외부 실행: 설정 검사 + 실행 방법 만들기 (Electron 없이 시험할 수 있게 순수 함수로)
import { tr } from './i18n.mts'
export type RemoteKind = 'rdp' | 'vnc'
export const DEFAULT_PORT: Record<RemoteKind, number> = { rdp: 3389, vnc: 5900 }
export type RemoteCfg = { remote?: RemoteKind; remotePort?: number; remoteTunnel?: boolean }

// 화면에서 온 값은 믿지 않고 새로 만듦. 종류가 없으면 '사용 안 함'(빈 객체), 포트를 비우면 종류별 기본값, 터널은 기본 켬
export function cleanRemote(kind: unknown, port: unknown, tunnel: unknown): RemoteCfg {
  if (kind !== 'rdp' && kind !== 'vnc') return {}
  const raw = port === '' || port == null ? DEFAULT_PORT[kind] : Number(port)
  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) throw new Error(tr('원격 화면 포트는 1~65535 사이 숫자여야 해요'))
  return { remote: kind, remotePort: raw, remoteTunnel: tunnel !== false }
}

export type Launch = { cmd: string; args: string[] } | { url: string }

// RDP: Windows는 mstsc, 그 밖의 OS는 rdp:// 주소(Remmina 등이 처리). VNC: vnc:// 주소를 PC의 기본 연결 프로그램으로
// shortcut: Linux·macOS의 RDP는 rdp:// 처리 프로그램이 있어야 하고 시험하지 못함, 문제가 생기면 xfreerdp 직접 실행으로 바꾸기
export function buildLaunch(kind: RemoteKind, host: string, port: number, platform: string): Launch {
  const addr = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
  if (kind === 'vnc') return { url: `vnc://${addr}` }
  if (platform === 'win32') return { cmd: 'mstsc', args: [`/v:${addr}`] }
  return { url: `rdp://full%20address=s:${addr}` }
}
