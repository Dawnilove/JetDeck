import { app, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { createServer, connect as tcpConnect, type Server, type Socket } from 'net'
import { join } from 'path'
import type { Client } from 'ssh2'
import { getClient } from './session'
import { tr } from './i18n.mts'

// 포트 포워딩 (design/PortForward.dc.html). 규칙은 호스트별로 저장, 켜 둔 규칙은 접속할 때 자동 시작
export type Rule = { id: string; name: string; kind: 'L' | 'R' | 'D'; localPort: number; remotePort: number; on: boolean }
export type FwdStatus = { connId: string; ruleId: string; active: boolean; error?: string }

const file = () => join(app.getPath('userData'), 'forwards.json')
function loadAll(): Record<string, Rule[]> {
  let text: string
  try {
    text = readFileSync(file(), 'utf8')
  } catch {
    return {} // 아직 파일 없음
  }
  try {
    return JSON.parse(text)
  } catch {
    // 깨진 파일을 빈 값으로 덮어쓰면 모든 호스트의 규칙이 사라지므로 옆에 보관하고 새로 시작
    renameSync(file(), `${file()}.broken-${Date.now()}`)
    return {}
  }
}
function saveAll(all: Record<string, Rule[]>): void {
  writeFileSync(file() + '.tmp', JSON.stringify(all, null, 2))
  renameSync(file() + '.tmp', file())
}
const rulesOf = (hostId: string) => loadAll()[hostId] ?? []
function setRules(hostId: string, rules: Rule[]): void {
  const all = loadAll()
  all[hostId] = rules
  saveAll(all)
}

const port = (n: unknown) => {
  const p = Number(n)
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(tr('포트는 1~65535 사이 숫자여야 해요'))
  return p
}
function clean(r: Partial<Rule>): Rule {
  if (r.kind !== 'L' && r.kind !== 'R' && r.kind !== 'D') throw new Error(tr('종류가 올바르지 않아요'))
  const name = String(r.name ?? '').trim()
  if (!name) throw new Error(tr('이름을 입력하세요'))
  return { id: typeof r.id === 'string' && r.id ? r.id : randomUUID(), name, kind: r.kind, localPort: port(r.localPort), remotePort: r.kind === 'D' ? 0 : port(r.remotePort), on: !!r.on }
}

// 양방향 연결: 한쪽이 닫히면 다른 쪽도 닫음
export function pipe(a: Socket, b: NodeJS.ReadWriteStream & { destroy?: () => void }): void {
  a.pipe(b).pipe(a)
  a.on('error', () => b.destroy?.())
  b.on('error', () => a.destroy())
  a.on('close', () => b.destroy?.())
}

// SSH로 대상에 연결. 연결이 이미 끊겼으면 ssh2가 예외를 던지므로(앱 main 프로세스가 죽음) 잡아서 그 소켓만 닫음
export function forwardOut(client: Client, sock: Socket, host: string, port: number, ok: (stream: NodeJS.ReadWriteStream & { destroy?: () => void }) => void): void {
  try {
    client.forwardOut('127.0.0.1', sock.remotePort ?? 0, host, port, (err, stream) => (err ? sock.destroy() : ok(stream)))
  } catch {
    sock.destroy()
  }
}

// 동적(-D): 최소 SOCKS5 서버 (인증 없음, CONNECT만). 브라우저 프록시를 localhost:포트로 지정해 사용
// shortcut: 인사·요청이 각각 한 덩어리로 온다고 가정 (로컬 브라우저·curl은 그렇게 보냄), 조각나서 오는 클라이언트가 생기면 버퍼링 추가
function socks(client: Client, sock: Socket): void {
  sock.once('data', (hello: Buffer) => {
    if (hello[0] !== 5) return sock.destroy()
    sock.write(Buffer.from([5, 0])) // 인증 없음
    sock.once('data', (req: Buffer) => {
      if (req[0] !== 5 || req[1] !== 1) return sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])) // CONNECT만 지원
      let host: string
      let i: number
      if (req[3] === 1) [host, i] = [[...req.subarray(4, 8)].join('.'), 8]
      else if (req[3] === 3) [host, i] = [req.subarray(5, 5 + req[4]).toString(), 5 + req[4]]
      else if (req[3] === 4) [host, i] = [(req.subarray(4, 20).toString('hex').match(/.{4}/g) ?? []).join(':'), 20]
      else return sock.destroy()
      // 짧은 요청에서 readUInt16BE가 예외를 던지면 main 프로세스가 죽음
      if (req.length < i + 2) return sock.destroy()
      const dport = req.readUInt16BE(i)
      forwardOut(client, sock, host, dport, (stream) => {
        sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        pipe(sock, stream)
      })
    })
  })
  sock.on('error', () => {})
}

// 실행 중인 포워딩: 연결별 → 규칙별
type Running = { stop: () => void }
const running = new Map<string, Map<string, Running>>()
const remoteMap = new WeakMap<Client, Map<number, number>>() // -R: 젯슨 포트 → 내 PC 포트

function onStatus(wc: WebContents, s: FwdStatus) {
  if (!wc.isDestroyed()) wc.send('fwd:status', s)
}

