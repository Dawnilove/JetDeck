import { ipcMain } from 'electron'
import { tr } from './i18n.mts'
import { run } from './monitor'
import { grepCommand, parseGrep, replaceText, type Hit, type SearchOpts } from './searchparse.mts'
import { requireClient } from './session'
import { readText, writeText } from './sftp'
import { shq } from './shq.mts'

export type ReplaceResult = { files: number; matches: number; failed: { path: string; error: string }[] }

const opts = (o: Partial<SearchOpts>): SearchOpts => ({ regex: !!o?.regex, matchCase: !!o?.matchCase })
const needQuery = (q: string) => {
  if (!q || /[\0\n\r]/.test(q)) throw new Error(tr('찾을 글자를 한 줄로 입력하세요'))
}
const needAbs = (p: string) => {
  if (!p.startsWith('/') || /[\0\n]/.test(p)) throw new Error(tr('절대 경로가 아니에요'))
}

// 원격 파일 검색·전체 바꾸기: Device에는 grep만 쓰고, 바꾸기는 SFTP로 읽고 쓰는 편집기와 같은 길(충돌 확인·원자적 저장)
export function registerSearchIpc(): void {
  ipcMain.handle('search:grep', async (_e, connId: string, dir: string, query: string, o: Partial<SearchOpts>): Promise<{ hits: Hit[]; truncated: boolean }> => {
    dir = String(dir)
    query = String(query)
    needAbs(dir)
    needQuery(query)
    return parseGrep(await run(requireClient(connId), grepCommand(shq(dir), shq(query), opts(o))))
  })
  ipcMain.handle('search:replace', async (_e, connId: string, paths: string[], query: string, repl: string, o: Partial<SearchOpts>): Promise<ReplaceResult> => {
    query = String(query)
    needQuery(query)
    requireClient(connId)
    const res: ReplaceResult = { files: 0, matches: 0, failed: [] }
    for (const path of paths.map(String)) {
      try {
        needAbs(path)
        const { text, mtime } = await readText(connId, path)
        const r = replaceText(text, query, String(repl), opts(o))
        if (!r.count) continue
        // force=false: 읽은 뒤 Device에서 파일이 바뀌었으면 덮어쓰지 않음
        if ('conflict' in (await writeText(connId, path, r.text, mtime, false))) throw new Error(tr('읽은 뒤에 파일이 바뀌어 건너뛰었어요'))
        res.files++
        res.matches += r.count
      } catch (e) {
        res.failed.push({ path, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return res
  })
}
