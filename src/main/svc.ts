import { ipcMain } from 'electron'
import type { ClientChannel } from 'ssh2'
import { tr } from './i18n.mts'
import { LiveSet } from './liveset.mts'
import { run } from './monitor'
import { ptyStream } from './ptystream'
import { requireClient as client } from './session'
import { shq } from './shq.mts'
import { actionCommand, followCommand, isSvcAction, isUnit, LIST_CMD, logsCommand, parseAction, parseServices, type ActionResult, type SvcData } from './svcparse.mts'

// 서비스 화면: Device의 systemctl·journalctl을 SSH로 실행 (설치할 것 없음). 시작·정지는 sudo -n로 먼저 시도하고, 비밀번호가 필요하면 화면이 새 터미널 탭으로 넘김
const follows = new LiveSet<ClientChannel>()

export function registerSvcIpc(): void {
  ipcMain.handle('svc:list', async (_e, connId: string): Promise<SvcData> => parseServices(await run(client(connId), `timeout 30 sh -c ${shq(LIST_CMD)}`)))
  ipcMain.handle('svc:action', async (_e, connId: string, unit: string, action: string): Promise<ActionResult> => {
    if (!isUnit(unit) || !isSvcAction(action)) throw new Error(tr('서비스 이름 또는 동작이 올바르지 않아요'))
    return parseAction(await run(client(connId), `timeout 60 sh -c ${shq(actionCommand(action, unit))}`))
  })
  ipcMain.handle('svc:logs', async (_e, connId: string, unit: string) => {
    if (!isUnit(unit)) throw new Error(tr('서비스 이름이 올바르지 않아요'))
    return (await run(client(connId), `timeout 30 ${logsCommand(unit)}`)).trimEnd()
  })
  ipcMain.handle('svc:follow', (e, connId: string, id: string, unit: string) => {
    if (!isUnit(unit)) throw new Error(tr('서비스 이름이 올바르지 않아요'))
    return ptyStream(e.sender, connId, String(id), followCommand(unit), follows, 'svc:data', 'svc:end')
  })
  ipcMain.handle('svc:unfollow', (_e, id: string) => follows.stop(String(id)))
}