function start(connId: string, rule: Rule, wc: WebContents): Promise<void> {
  const client = getClient(connId)
  if (!client) return Promise.reject(new Error(tr('연결되어 있지 않아요')))
  const map = running.get(connId) ?? new Map<string, Running>()
  running.set(connId, map)
  if (map.has(rule.id)) return Promise.resolve()

  if (rule.kind === 'R') {
    let ports = remoteMap.get(client)
    if (!ports) {
      ports = new Map()
      remoteMap.set(client, ports)
      // 젯슨 쪽으로 들어온 연결을 내 PC 포트로 연결
      client.on('tcp connection', (info, accept, reject) => {
        const lp = ports!.get(info.destPort)
        if (!lp) return reject()
        const stream = accept()
        const sock = tcpConnect(lp, '127.0.0.1')
        pipe(sock, stream)
      })
    }
    return new Promise((resolve, reject) =>
      client.forwardIn('127.0.0.1', rule.remotePort, (err) => {
        if (err) return reject(new Error(tr('Device 포트 {0}을(를) 열 수 없어요 (이미 사용 중이거나 1024 미만)', rule.remotePort)))
        ports!.set(rule.remotePort, rule.localPort)
        map.set(rule.id, {
          stop: () => {
            ports!.delete(rule.remotePort)
            client.unforwardIn('127.0.0.1', rule.remotePort, () => {})
          }
        })
        resolve()
      })
    )
  }

  // -L / -D: 내 PC에 서버를 열고 들어온 연결을 SSH로 넘김 (다른 PC에서 못 들어오게 127.0.0.1에만)
  const server: Server = createServer((sock) => {
    if (rule.kind === 'D') return socks(client, sock)
    sock.on('error', () => {})
    forwardOut(client, sock, '127.0.0.1', rule.remotePort, (stream) => pipe(sock, stream))
  })
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? tr('내 PC 포트 {0}이(가) 이미 쓰이고 있어요', rule.localPort) : e.message))
    )
    server.listen(rule.localPort, '127.0.0.1', () => {
      map.set(rule.id, { stop: () => server.close() })
      server.on('error', (e) => onStatus(wc, { connId, ruleId: rule.id, active: true, error: e.message }))
      resolve()
    })
  })
}

// 하나가 실패해도(끊긴 연결에 unforwardIn 등) 나머지 정리는 계속되도록 예외를 삼킴
function stop(connId: string, ruleId: string): void {
  try {
    running.get(connId)?.get(ruleId)?.stop()
  } catch {
    /* 이미 끊긴 연결 — 정리할 것 없음 */
  }
  running.get(connId)?.delete(ruleId)
}

// 접속 직후: 켜 둔 규칙 자동 시작. 연결이 끊기면 모두 정리
export function startSavedForwards(connId: string, hostId: string, client: Client, wc: WebContents): void {
  for (const r of rulesOf(hostId).filter((r) => r.on))
    start(connId, r, wc).then(
      () => onStatus(wc, { connId, ruleId: r.id, active: true }),
      (e) => onStatus(wc, { connId, ruleId: r.id, active: false, error: e.message })
    )
  client.once('close', () => {
    for (const id of running.get(connId)?.keys() ?? []) stop(connId, id)
    running.delete(connId)
  })
}

export function registerForwardIpc(): void {
  ipcMain.handle('fwd:list', (_e, connId: string, hostId: string) =>
    rulesOf(String(hostId)).map((r) => ({ ...r, active: !!running.get(String(connId))?.has(r.id) }))
  )

  // 추가 = 저장 + 바로 시작 ("추가하고 시작"). 시작에 실패해도 규칙은 꺼진 채로 남음
  ipcMain.handle('fwd:add', async (e, connId: string, hostId: string, raw: Partial<Rule>) => {
    const rule = clean({ ...raw, on: true })
    const rules = rulesOf(hostId)
    if (rules.some((r) => r.kind !== 'R' && rule.kind !== 'R' && r.localPort === rule.localPort))
      throw new Error(tr('내 PC 포트 {0}을(를) 쓰는 규칙이 이미 있어요', rule.localPort))
    try {
      await start(String(connId), rule, e.sender)
    } catch (err) {
      setRules(hostId, [...rules, { ...rule, on: false }])
      throw err
    }
    setRules(hostId, [...rules, rule])
    return rule
  })

  ipcMain.handle('fwd:toggle', async (e, connId: string, hostId: string, ruleId: string, on: boolean) => {
    const rules = rulesOf(hostId)
    const r = rules.find((x) => x.id === ruleId)
    if (!r) throw new Error(tr('규칙을 찾을 수 없어요'))
    if (on) await start(String(connId), r, e.sender)
    else stop(String(connId), ruleId)
    setRules(hostId, rules.map((x) => (x.id === ruleId ? { ...x, on: !!on } : x)))
  })

  ipcMain.handle('fwd:delete', (_e, connId: string, hostId: string, ruleId: string) => {
    stop(String(connId), ruleId)
    setRules(hostId, rulesOf(hostId).filter((r) => r.id !== ruleId))
  })
}
