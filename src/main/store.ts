import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { connect } from 'net'
import { join } from 'path'
import { sendMagic } from './wol'
import { cleanRemote, type RemoteCfg } from './remotecfg.mts'
import { hostKey } from './settingsio.mts'
import { tr } from './i18n.mts'

export type Host = {
  id: string
  name: string
  kind?: 'ssh' | 'serial' // 1.0.x에 저장된 호스트엔 없음 → SSH
  serialPath?: string // 시리얼: COM3, /dev/ttyUSB0 …
  baud?: number
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  keyPath: string // 비우면 3단계에서 ~/.ssh 기본 키 사용
  keepalive: boolean
  autoReconnect: boolean
  x11: boolean
} & RemoteCfg // 원격 화면(RDP·VNC) 설정 — 2.4.x 이전에 저장된 호스트엔 없음 = 사용 안 함
// 깨우기(Wake-on-LAN) 정보: 접속할 때 젯슨에서 자동으로 읽어 저장 (사용자가 입력하지 않음)
export type Wake = { mac: string; brd: string; iface: string }
export type HostInfo = Host & { hasPassword: boolean; wake?: Wake }
type Stored = Host & { passwordEnc?: string; wake?: Wake } // 비밀번호는 OS 암호화(Windows: DPAPI)된 값만 저장

const file = () => join(app.getPath('userData'), 'hosts.json')

function load(): Stored[] {
  let text: string
  try {
    text = readFileSync(file(), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  return JSON.parse(text) // 파일이 깨졌으면 예외 → 빈 목록으로 덮어써서 날리는 일 방지
}

function save(list: Stored[]): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(list, null, 2))
  renameSync(tmp, file()) // 쓰는 도중 꺼져도 원본은 남도록 임시 파일 후 교체
}

// 화면(renderer)으로는 비밀번호를 절대 보내지 않음
const toInfo = ({ passwordEnc, ...h }: Stored): HostInfo => ({ ...h, hasPassword: !!passwordEnc })
// 화면·MCP에 주는 목록 (암호화된 비밀번호는 빼고)
export const listHosts = (): HostInfo[] => load().map(toInfo)

export const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
export const isSerial = (h: Pick<Host, 'kind'>) => h.kind === 'serial'

// 화면에서 온 값은 믿지 않고 필드별로 검사해서 새로 만듦
export function clean(h: Host): Host {
  if (isSerial(h)) {
    const path = String(h.serialPath ?? '').trim()
    const baud = Number(h.baud)
    if (!h.name?.trim()) throw new Error(tr('이름을 입력하세요'))
    // COM3 / /dev/ttyUSB0 형식만 (임의 파일 경로를 장치로 열지 않게)
    if (!/^COM\d{1,3}$|^\/dev\/tty[\w.-]+$/i.test(path)) throw new Error(tr('시리얼 포트를 선택하세요 (예: COM3, /dev/ttyUSB0)'))
    if (!BAUDS.includes(baud)) throw new Error(tr('지원하지 않는 속도(baud)예요'))
    return {
      id: typeof h.id === 'string' && h.id ? h.id : randomUUID(),
      name: h.name.trim(),
      kind: 'serial',
      serialPath: path,
      baud,
      host: '',
      port: 0,
      username: '',
      auth: 'key', // 비밀번호를 저장하지 않게
      keyPath: '',
      keepalive: false,
      autoReconnect: !!h.autoReconnect,
      x11: false
    }
  }
  const port = Number(h.port)
  if (!h.name?.trim() || !h.host?.trim() || !h.username?.trim()) throw new Error(tr('이름, 호스트, 사용자 이름을 입력하세요'))
  if (/\s/.test(h.host.trim())) throw new Error(tr('호스트에 공백이 있어요'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(tr('포트는 1~65535 사이 숫자여야 해요'))
  if (h.auth !== 'password' && h.auth !== 'key') throw new Error(tr('인증 방식이 올바르지 않아요'))
  return {
    id: typeof h.id === 'string' && h.id ? h.id : randomUUID(),
    name: h.name.trim(),
    kind: 'ssh',
    host: h.host.trim(),
    port,
    username: h.username.trim(),
    auth: h.auth,
    keyPath: h.auth === 'key' ? String(h.keyPath ?? '').trim() : '',
    keepalive: !!h.keepalive,
    autoReconnect: !!h.autoReconnect,
    x11: !!h.x11,
    ...cleanRemote(h.remote, h.remotePort, h.remoteTunnel)
  }
}

function encrypt(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('OS 암호화를 쓸 수 없어 비밀번호를 저장하지 않았어요'))
  // Linux에서 키링(GNOME Keyring·KWallet)이 없으면 Electron이 고정 키로 저장함(basic_text) → 사실상 평문이라 거부
  // shortcut: 이 경우 비밀번호 방식은 못 씀, 필요해지면 접속할 때마다 비밀번호를 묻는 창 추가
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    throw new Error(tr('이 PC에는 비밀번호를 안전하게 저장할 키링(GNOME Keyring 등)이 없어요. 인증 방식을 SSH 키로 바꾸거나 키링을 설치하세요'))
  return safeStorage.encryptString(password).toString('base64')
}

export function getHost(id: string): Host | undefined {
  const h = load().find((x) => x.id === id)
  if (!h) return undefined
  const { passwordEnc: _, ...host } = h
  return host
}

// 원격에서 읽은 값이므로 형식 검사 후 저장
export function setWake(id: string, w: Wake): void {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(w.mac) || !/^[\w.-]+$/.test(w.iface) || (w.brd && !/^\d{1,3}(\.\d{1,3}){3}$/.test(w.brd))) return
  const list = load()
  const h = list.find((x) => x.id === id)
  if (!h || (h.wake?.mac === w.mac && h.wake.brd === w.brd && h.wake.iface === w.iface)) return
  h.wake = { mac: w.mac.toLowerCase(), brd: w.brd, iface: w.iface }
  save(list)
}

