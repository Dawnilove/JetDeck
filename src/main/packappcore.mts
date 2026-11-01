// 팩의 앱 기능 권한을 실행하는 엔진 (6.0.0, 설계안 §2-3·§2-4). 팩 항목(mode:'app')을 받아 Device 경로 규칙(permpath)을 지키며 SFTP로 목록·받기·읽기·올리기를 한다.
// Electron·SSH는 모른다: Device는 DeviceFs, OS 대화상자는 ui로 받는다 (packapp.ts가 연결). Electron 없이 시험 (packappcore.test.mts)
// 원칙: 화면은 (팩, 플러그인, 항목, 입력값, 토큰)만 보낸다. Device 경로는 팩 템플릿 + 검사된 입력값으로 main이 만들고, PC 경로는 OS 대화상자에서만 얻는다
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename as fsRename, stat as fsStat, unlink as fsUnlink, writeFile } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { basename } from 'node:path'
import { Transform, Writable, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tr } from './i18n.mts'
import { checkValue, type Field } from './packfields.mts'
import { fill } from './packrun.mts'
import { sanitizeOutput } from './packsafe.mts'
import { LIMITS, PERM_OPS, SERIAL_BAUDS, type AppOp, type Pack, type PackAction, type PermKind, type Permission } from './packschema.mts'
import { identOf, orderChoices, startSerialRead, type SerialChoice, type SerialEnd, type SerialRead } from './packserial.mts'
import { listenTunnel, pickFreePort, TUNNEL_HOST, type TunnelHandle } from './packtunnel.mts'
import { badSaveName, portProblem, resolveTarget, safeName, toTilde, type FsKind, type PathFs } from './permpath.mts'
import { permRisk, type Reason, type Risk } from './risk.mts'
import type { SerialSource } from './serialread.mts'

export interface DeviceFs extends PathFs {
  readdir(p: string): Promise<{ name: string; kind: FsKind; size: number }[]>
  readStream(p: string): Readable
  writeStream(p: string, mode: number): NodeJS.WritableStream & { destroy(e?: Error): unknown } // 이미 있으면 실패해야 함 (flags wx)
  rename(from: string, to: string, overwrite: boolean): Promise<void> // overwrite=false면 대상이 있을 때 실패해야 함
  unlink(p: string): Promise<void>
}
export type AppUi = {
  pickSave(defaultName: string, ctx?: unknown): Promise<string | null> // OS 저장 대화상자 (덮어쓰기 확인은 대화상자가 함)
  pickOpen(ctx?: unknown): Promise<string | null> // OS 열기 대화상자
  pickPort?(choices: SerialChoice[], more: boolean, ctx?: unknown): Promise<number | null> // 시리얼 포트 고르기 (main이 연 창). choices의 순서 번호를 돌려줌, 취소는 null
}
export type AppEvent =
  | { type: 'progress'; opId: string; done: number; total: number }
  | { type: 'tunnel'; state: 'open' | 'closed'; id: string; packId: string; connId: string; port?: number; remotePort?: number; endsAt?: number; reason?: string } // 상태 줄·정지 버튼용
  | { type: 'serial'; state: 'open' | 'closed'; id: string; packId: string; connId: string; port?: string; baud?: number; endsAt?: number; reason?: SerialEnd; bytes?: number } // 시리얼 읽기 상태 줄·정지 버튼용
  | { type: 'serial-data'; id: string; lines: string[]; skipped: number } // 읽은 글자 (줄 단위, 이미 정리·비밀 가림)
  | { type: 'serial-idle'; id: string } // 열린 뒤 일정 시간 데이터가 없음: 보율·장치 확인 안내용
