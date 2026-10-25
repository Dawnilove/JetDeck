import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join as joinLocal } from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { SFTPWrapper, Stats } from 'ssh2'
import { call, checkName, join as joinRemote, sftpOf } from './sftp'
import { mapLimit, planTree, type Plan, type TreeNode } from './xferplan.mts'
import { tr } from './i18n.mts'

// 파일 전송 (design/Files.dc.html): 내 컴퓨터 ↔ 젯슨, SFTP만 사용
export type LocalEntry = { name: string; path: string; dir: boolean; size: number; mtime: number }
// src가 폴더면 main이 안의 파일들로 펼침 (label: 폴더 안 파일의 '폴더/하위/이름' 표시용)
export type JobIn = { kind: 'up' | 'down'; src: string; dstDir: string; name: string; size: number; label?: string }
// job: 어느 화면(파일 전송·탐색기 우클릭)에서 시작했든 대기열 표시와 목록 새로고침에 쓰도록 매번 같이 보냄
export type XferEvent = { id: string; connId: string; status: 'queued' | 'running' | 'done' | 'error' | 'canceled'; done: number; total: number; error?: string; job: JobIn }
type Job = JobIn & { id: string; connId: string; wc: WebContents; abort: AbortController }
const CHUNK = 256 * 1024 // 한 번에 읽는 크기: 작으면 왕복 지연 때문에 느려짐
const CONCURRENCY = 4 // 동시에 보내는 파일 수 (작은 파일이 많을 때 왕복 지연을 가림)
const fixLocalName = (n: string) => n.replace(/[\\/:*?"<>|]/g, '_')

function validate(j: JobIn): JobIn {
  if (j.kind !== 'up' && j.kind !== 'down') throw new Error(tr('전송 종류가 올바르지 않아요'))
  if (j.kind === 'up' && /[\\/]/.test(j.name)) throw new Error(tr('파일 이름이 올바르지 않아요'))
  return { kind: j.kind, src: String(j.src), dstDir: String(j.dstDir), name: j.kind === 'up' ? checkName(j.name) : fixLocalName(String(j.name)), size: Number(j.size) || 0, label: j.label ? String(j.label) : undefined }
}
const dstOf = (j: JobIn) => (j.kind === 'up' ? joinRemote(j.dstDir, j.name) : joinLocal(j.dstDir, j.name))

const queue: Job[] = []
const active = new Set<Job>()
const emit = (j: Job, e: Omit<XferEvent, 'id' | 'connId' | 'job'>) =>
  !j.wc.isDestroyed() && j.wc.send('xfer', { id: j.id, connId: j.connId, ...e, job: { kind: j.kind, src: j.src, dstDir: j.dstDir, name: j.name, size: j.size, label: j.label } })

// 원자적 전송: 같은 폴더 임시 파일로 다 받은 뒤 이름 바꾸기 → 중간에 끊겨도 기존 파일은 그대로
async function runJob(j: Job): Promise<void> {
  const s = await sftpOf(j.connId)
  const dst = dstOf(j)
  let last = 0
  const step = (done: number, _chunk: number, total: number) => {
    const now = Date.now()
    if (now - last > 200) {
      last = now
      emit(j, { status: 'running', done, total })
    }
  }
  // 취소할 수 있게 스트림으로 복사 (fastPut/fastGet은 중간에 멈출 방법이 없음). 지나간 바이트로 진행률 계산
  let done = 0
  const count = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length
      step(done, chunk.length, j.size)
      cb(null, chunk)
    }
  })
  const signal = j.abort.signal
  if (j.kind === 'up') {
    const tmp = joinRemote(j.dstDir, `.${j.name}.nanoterm-${Date.now()}.part`)
    const old = await call<Stats>((cb) => s.stat(dst, cb)).catch(() => null)
    try {
      await pipeline(createReadStream(j.src, { highWaterMark: CHUNK }), count, s.createWriteStream(tmp, { flags: 'wx' }), { signal })
      if (old) await call((cb) => s.chmod(tmp, old.mode & 0o7777, cb)).catch(() => {}) // 덮어쓸 때 기존 권한 유지 (안 되는 서버면 기본 권한으로)
      await call((cb) => s.ext_openssh_rename(tmp, dst, cb)).catch(async () => {
        // OpenSSH 확장이 없는 서버: 기존 파일을 지우고 일반 rename (아주 짧은 순간 파일이 없을 수 있음)
        if (old) await call((cb) => s.unlink(dst, cb))
        await call((cb) => s.rename(tmp, dst, cb))
      })
    } catch (err) {
      await call((cb) => s.unlink(tmp, cb)).catch(() => {})
      throw err
    }
  } else {
    const tmp = joinLocal(j.dstDir, `.${j.name}.nanoterm-${Date.now()}.part`)
    try {
      await pipeline(s.createReadStream(j.src, { highWaterMark: CHUNK }), count, createWriteStream(tmp, { flags: 'wx' }), { signal })
      renameSync(tmp, dst) // Windows에서도 기존 파일을 교체
    } catch (err) {
      if (existsSync(tmp)) unlinkSync(tmp)
      throw err
    }
  }
}

