import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type { Stats } from 'ssh2'
import { tr } from './i18n.mts'
import { forwardOut, pipe } from './forward'
import { createAppEngine, type AppEvent, type DeviceFs } from './packappcore.mts'
import type { PackEntry } from './packstore.mts'
import type { Pack, PackAction } from './packschema.mts'
import { safeName, type FsKind, type FsStat } from './permpath.mts'
import { requireClient } from './session'
import { listChoices, openSerialRead } from './serial'
import { call, sftpOf } from './sftp'

// 팩의 앱 기능 권한 (6.0.0): 팩 항목(mode:'app')이 SFTP로 목록·받기·읽기·올리기를 한다. 화면은 (팩, 플러그인, 항목, 입력값, 토큰)만 보내고
// Device 경로는 main이 팩 템플릿 + 검사된 입력값으로 만든다. PC 경로는 OS 대화상자에서만 얻는다. 실제 규칙은 packappcore.mts·permpath.mts (Electron 없이 시험)
const kindOf = (st: Stats): FsKind => (st.isFile() ? 'file' : st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'link' : 'other')
const toStat = (st: Stats): FsStat => ({ kind: kindOf(st), size: st.size })
// 없음(상태 코드 2)만 null. 권한 오류 같은 나머지는 그대로 던져서 "없는 줄 알고" 진행하지 않음
const maybe = <T>(fn: (cb: (err: (Error & { code?: number }) | null | undefined, v?: T) => void) => void) =>
  new Promise<T | null>((resolve, reject) => fn((err, v) => (err ? (err.code === 2 ? resolve(null) : reject(err)) : resolve(v as T))))

async function deviceFs(connId: string): Promise<DeviceFs> {
  const s = await sftpOf(connId)
  return {
    realpath: (p) => call<string>((cb) => s.realpath(p, cb)),
    stat: async (p) => {
      const st = await maybe<Stats>((cb) => s.stat(p, cb))
      return st && toStat(st)
    },
    lstat: async (p) => {
      const st = await maybe<Stats>((cb) => s.lstat(p, cb))
      return st && toStat(st)
    },
    readdir: async (p) => (await call<{ filename: string; attrs: Stats }[]>((cb) => s.readdir(p, cb))).map(({ filename, attrs }) => ({ name: filename, kind: kindOf(attrs), size: attrs.size })),
    readStream: (p) => s.createReadStream(p),
    writeStream: (p, mode) => s.createWriteStream(p, { flags: 'wx', mode }), // wx: 누가 미리 만들어 둔 링크를 따라가 덮어쓰지 않게
    rename: (from, to, overwrite) =>
      overwrite
        ? new Promise<void>((resolve, reject) => {
            try {
              s.ext_openssh_rename(from, to, (err) => (err ? reject(err) : resolve())) // 기존 파일을 덮어쓰는 rename (OpenSSH 확장). 일반 rename은 대상이 있으면 실패
            } catch (err) {
              reject(err) // 서버가 확장을 지원하지 않으면 ssh2가 바로 예외를 던짐
            }
          })
        : call<void>((cb) => s.rename(from, to, cb)),
    unlink: (p) => call<void>((cb) => s.unlink(p, cb))
  }
}

