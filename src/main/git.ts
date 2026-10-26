import { ipcMain } from 'electron'
import { tr } from './i18n.mts'
import { gitCommand } from './gitcmd.mts'
import { parseGit, type GitInfo } from './gitparse.mts'
import { run } from './monitor'
import { requireClient } from './session'
import { shq } from './shq.mts'

// Git 상태: 탐색기가 폴더를 읽을 때 그 폴더가 저장소 안이면 브랜치·변경 파일을 같이 보여 줌 (git CLI만 SSH로 실행, 저장소가 아니면 null)
export function registerGitIpc(): void {
  ipcMain.handle('git:status', async (_e, connId: string, dir: string): Promise<GitInfo | null> => {
    if (!String(dir).startsWith('/') || /[\0\n]/.test(dir)) throw new Error(tr('절대 경로가 아니에요'))
    return parseGit(await run(requireClient(connId), gitCommand(shq(dir))))
  })
}