export type AppDeps = {
  fsOf(connId: string): Promise<DeviceFs>
  ui: AppUi
  emit?: (e: AppEvent) => void
  connectTo?: (connId: string, sock: Socket, remotePort: number) => void // 터널: 들어온 연결을 Device 127.0.0.1:remotePort에 이음 (packapp.ts가 forwardOut·pipe로 연결)
  isActive?: (packId: string, hash: string) => boolean // 그 팩이 지금도 켜져 있고 파일이 같은지 (대화상자를 기다린 뒤 확인). 없으면 확인 안 함
  listPorts?: () => Promise<SerialChoice[]> // 시리얼: 지금 연결된 포트 (packapp.ts가 serial.ts로 연결)
  openRead?: (path: string, baud: number) => Promise<SerialSource> // 시리얼: 읽기 전용으로 엶
  freePort?: () => Promise<number> // 시험용
  tunnelMs?: (minutes: number) => number // 시험용
  serialMs?: (minutes: number) => number // 시험용
  serialIdleMs?: number // 시험용
}
export type AppTarget = { pack: Pack; hash: string; pluginId: string; action: PackAction } // 켜진 팩에서 찾은 항목 (찾는 일은 호출 쪽)
export type AppPrepared = {
  op: AppOp
  kind: PermKind
  risk: Risk
  reasons: Reason[]
  needConfirm: boolean // 쓰기·터널은 실행 전에 확인 창을 거쳐야 함 → token을 실행 요청에 같이 보냄
  token: string
  remotePath?: string // 확인 창에 보일 Device 경로 (~/upload/a.bin)
  exists?: boolean // put: 같은 이름이 이미 있음 (overwrite가 ask면 확인 창에 덮어쓴다고 보임)
  local?: { name: string; size: number } // put: 사용자가 고른 PC 파일
  tunnel?: { port: number; remotePort: number; minutes: number } // open: 이 PC 127.0.0.1:port를 Device remotePort에 이음. 이 PC의 다른 프로그램도 접속할 수 있음
  serial?: { path: string; label: string; vidpid: string; baud: number; minutes: number; maxBytes: number } // read: 사용자가 고른 이 PC 포트. 확인 창은 앱 문장으로 이것을 보임
}
export type AppResult =
  | { op: 'list'; entries: { name: string; kind: FsKind; size: number }[]; truncated: boolean }
  | { op: 'text'; text: string }
  | { op: 'get'; saved: string | null; size: number } // saved: 저장한 파일 이름 (취소하면 null)
  | { op: 'put'; name: string; size: number; path: string }
  | { op: 'open'; id: string; host: string; port: number; remotePort: number; endsAt: number } // id로 pack:app-stop
  | { op: 'read'; id: string; port: string; baud: number; endsAt: number } // 시리얼 읽기 시작. 글자는 serial-data 이벤트, id로 pack:app-stop

const PENDING_TTL = 10 * 60_000
const PENDING_MAX = 8
const sha = (...parts: (string | number)[]) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)
const rand = () => randomBytes(6).toString('hex')
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

const initial = (f: Field): string => (f.default !== undefined ? f.default : f.type === 'int' ? String(f.min) : f.type === 'select' && f.choices ? f.choices[0].value : '')
// 화면이 보낸 값(없으면 기본값)을 검사해서 {이름} → 글자 표로. 경로 조각이 될 값이라 따옴표는 붙이지 않음 (Device 경로 규칙이 다시 검사)
export function rawValues(a: PackAction, given: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of a.fields ?? []) {
    const g = given && Object.hasOwn(given, f.name) ? given[f.name] : undefined
    const v = typeof g === 'string' ? g : initial(f)
    if (v === '' && f.required === false && f.type !== 'int') {
      out[f.name] = ''
      continue
    }
    const bad = checkValue(f, v)
    if (bad) throw new Error(bad)
    out[f.name] = v
  }
  return out
}

// 글자 수를 세며 흘려보냄. 상한을 넘으면 오류 (끝없이 읽히는 파일·실행 중 커진 파일 방지)
function counter(max: number, onBytes: (n: number) => void): Transform {
  let n = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length
      if (n > max) return cb(new Error(tr('파일이 너무 커요')))
      onBytes(n)
      cb(null, chunk)
    }
  })
}

type Op = { connId: string; packId: string; hash: string; stop: (why?: string) => void }
type Tunnel = Op & { key: string }
type Pending = { connId: string; local: string; size: number; mtimeMs: number; at: number }
type PendingRead = { connId: string; choice: SerialChoice; at: number }