// 대기열에서 꺼내 CONCURRENCY개까지 동시에 전송. 하나가 끝나면 다음 것을 꺼냄
function pump(): void {
  while (active.size < CONCURRENCY && queue.length) {
    const j = queue.shift()!
    active.add(j)
    emit(j, { status: 'running', done: 0, total: j.size })
    runJob(j)
      .then(() => emit(j, { status: 'done', done: j.size, total: j.size }))
      .catch((err) => {
        if (j.abort.signal.aborted) emit(j, { status: 'canceled', done: 0, total: j.size })
        else emit(j, { status: 'error', done: 0, total: j.size, error: (err as Error).message })
      })
      .finally(() => {
        active.delete(j)
        pump()
      })
  }
}

// 폴더가 섞인 작업 목록 → 파일 작업 목록 + 받는 쪽에 만들 폴더 (폴더는 안의 파일들로 펼침)
async function expand(connId: string, jobs: JobIn[]): Promise<{ files: JobIn[]; dirs: { kind: 'up' | 'down'; path: string }[] }> {
  const s = await sftpOf(connId)
  const files: JobIn[] = []
  const dirs: { kind: 'up' | 'down'; path: string }[] = []
  for (const j of jobs.map(validate)) {
    const isDir = j.kind === 'up' ? statSync(j.src).isDirectory() : (await call<Stats>((cb) => s.stat(j.src, cb))).isDirectory()
    if (!isDir) {
      files.push(j)
      continue
    }
    const plan: Plan =
      j.kind === 'up'
        ? await planTree(listLocal, joinLocal, joinRemote, j.src, joinRemote(j.dstDir, j.name), j.name)
        : await planTree((d) => listRemote(s, d), joinRemote, joinLocal, j.src, joinLocal(j.dstDir, j.name), j.name, fixLocalName)
    files.push(...plan.files.map((f) => ({ kind: j.kind, ...f })))
    dirs.push(...plan.dirs.map((path) => ({ kind: j.kind, path })))
  }
  return { files, dirs }
}
// shortcut: 심볼릭 링크로 연결된 폴더는 건너뜀 (순환 방지), 링크된 파일은 일반 파일로 전송
const listLocal = async (dir: string): Promise<TreeNode[]> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((de) => {
    try {
      const st = statSync(joinLocal(dir, de.name))
      if (de.isSymbolicLink() && st.isDirectory()) return []
      return st.isDirectory() || st.isFile() ? [{ name: de.name, dir: st.isDirectory(), size: st.size }] : []
    } catch {
      return [] // 권한이 없거나 깨진 링크
    }
  })
