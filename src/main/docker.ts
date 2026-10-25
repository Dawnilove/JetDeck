import { ipcMain } from 'electron'
import { tr } from './i18n.mts'
import { run } from './monitor'
import { actionCommand, isContainerRef, isDockerAction, LIST_CMD, logsCommand, parseDocker, type DockerData } from './dockerparse.mts'
import { requireClient as client } from './session'
import { shq } from './shq.mts'

// Docker 패널: 젯슨에는 아무것도 설치하지 않고 SSH로 docker CLI만 실행 (설치·권한 설정은 안내만)
export function registerDockerIpc(): void {
  // 60초 안에 안 끝나면(데몬 멈춤 등) 포기
  ipcMain.handle('docker:list', async (_e, connId: string): Promise<DockerData> => parseDocker(await run(client(connId), `timeout 60 sh -c ${shq(LIST_CMD)}`)))
  ipcMain.handle('docker:action', async (_e, connId: string, ref: string, action: string) => {
    if (!isContainerRef(ref) || !isDockerAction(action)) throw new Error(tr('컨테이너 이름 또는 동작이 올바르지 않아요'))
    return (await run(client(connId), `timeout 60 ${actionCommand(action, ref)}`)).trim()
  })
  ipcMain.handle('docker:logs', async (_e, connId: string, ref: string) => {
    if (!isContainerRef(ref)) throw new Error(tr('컨테이너 이름이 올바르지 않아요'))
    return (await run(client(connId), `timeout 30 ${logsCommand(ref)}`)).trimEnd()
  })
}