export function getPassword(id: string): string | undefined {
  const enc = load().find((h) => h.id === id)?.passwordEnc
  return enc ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : undefined
}

// 22번 포트가 열려 있으면 응답 시간(ms), 아니면 null
export function probe(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const s = connect({ host: String(host), port: Number(port) || 22, timeout: 2000 })
    const done = (ms: number | null) => {
      s.destroy()
      resolve(ms)
    }
    s.once('connect', () => done(Date.now() - t0))
    s.once('timeout', () => done(null))
    s.once('error', () => done(null))
  })
}

// 가져온 호스트 추가: 이미 같은 기기(주소·포트·사용자, 시리얼은 포트)가 있으면 건너뜀
export function addHosts(items: Host[]): { added: number; skipped: number } {
  const list = load()
  const seen = new Set(list.map(hostKey))
  let added = 0
  for (const h of items) {
    if (seen.has(hostKey(h))) continue
    seen.add(hostKey(h))
    list.push(h)
    added++
  }
  if (added) save(list)
  return { added, skipped: items.length - added }
}

export function registerStoreIpc(): void {
  ipcMain.handle('hosts:list', () => listHosts())

  ipcMain.handle('hosts:save', (_e, h: Host, password?: string) => {
    const item: Stored = clean(h)
    const list = load()
    const i = list.findIndex((x) => x.id === item.id)
    if (item.auth === 'password') {
      // 새 비밀번호를 안 넣었으면 기존 것 유지
      if (password) item.passwordEnc = encrypt(String(password))
      else if (i >= 0 && list[i].passwordEnc) item.passwordEnc = list[i].passwordEnc
    }
    if (i >= 0 && list[i].wake) item.wake = list[i].wake // 폼에 없는 값이라 기존 것 유지
    if (i >= 0) list[i] = item
    else list.push(item)
    save(list)
    return toInfo(item)
  })

  ipcMain.handle('host:wake', async (_e, id: string) => {
    const w = load().find((h) => h.id === id)?.wake
    if (!w) throw new Error(tr('아직 MAC 주소를 몰라요. 한 번 접속하면 자동으로 저장돼요'))
    await sendMagic(w.mac, w.brd)
  })

  ipcMain.handle('hosts:delete', (_e, id: string) => save(load().filter((h) => h.id !== id)))

  ipcMain.handle('hosts:probe', (_e, host: string, port: number) => probe(host, port))

  ipcMain.handle('dialog:pickKey', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: tr('개인 키 파일 선택'),
      defaultPath: join(app.getPath('home'), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    return r.canceled ? null : r.filePaths[0]
  })
}