async function listRemote(s: SFTPWrapper, dir: string): Promise<TreeNode[]> {
  const list = await call<{ filename: string; attrs: Stats }[]>((cb) => s.readdir(dir, cb))
  const nodes = await mapLimit(list, 8, async ({ filename, attrs }) => {
    const st = attrs.isSymbolicLink() ? await call<Stats>((cb) => s.stat(joinRemote(dir, filename), cb)).catch(() => null) : attrs
    if (!st || (attrs.isSymbolicLink() && st.isDirectory())) return null
    return st.isDirectory() || st.isFile() ? { name: filename, dir: st.isDirectory(), size: st.size } : null
  })
  return nodes.filter((n) => n !== null)
}
async function makeDirs(connId: string, dirs: { kind: 'up' | 'down'; path: string }[]): Promise<void> {
  const s = await sftpOf(connId)
  for (const d of dirs) {
    if (d.kind === 'down') mkdirSync(d.path, { recursive: true })
    else if (!(await call<Stats>((cb) => s.stat(d.path, cb)).catch(() => null))) await call((cb) => s.mkdir(d.path, cb))
  }
}

export function registerTransferIpc(): void {
  // 내 컴퓨터 폴더 목록 (권한 없는 항목은 건너뜀). parent=null이면 드라이브 최상위
  ipcMain.handle('local:list', (_e, dir?: string) => {
    const d = dir ? String(dir) : homedir()
    const entries: LocalEntry[] = readdirSync(d, { withFileTypes: true }).flatMap((de) => {
      try {
        const p = joinLocal(d, de.name)
        const st = statSync(p)
        return [{ name: de.name, path: p, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs }]
      } catch {
        return []
      }
    })
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    return { dir: d, parent: dirname(d) === d ? null : dirname(d), entries }
  })

  // 덮어쓰게 될 파일 이름 목록 (폴더는 안의 파일 기준, '폴더/하위/이름') → 화면에서 확인받은 뒤 전송
  ipcMain.handle('xfer:conflicts', async (_e, connId: string, jobs: JobIn[]) => {
    const s = await sftpOf(connId)
    const { files } = await expand(connId, jobs)
    const hits = await mapLimit(files, 8, async (j) =>
      j.kind === 'down' ? existsSync(dstOf(j)) : await call<Stats>((cb) => s.stat(dstOf(j), cb)).then(() => true, () => false)
    )
    return files.filter((_, i) => hits[i]).map((j) => j.label ?? j.name)
  })

  ipcMain.handle('xfer:add', async (e, connId: string, jobs: JobIn[]) => {
    const { files, dirs } = await expand(connId, jobs)
    await makeDirs(connId, dirs) // 빈 폴더도 만들어짐
    const added = files.map((j) => ({ ...j, id: randomUUID(), connId: String(connId), wc: e.sender, abort: new AbortController() }))
    queue.push(...added)
    added.forEach((j) => emit(j, { status: 'queued', done: 0, total: j.size }))
    pump()
    return added.map((j) => j.id)
  })

  // 탐색기 우클릭 "여기에 업로드": 보낼 파일 고르기 (크기는 진행률용)
  ipcMain.handle('dialog:pickUpload', async (e, folder?: boolean) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: folder ? tr('Device에 올릴 폴더 선택') : tr('Device에 올릴 파일 선택'), properties: [folder ? 'openDirectory' : 'openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths.map((p) => ({ path: p, name: basename(p), size: folder ? 0 : statSync(p).size }))
  })
  // 탐색기 우클릭 "내 PC로 다운로드": 받을 폴더 고르기 (기본: 다운로드 폴더)
  ipcMain.handle('dialog:pickDownloadDir', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('받을 폴더 선택'), defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // 전송 취소: 대기 중이면 줄에서 빼고, 전송 중이면 스트림을 끊음 (임시 파일은 지워지고 기존 파일은 그대로)
  ipcMain.handle('xfer:cancel', (_e, id: string) => {
    const i = queue.findIndex((j) => j.id === id)
    if (i >= 0) {
      const [j] = queue.splice(i, 1)
      return emit(j, { status: 'canceled', done: 0, total: j.size })
    }
    ;[...active].find((j) => j.id === id)?.abort.abort()
  })
}
