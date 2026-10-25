import { ipcMain } from 'electron'
import type { Client } from 'ssh2'
import { tr } from './i18n.mts'
import { run } from './monitor'
import { isPid, killCommand, parseKill, parseProcs, PS_CMD, type Proc } from './procparse.mts'
import { requireClient as client } from './session'
import { shq } from './shq.mts'

// 프로세스 목록·종료: 젯슨에는 아무것도 설치하지 않고 ps·kill만 SSH로 실행

// ps 결과를 연결별로 1.5초 동안 같이 씀: 프로세스 화면(2초마다)과 다른 접속 관찰(2초마다)이 따로 ps를 돌리지 않게
const snaps = new WeakMap<Client, { t: number; p: Promise<string> }>()
export function psSnapshot(c: Client): Promise<string> {
  const hit = snaps.get(c)
  if (hit && Date.now() - hit.t < 1500) return hit.p
  const p = run(c, `timeout 15 sh -c ${shq(PS_CMD)}`)
  snaps.set(c, { t: Date.now(), p })
  p.catch(() => snaps.delete(c))
  return p
}

export function registerProcIpc(): void {
  ipcMain.handle('proc:list', async (_e, connId: string): Promise<{ me: string; procs: Proc[] }> => parseProcs(await psSnapshot(client(connId))))
  // 화면에서 확인 창을 거친 뒤에만 부름. 권한(내 계정만)은 kill 자체가 막고, 화면은 미리 버튼을 막아 둠
  ipcMain.handle('proc:kill', async (_e, connId: string, pid: number, args: string, force: boolean): Promise<void> => {
    if (!isPid(pid) || typeof args !== 'string' || !args || args.length > 4096 || /[\0\n]/.test(args)) throw new Error(tr('프로세스 정보가 올바르지 않아요'))
    const c = client(connId)
    const out = await run(c, `timeout 15 sh -c ${shq(killCommand(pid, args, force === true))}`)
    snaps.delete(c) // 종료 뒤 바로 다시 읽을 때 옛 목록을 쓰지 않게
    parseKill(out)
  })
}