let latest: PackEntry[] | null = null // 마지막으로 만들어진 팩 목록 (appReconcile이 채움)
const winOf = (ctx: unknown) => (ctx && typeof ctx === 'object' ? BrowserWindow.fromWebContents(ctx as WebContents) : null)
const engine = createAppEngine({
  fsOf: deviceFs,
  isActive: (id, hash) => !latest || latest.some((e) => e.id === id && e.enabled && e.hash === hash),
  ui: {
    async pickSave(defaultName, ctx) {
      const win = winOf(ctx)
      const opts = { title: tr('받은 파일 저장'), defaultPath: defaultName }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    },
    async pickOpen(ctx) {
      const win = winOf(ctx)
      const opts = { title: tr('올릴 파일 고르기'), properties: ['openFile' as const] }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
    },
    // 시리얼 포트 고르기: main이 여는 창이라 팩의 글자가 없다. 버튼 하나가 포트 하나, 맨 끝은 취소. 자동 선택·기억 없음
    async pickPort(choices, more, ctx) {
      const win = winOf(ctx)
      const buttons = [...choices.map((c) => `${safeName(c.path)} · ${safeName(c.label).slice(0, 40)}${c.vendorId && c.productId ? ` · ${safeName(c.vendorId)}:${safeName(c.productId)}` : ''}`.slice(0, 80)), tr('취소')]
      const opts = { type: 'question' as const, title: tr('시리얼 포트 고르기'), message: tr('읽을 포트를 고르세요'), detail: more ? tr('포트가 더 있어요. 목록에는 USB 포트를 먼저 8개까지만 보여요') : undefined, buttons, cancelId: buttons.length - 1, noLink: true }
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      return r.response >= choices.length ? null : r.response
    }
  },
  listPorts: listChoices,
  openRead: openSerialRead,
  connectTo: (connId, sock, remotePort) => forwardOut(requireClient(connId), sock, '127.0.0.1', remotePort, (stream) => pipe(sock, stream)), // Device 쪽은 127.0.0.1 고정 (다른 호스트로 못 감)
  emit: (e: AppEvent) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.isDestroyed() || w.webContents.send('pack:app-event', e))
})

// 팩 목록이 다시 만들어질 때(끄기·파일 변경·제거) 꺼졌거나 파일이 달라진 팩이 시작한 전송을 즉시 멈춤
export function appReconcile(entries: PackEntry[]): void {
  latest = entries
  engine.reconcile((id, hash) => entries.some((e) => e.id === id && e.enabled && e.hash === hash))
}

export type FindAction = (packId: string, pluginId: string, actionId: string) => { pack: Pack; action: PackAction; hash: string } // 켜진 팩의 항목만 찾음 (pack.ts find)

export function registerPackAppIpc(find: FindAction): void {
  const watched = new Set<string>()
  const target = (connId: string, packId: string, pluginId: string, actionId: string) => {
    const c = requireClient(connId)
    if (!watched.has(connId)) {
      watched.add(connId)
      c.once('close', () => (watched.delete(connId), engine.stopConn(connId))) // 연결이 끊기면 전송 중단
    }
    return { ...find(packId, pluginId, actionId), pluginId: String(pluginId) }
  }
  const values = (given: unknown): Record<string, string> | undefined => (given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, string>) : undefined)

  // 확인이 필요한 동작(올리기)의 준비: PC 파일 고르기 + 확인 창에 보일 정보 + token. null = 파일 고르기를 취소함
  ipcMain.handle('pack:app-prepare', (e, connId: string, packId: string, pluginId: string, actionId: string, given?: Record<string, string>) =>
    engine.prepare(String(connId), target(String(connId), packId, pluginId, actionId), values(given), e.sender)
  )
  // 화면(렌더러)이 죽거나 다시 불러지거나 창이 닫히면 그 화면이 시작한 전송·터널을 멈춤 (멈춤 신호를 보낼 화면이 없으므로)
  const owned = new Map<WebContents, Set<string>>()
  const own = (wc: WebContents, id: string) => {
    let ids = owned.get(wc)
    if (!ids) {
      const set = (ids = new Set<string>())
      owned.set(wc, set)
      const drop = () => (set.forEach((x) => engine.stop(x)), set.clear())
      wc.once('destroyed', () => (drop(), owned.delete(wc)))
      wc.on('render-process-gone', drop)
      wc.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && drop())
    }
    ids.add(id)
  }
  ipcMain.handle('pack:app-run', async (e, connId: string, packId: string, pluginId: string, actionId: string, given?: Record<string, string>, token?: string, opId?: string) => {
    const id = opId === undefined ? undefined : String(opId)
    if (id) own(e.sender, id) // 전송은 시작 전에 올려 둠: 도중에 화면이 사라져도 멈출 수 있게
    const r = await engine.run(String(connId), target(String(connId), packId, pluginId, actionId), values(given), token, id, e.sender)
    if (r.op === 'open' || r.op === 'read') own(e.sender, r.id)
    return r
  })
  ipcMain.handle('pack:app-stop', (_e, opId: string): boolean => engine.stop(String(opId)))
  app.on('before-quit', () => engine.stopAll())
}