export function createAppEngine(deps: AppDeps) {
  const ops = new Map<string, Op>()
  const pending = new Map<string, Pending>()
  const tunnels = new Map<string, Tunnel>()
  const pendingOpen = new Map<string, { connId: string; port: number; at: number }>()
  const pendingRead = new Map<string, PendingRead>()
  const serials = new Map<string, Op & { key: string }>()

  function contextOf(t: AppTarget): { perm: Permission; op: AppOp; a: PackAction } {
    const a = t.action
    const perm = t.pack.permissions?.find((p) => p.id === a.perm)
    // 로드 때 검사했지만 실행할 때마다 한 번 더: 권한 종류와 동작이 맞는 app 항목만
    if (a.mode !== 'app' || !perm || !a.op || !PERM_OPS[perm.kind].includes(a.op)) throw new Error(tr('앱 기능을 쓰는 항목이 아니에요'))
    return { perm, op: a.op, a }
  }
  const relOf = (a: PackAction, given: Record<string, string> | undefined) => fill(a.path ?? '', rawValues(a, given))
  const homeOf = (fs: DeviceFs) => fs.realpath('.')

  // 전송 시작: 연결마다 하나, 시간 상한, 멈춤 신호. opId는 화면이 정하면(취소용) 그대로, 아니면 새로 만듦
  function begin(connId: string, t: AppTarget, wanted?: string) {
    const opId = wanted ?? rand()
    if (!/^[\w-]{1,64}$/.test(opId) || ops.has(opId) || tunnels.has(opId) || serials.has(opId)) throw new Error(tr('올바르지 않은 요청이에요'))
    if ([...ops.values()].some((o) => o.connId === connId)) throw new Error(tr('이 연결은 전송을 하나씩만 할 수 있어요'))
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(tr('전송 시간이 너무 길어서 멈췄어요'))), LIMITS.transferSeconds * 1000)
    timer.unref?.()
    ops.set(opId, { connId, packId: t.pack.id, hash: t.hash, stop: () => ac.abort(new Error(tr('전송을 멈췄어요'))) })
    return { opId, signal: ac.signal, end: () => (clearTimeout(timer), void ops.delete(opId)) }
  }
  // 멈춤·시간 초과 때는 스트림 오류 대신 그 이유를 오류로
  const transfer = (signal: AbortSignal, ...streams: unknown[]) =>
    (pipeline as (...a: unknown[]) => Promise<void>)(...streams, { signal }).catch((e) => Promise.reject(signal.aborted ? signal.reason : e))

  // 터널 개수: 같은 항목 중복 금지, 팩당 2, 앱 전체 4. 같은 key는 연결·팩·플러그인·항목
  function tunnelKey(connId: string, t: AppTarget): string {
    const key = `${connId}/${t.pack.id}/${t.pluginId}/${t.action.id}`
    const open = [...tunnels.values()]
    if (open.some((x) => x.key === key)) throw new Error(tr('이 터널은 이미 열려 있어요'))
    if (open.filter((x) => x.packId === t.pack.id).length >= LIMITS.tunnelsPerPack || open.length >= LIMITS.tunnelsPerApp) throw new Error(tr('열 수 있는 터널 수를 넘었어요'))
    return key
  }
  // 시리얼 읽기 개수: 같은 항목 중복 금지, 팩당 1, 앱 전체 2
  function serialKey(connId: string, t: AppTarget): string {
    const key = `${connId}/${t.pack.id}/${t.pluginId}/${t.action.id}`
    const open = [...serials.values()]
    if (open.some((x) => x.key === key)) throw new Error(tr('이 포트 읽기는 이미 하고 있어요'))
    if (open.filter((x) => x.packId === t.pack.id).length >= LIMITS.serialPerPack || open.length >= LIMITS.serialPerApp) throw new Error(tr('동시에 읽을 수 있는 포트 수를 넘었어요'))
    return key
  }
  // 확인한 것과 같은 값이어야 실행하는 token. 팩 지문(hash)과 고른 장치(identOf)가 들어 있어 팩이 바뀌거나 장치가 바뀌면 달라진다
  const readToken = (t: AppTarget, perm: Permission, choice: SerialChoice) => sha(t.pack.id, t.hash, t.pluginId, t.action.id, 'read', perm.baud!, perm.maxMinutes!, perm.maxBytes!, identOf(choice))

  async function prepare(connId: string, t: AppTarget, given: Record<string, string> | undefined, ctx?: unknown): Promise<AppPrepared | null> {
    const { perm, op, a } = contextOf(t)
    const r = permRisk(perm.kind)
    const base: AppPrepared = { op, kind: perm.kind, risk: r.risk, reasons: r.reasons, needConfirm: false, token: '' }
    if (op === 'open') {
      tunnelKey(connId, t)
      if (portProblem(perm.remotePort)) throw new Error(tr('경로가 올바르지 않아요'))
      const port = await (deps.freePort ?? pickFreePort)() // 번호만 정함. 확인하기 전에는 아무것도 열지 않음
      const token = sha(t.pack.id, t.hash, t.pluginId, a.id, 'open', perm.remotePort!, port, perm.maxMinutes!)
      if (pendingOpen.size >= PENDING_MAX) pendingOpen.delete(pendingOpen.keys().next().value!)
      pendingOpen.set(token, { connId, port, at: Date.now() })
      return { ...base, needConfirm: true, token, tunnel: { port, remotePort: perm.remotePort!, minutes: perm.maxMinutes! } }
    }
    if (op === 'read') {
      serialKey(connId, t)
      const pickPort = deps.ui.pickPort
      if (!pickPort || !deps.listPorts || !perm.baud || !SERIAL_BAUDS.includes(perm.baud)) throw new Error(tr('아직 지원하지 않는 동작이에요'))
      const { shown, more } = orderChoices(await deps.listPorts())
      if (!shown.length) throw new Error(tr('연결된 시리얼 포트가 없어요'))
      const i = await pickPort(shown, more, ctx) // 사용자가 직접 고름: 자동 선택·기억 없음
      if (i === null || !shown[i]) return null
      // 고르기 창이 열려 있는 동안 팩이 꺼졌거나 파일이 바뀌었을 수 있음
      if (deps.isActive && !deps.isActive(t.pack.id, t.hash)) throw new Error(tr('이 팩은 켜져 있지 않아요'))
      const c = shown[i]
      const token = readToken(t, perm, c)
      if (pendingRead.size >= PENDING_MAX) pendingRead.delete(pendingRead.keys().next().value!)
      pendingRead.set(token, { connId, choice: c, at: Date.now() })
      const vidpid = c.vendorId && c.productId ? `${c.vendorId}:${c.productId}` : ''
      return { ...base, needConfirm: true, token, serial: { path: safeName(c.path), label: safeName(c.label).slice(0, 60), vidpid: safeName(vidpid), baud: perm.baud, minutes: perm.maxMinutes!, maxBytes: perm.maxBytes! } }
    }
    if (op !== 'put') return base // 읽기 동작은 확인 창이 없음 (받기는 OS 저장 창이 확인 역할)
    const fs = await deps.fsOf(connId)
    const home = await homeOf(fs)
    const w = await resolveTarget(fs, home, perm, relOf(a, given), 'write')
    if (w.exists && perm.overwrite === 'never') throw new Error(tr('같은 이름의 파일이 있어서 올릴 수 없어요'))
    const local = await deps.ui.pickOpen(ctx)
    if (!local) return null
    const st = await fsStat(local)
    if (!st.isFile()) throw new Error(tr('일반 파일만 쓸 수 있어요'))
    if (st.size > perm.maxBytes!) throw new Error(tr('파일이 너무 커요'))
    const token = sha(t.pack.id, t.hash, t.pluginId, a.id, 'put', w.path, w.exists ? 1 : 0, local, st.size, st.mtimeMs)
    if (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value!)
    pending.set(token, { connId, local, size: st.size, mtimeMs: st.mtimeMs, at: Date.now() })
    return { ...base, needConfirm: true, token, remotePath: toTilde(w.path, home), exists: w.exists, local: { name: safeName(basename(local)), size: st.size } }
  }

  async function run(connId: string, t: AppTarget, given: Record<string, string> | undefined, token: unknown, opId?: string, ctx?: unknown): Promise<AppResult> {
    const { perm, op, a } = contextOf(t)

    if (op === 'open') {
      const p = typeof token === 'string' ? pendingOpen.get(token) : undefined
      // 확인한 것과 같아야 실행: 포트·시간은 팩이 정한 값이고, 이 PC 포트 번호는 확인 창에서 보여 준 값
      if (!p || p.connId !== connId || Date.now() - p.at > PENDING_TTL || token !== sha(t.pack.id, t.hash, t.pluginId, a.id, 'open', perm.remotePort!, p.port, perm.maxMinutes!)) throw new Error(tr('확인한 내용과 달라요. 다시 확인해 주세요'))
      pendingOpen.delete(token as string)
      const connect = deps.connectTo
      if (!connect || portProblem(perm.remotePort) || !perm.maxMinutes || perm.maxMinutes > LIMITS.tunnelMinutesMax) throw new Error(tr('아직 지원하지 않는 동작이에요'))
      const key = tunnelKey(connId, t)
      const id = `tn-${rand()}`
      const remotePort = perm.remotePort!
      let handle: TunnelHandle | undefined
      let stopped: string | undefined
      // 서버가 열리기를 기다리는 동안에도 목록에 올려 두어 개수 제한을 지키고, 그 사이 정지 요청이 와도 놓치지 않음
      tunnels.set(id, { connId, packId: t.pack.id, hash: t.hash, key, stop: (why) => ((stopped = why ?? 'stop'), handle?.stop(why)) })
      try {
        handle = await listenTunnel({
          port: p.port,
          ms: (deps.tunnelMs ?? ((m) => m * 60_000))(perm.maxMinutes),
          connect: (sock) => connect(connId, sock, remotePort),
          onEnd: (reason) => (tunnels.delete(id), deps.emit?.({ type: 'tunnel', state: 'closed', id, packId: t.pack.id, connId, reason }))
        })
      } catch (e) {
        tunnels.delete(id)
        throw e
      }
      deps.emit?.({ type: 'tunnel', state: 'open', id, packId: t.pack.id, connId, port: handle.port, remotePort, endsAt: handle.endsAt })
      if (stopped) handle.stop(stopped)
      return { op, id, host: TUNNEL_HOST, port: handle.port, remotePort, endsAt: handle.endsAt }
    }

    if (op === 'read') {
      const p = typeof token === 'string' ? pendingRead.get(token) : undefined
      // 확인한 것과 같아야 실행: 팩 지문·보율·한도·고른 장치가 token에 들어 있다
      if (!p || p.connId !== connId || Date.now() - p.at > PENDING_TTL || token !== readToken(t, perm, p.choice)) throw new Error(tr('확인한 내용과 달라요. 다시 확인해 주세요'))
      pendingRead.delete(token as string)
      if (deps.isActive && !deps.isActive(t.pack.id, t.hash)) throw new Error(tr('이 팩은 켜져 있지 않아요'))
      const openRead = deps.openRead
      if (!openRead || !deps.listPorts || !perm.baud || !SERIAL_BAUDS.includes(perm.baud) || !perm.maxMinutes || perm.maxMinutes > LIMITS.tunnelMinutesMax || !perm.maxBytes) throw new Error(tr('아직 지원하지 않는 동작이에요'))
      const key = serialKey(connId, t)
      // 화면 쪽(packapp.ts)이 id를 먼저 정해 own()에 올려 둠: 열기를 기다리는 동안 화면이 사라져도 멈출 수 있게
      if (opId !== undefined && (!/^[\w-]{1,64}$/.test(opId) || ops.has(opId) || tunnels.has(opId) || serials.has(opId))) throw new Error(tr('올바르지 않은 요청이에요'))
      const id = opId ?? `sr-${rand()}`
      const label = safeName(p.choice.path)
      const baud = perm.baud
      let read: SerialRead | undefined
      let stopped: SerialEnd | undefined
      // 포트가 열리기를 기다리는 동안에도 목록에 올려 개수 제한을 지키고, 그 사이 정지 요청이 와도 놓치지 않음
      serials.set(id, { connId, packId: t.pack.id, hash: t.hash, key, stop: (why) => ((stopped = (why ?? 'stopped') as SerialEnd), read?.stop(stopped)) })
      try {
        const cur = (await deps.listPorts()).find((x) => x.path === p.choice.path)
        if (!cur || identOf(cur) !== identOf(p.choice)) throw new Error(tr('고른 포트가 바뀌었어요. 다시 골라 주세요'))
        if (stopped) throw new Error(tr('전송을 멈췄어요')) // 포트 목록을 기다리는 동안 정지가 왔으면 열지 않음 (열기만 해도 장치가 다시 시작할 수 있음)
        const source = await openRead(p.choice.path, baud)
        read = startSerialRead({
          source,
          ms: (deps.serialMs ?? ((m) => m * 60_000))(perm.maxMinutes),
          maxBytes: perm.maxBytes,
          idleMs: deps.serialIdleMs ?? LIMITS.serialIdleSeconds * 1000,
          onLines: (lines, skipped) => deps.emit?.({ type: 'serial-data', id, lines, skipped }),
          onIdle: () => deps.emit?.({ type: 'serial-idle', id }),
          onEnd: (reason, bytes) => (serials.delete(id), deps.emit?.({ type: 'serial', state: 'closed', id, packId: t.pack.id, connId, reason, bytes }))
        })
      } catch (e) {
        serials.delete(id)
        throw e
      }
      deps.emit?.({ type: 'serial', state: 'open', id, packId: t.pack.id, connId, port: label, baud, endsAt: read.endsAt })
      if (stopped) read.stop(stopped)
      return { op, id, port: label, baud, endsAt: read.endsAt }
    }

    const fs = await deps.fsOf(connId)
    const home = await homeOf(fs)
    const rel = relOf(a, given)

    if (op === 'list') {
      const w = await resolveTarget(fs, home, perm, rel, 'dir')
      const all = (await fs.readdir(w.path)).map((e) => ({ name: safeName(e.name), kind: e.kind, size: e.size })).sort((x, y) => Number(y.kind === 'dir') - Number(x.kind === 'dir') || x.name.localeCompare(y.name))
      return { op, entries: all.slice(0, LIMITS.listEntries), truncated: all.length > LIMITS.listEntries }
    }

    if (op === 'text' || op === 'get') {
      const limited = op === 'text' ? { ...perm, maxBytes: Math.min(perm.maxBytes!, LIMITS.textPreview) } : perm
      const w = await resolveTarget(fs, home, limited, rel, 'file')
      const size = w.stat!.size
      if (op === 'text') {
        const o = begin(connId, t, opId)
        try {
          const chunks: Buffer[] = []
          await transfer(o.signal, fs.readStream(w.path), counter(limited.maxBytes!, () => {}), new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }))
          const buf = Buffer.concat(chunks)
          if (buf.subarray(0, 8000).includes(0)) throw new Error(tr('바이너리 파일이라 글자로 볼 수 없어요'))
          let text: string
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
          } catch {
            throw new Error(tr('UTF-8 파일이 아니라 글자로 볼 수 없어요'))
          }
          return { op, text: sanitizeOutput(text) } // 제어 문자·ANSI 제거, 비밀 가림
        } finally {
          o.end()
        }
      }
      const dest = await deps.ui.pickSave(safeName(baseOf(w.path)), ctx)
      if (!dest) return { op, saved: null, size: 0 }
      if (badSaveName(basename(dest))) throw new Error(tr('실행 파일 형식(.exe 등)으로는 저장할 수 없어요'))
      // 저장 대화상자가 열려 있는 동안 팩이 꺼졌거나 Device 파일이 링크로 바뀌었을 수 있음 → 대화상자 뒤에 팩 상태와 Device 경로를 다시 검사하고, 그 결과만 읽음
      if (deps.isActive && !deps.isActive(t.pack.id, t.hash)) throw new Error(tr('이 팩은 켜져 있지 않아요'))
      const w2 = await resolveTarget(fs, home, limited, rel, 'file')
      const o = begin(connId, t, opId)
      const tmp = `${dest}.jdpart-${rand()}`
      let lastEmit = 0
      try {
        await transfer(o.signal, fs.readStream(w2.path), counter(perm.maxBytes!, (n) => {
          if (Date.now() - lastEmit > 150) (lastEmit = Date.now(), deps.emit?.({ type: 'progress', opId: o.opId, done: n, total: size }))
        }), createWriteStream(tmp, { flags: 'wx' }))
        await fsRename(tmp, dest)
        // Windows: 인터넷에서 받은 파일 표시(ZoneId=3)를 달아 실행할 때 Windows 경고가 나오게 함. 실패해도(FAT 등 대체 스트림 없음) 받기는 성공
        if (process.platform === 'win32') await writeFile(`${dest}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n').catch(() => {})
      } catch (e) {
        await fsUnlink(tmp).catch(() => {})
        throw e
      } finally {
        o.end()
      }
      return { op, saved: safeName(basename(dest)), size }
    }

    if (op === 'put') {
      const w = await resolveTarget(fs, home, perm, rel, 'write')
      const p = typeof token === 'string' ? pending.get(token) : undefined
      // 확인한 것과 같아야 실행: 화면이 token을 바꾸거나 입력값·Device 상태가 prepare 뒤에 달라졌으면 거부
      if (!p || p.connId !== connId || Date.now() - p.at > PENDING_TTL || token !== sha(t.pack.id, t.hash, t.pluginId, a.id, 'put', w.path, w.exists ? 1 : 0, p.local, p.size, p.mtimeMs)) throw new Error(tr('확인한 내용과 달라요. 다시 확인해 주세요'))
      pending.delete(token as string)
      const st = await fsStat(p.local)
      if (!st.isFile() || st.size !== p.size || st.mtimeMs !== p.mtimeMs) throw new Error(tr('고른 파일이 바뀌었어요. 다시 골라 주세요'))
      const o = begin(connId, t, opId)
      const tmp = `${dirOf(w.path)}/.jdput-${rand()}.tmp`
      let lastEmit = 0
      try {
        await transfer(o.signal, createReadStream(p.local), counter(perm.maxBytes!, (n) => {
          if (Date.now() - lastEmit > 150) (lastEmit = Date.now(), deps.emit?.({ type: 'progress', opId: o.opId, done: n, total: p.size }))
        }), fs.writeStream(tmp, 0o644)) // 올린 파일 권한은 항상 0644 (실행 권한 없음)
        await fs.rename(tmp, w.path, w.exists) // 새 파일이면 대상이 생겨 있으면 실패, 덮어쓰기는 사용자가 확인했을 때만
        const after = await fs.stat(w.path)
        if (after?.size !== p.size) throw new Error(tr('올린 파일 크기가 달라요'))
      } catch (e) {
        await fs.unlink(tmp).catch(() => {})
        throw e
      } finally {
        o.end()
      }
      return { op, name: safeName(baseOf(w.path)), size: p.size, path: toTilde(w.path, home) }
    }

    throw new Error(tr('아직 지원하지 않는 동작이에요'))
  }

  const stopWhere = (f: (o: Op) => boolean, why?: string) => [...ops.values(), ...tunnels.values(), ...serials.values()].filter(f).forEach((o) => o.stop(why))
  return {
    prepare,
    run,
    stop: (opId: string): boolean => {
      const o = ops.get(opId) ?? tunnels.get(opId) ?? serials.get(opId)
      o?.stop()
      return !!o
    },
    stopConn: (connId: string) => stopWhere((o) => o.connId === connId, 'conn'),
    // 팩이 꺼졌거나 파일이 바뀌었으면 그 팩이 시작한 것을 모두 멈춤
    reconcile: (isActive: (packId: string, hash: string) => boolean) => stopWhere((o) => !isActive(o.packId, o.hash), 'pack'),
    stopAll: () => stopWhere(() => true, 'quit'),
    size: () => ops.size,
    tunnelCount: () => tunnels.size,
    serialCount: () => serials.size
  }
}
export type AppEngine = ReturnType<typeof createAppEngine>
