import { ipcMain } from 'electron'
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { run } from './monitor'
import { requireClient } from './session'
import { shq } from './shq.mts'
import { tr } from './i18n.mts'

// 젯슨에 아무것도 설치하지 않고 SSH의 SFTP 채널만으로 파일을 다룸
export type Entry = { name: string; path: string; dir: boolean; size: number; perm: string } // perm: ls -l 형식(-rw-r--r--)
const MAX_OPEN = 5 * 1024 * 1024

// SFTP 채널은 연결당 하나를 만들어 재사용
const cache = new WeakMap<Client, Promise<SFTPWrapper>>()
export function sftpOf(connId: string): Promise<SFTPWrapper> {
  const client = requireClient(connId)
  let p = cache.get(client)
  if (!p) {
    p = new Promise((resolve, reject) =>
      client.sftp((err, s) => {
        if (err) return reject(err)
        // 'error' 리스너가 없으면 SFTP 치명 오류 때 main 프로세스가 죽음. 닫히면 캐시에서 빼서 다음 작업 때 새로 엶
        s.on('error', () => {})
        s.once('close', () => cache.delete(client))
        resolve(s)
      })
    )
    cache.set(client, p)
    p.catch(() => cache.delete(client))
  }
  return p
}

// 콜백 API → Promise
export const call = <T = void>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(friendly(err)) : resolve(v as T))))

// SFTP 상태 코드 → 쉬운 문장 (2: 없음, 3: 권한, 4: 일반 실패, 11: 이미 있음)
function friendly(err: Error & { code?: number }): Error {
  const msg = { 2: tr('파일이나 폴더가 없어요'), 3: tr('권한이 없어요'), 4: tr('작업에 실패했어요'), 11: tr('같은 이름이 이미 있어요') }[err.code ?? 0]
  return new Error(msg ?? err.message)
}

export const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
// 이름 바꾸기·새로 만들기에서 경로 조작(../, /) 막기
export function checkName(name: string): string {
  const n = String(name).trim()
  if (!n || n === '.' || n === '..' || n.includes('/')) throw new Error(tr('이름에 / 를 쓸 수 없고 비워 둘 수 없어요'))
  return n
}

// 폴더 펼칠 때만 읽음(지연 로딩). 폴더 먼저, 이름순 — 화면(fs:list)과 MCP가 같이 씀
export async function listDir(connId: string, dir: string): Promise<Entry[]> {
  const s = await sftpOf(connId)
  const list = await call<{ filename: string; longname: string; attrs: Stats }[]>((cb) => s.readdir(String(dir), cb))
  const entries = await Promise.all(
    list.map(async ({ filename, longname, attrs }) => {
      const path = join(dir, filename)
      // 심볼릭 링크는 가리키는 대상이 폴더인지 확인 (깨진 링크는 파일로 취급)
      const dirLike = attrs.isSymbolicLink() ? await call<Stats>((cb) => s.stat(path, cb)).then((st) => st.isDirectory(), () => false) : attrs.isDirectory()
      return { name: filename, path, dir: dirLike, size: attrs.size, perm: longname.split(/\s+/)[0] ?? '' }
    })
  )
  return entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

export async function readText(connId: string, path: string): Promise<{ text: string; mtime: number }> {
  const s = await sftpOf(connId)
  const st = await call<Stats>((cb) => s.stat(String(path), cb))
  if (st.isDirectory()) throw new Error(tr('폴더는 열 수 없어요'))
  // /dev/zero·FIFO 같은 특수 파일은 크기가 0이어도 끝없이 읽힘
  if (!st.isFile()) throw new Error(tr('일반 파일만 편집기로 열 수 있어요'))
  if (st.size > MAX_OPEN) throw new Error(tr('5MB가 넘는 파일은 편집기로 열 수 없어요'))
  const buf = await call<Buffer>((cb) => s.readFile(String(path), cb))
  if (buf.subarray(0, 8000).includes(0)) throw new Error(tr('바이너리 파일이라 편집기로 열 수 없어요'))
  // UTF-8이 아닌 파일(EUC-KR 등)을 열면 글자가 깨지고, 저장하면 원본까지 망가지므로 거부
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    throw new Error(tr('UTF-8 파일이 아니라 편집기로 열 수 없어요 (터미널에서 iconv로 변환해 주세요)'))
  }
  return { text, mtime: st.mtime }
}

