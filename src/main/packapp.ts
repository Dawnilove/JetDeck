import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type { Stats } from 'ssh2'
import { tr } from './i18n.mts'
import { forwardOut, pipe } from './forward'
import { createAppEngine, type AppEvent, type DeviceFs } from './packappcore.mts'
import type { PackEntry } from './packstore.mts'
import type { Pack, PackAction } from './packschema.mts'
import type { FsKind, FsStat } from './permpath.mts'
import { requireClient } from './session'
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

const winOf = (ctx: unknown) => (ctx && typeof ctx === 'object' ? BrowserWindow.fromWebContents(ctx as WebContents) : null)
const engine = createAppEngine({
  fsOf: deviceFs,
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
    }
  },
  connectTo: (connId, sock, remotePort) => forwardOut(requireClient(connId), sock, '127.0.0.1', remotePort, (stream) => pipe(sock, stream)), // Device 쪽은 127.0.0.1 고정 (다른 호스트로 못 감)
  emit: (e: AppEvent) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.isDestroyed() || w.webContents.send('pack:app-event', e))
})

// 팩 목록이 다시 만들어질 때(끄기·파일 변경·제거) 꺼졌거나 파일이 달라진 팩이 시작한 전송을 즉시 멈춤
export const appReconcile = (entries: PackEntry[]): void => engine.reconcile((id, hash) => entries.some((e) => e.id === id && e.enabled && e.hash === hash))

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
  ipcMain.handle('pack:app-run', (e, connId: string, packId: string, pluginId: string, actionId: string, given?: Record<string, string>, token?: string, opId?: string) =>
    engine.run(String(connId), target(String(connId), packId, pluginId, actionId), values(given), token, opId === undefined ? undefined : String(opId), e.sender)
  )
  ipcMain.handle('pack:app-stop', (_e, opId: string): boolean => engine.stop(String(opId)))
  app.on('before-quit', () => engine.stopAll())
}