// 원자적 저장: 같은 폴더 임시 파일에 다 쓴 뒤 rename으로 교체 → 저장 중 끊겨도 원본은 그대로
export async function writeText(connId: string, path: string, text: string, mtime: number | null, force: boolean): Promise<{ conflict: true } | { mtime: number }> {
  const s = await sftpOf(connId)
  path = String(path)
  const st = await call<Stats>((cb) => s.stat(path, cb)).catch(() => null)
  // 열어둔 뒤 원격에서 바뀌었으면 덮어쓰기 전에 화면에 확인 요청
  if (st && !force && mtime != null && st.mtime !== mtime) return { conflict: true as const }
  // 심볼릭 링크(~/.bashrc → dotfiles 등)는 실제 대상 파일을 교체해야 링크가 일반 파일로 바뀌지 않음
  if (st) path = await call<string>((cb) => s.realpath(path, cb)).catch(() => path)
  const data = Buffer.from(String(text), 'utf8')
  const tmp = join(dirOf(path), `.${baseOf(path)}.nanoterm-${Date.now()}.tmp`)
  try {
    await call((cb) => s.writeFile(tmp, data, { flag: 'wx' }, cb)) // wx: 누가 미리 만들어 둔 링크를 따라가 덮어쓰지 않게
    // shortcut: 권한(mode)만 원본과 맞춤, 소유자·그룹은 접속 계정으로 바뀜 — 다른 사용자 파일 편집이 필요해지면 chown 추가
    if (st) await call((cb) => s.chmod(tmp, st.mode & 0o7777, cb))
    await new Promise<void>((resolve, reject) => {
      try {
        s.ext_openssh_rename(tmp, path, (err) => (err ? reject(err) : resolve())) // 기존 파일을 덮어쓰는 rename (OpenSSH 확장)
      } catch (err) {
        reject(err) // 서버가 확장을 지원하지 않으면 ssh2가 바로 예외를 던짐
      }
    })
  } catch (err) {
    await call((cb) => s.unlink(tmp, cb)).catch(() => {})
    // 폴더에 쓰기 권한이 없거나(파일만 쓰기 가능) rename 확장이 없으면 원본에 직접 씀 (원자적이진 않지만 저장은 됨)
    await call((cb) => s.writeFile(path, data, cb)).catch(() => Promise.reject(err))
  }
  const after = await call<Stats>((cb) => s.stat(path, cb))
  return { mtime: after.mtime }
}

export function registerSftpIpc(): void {
  ipcMain.handle('fs:home', async (_e, connId: string) => {
    const s = await sftpOf(connId)
    return call<string>((cb) => s.realpath('.', cb))
  })
  ipcMain.handle('fs:list', (_e, connId: string, dir: string) => listDir(connId, dir))
  ipcMain.handle('fs:read', (_e, connId: string, path: string) => readText(connId, path))
  ipcMain.handle('fs:write', (_e, connId: string, path: string, text: string, mtime: number | null, force: boolean) => writeText(connId, path, text, mtime, force))

  ipcMain.handle('fs:newFile', async (_e, connId: string, dir: string, name: string) => {
    const s = await sftpOf(connId)
    const path = join(String(dir), checkName(name))
    const handle = await call<Buffer>((cb) => s.open(path, 'wx', cb)) // wx: 이미 있으면 실패 → 덮어쓰기 방지
    await call((cb) => s.close(handle, cb))
    return path
  })

  ipcMain.handle('fs:newFolder', async (_e, connId: string, dir: string, name: string) => {
    const s = await sftpOf(connId)
    const path = join(String(dir), checkName(name))
    await call((cb) => s.mkdir(path, cb))
    return path
  })

  // 일반 rename은 대상이 있으면 실패 → 실수로 다른 파일을 덮지 않음
  ipcMain.handle('fs:rename', async (_e, connId: string, path: string, name: string) => {
    const s = await sftpOf(connId)
    const to = join(dirOf(String(path)), checkName(name))
    await call((cb) => s.rename(String(path), to, cb))
    return to
  })

  // Ctrl+P 파일 찾기용 목록. 숨김 폴더·ROS 빌드 산출물(build/install/log)·node_modules는 건너뜀
  ipcMain.handle('fs:find', async (_e, connId: string, dir: string) => {
    const client = requireClient(connId)
    // '-'로 시작하면 find 옵션(-delete 등)으로 해석되므로 절대 경로만 받음
    if (!String(dir).startsWith('/')) throw new Error(tr('절대 경로가 아니에요'))
    const out = await run(
      client,
      `find ${shq(String(dir))} -maxdepth 6 \\( -name '.*' -o -name node_modules -o -name build -o -name install -o -name log -o -name __pycache__ \\) -prune -o -type f -print 2>/dev/null | head -n 5000`
    )
    return out.split('\n').filter(Boolean)
  })

  // 폴더는 비어 있을 때만 삭제 (재귀 삭제는 실수 한 번에 날아가므로 지원 안 함)
  ipcMain.handle('fs:delete', async (_e, connId: string, path: string, dir: boolean) => {
    const s = await sftpOf(connId)
    if (dir) await call((cb) => s.rmdir(String(path), cb)).catch(() => Promise.reject(new Error(tr('비어 있지 않은 폴더는 지울 수 없어요. 터미널에서 지워 주세요'))))
    else await call((cb) => s.unlink(String(path), cb))
  })
}
