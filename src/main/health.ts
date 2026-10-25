import { ipcMain } from 'electron'
import { healthCmd, parseHealth, type Health } from './healthparse.mts'
import { run } from './monitor'
import { requireClient as client } from './session'
import { shq } from './shq.mts'

// 기기 점검: sysfs·proc·systemctl을 읽기만 함 (설치·설정 변경 없음). smartctl은 Device에 이미 있을 때만 sudo -n로 실행
export function registerHealthIpc(): void {
  ipcMain.handle('health:read', async (_e, connId: string, smart: boolean): Promise<Health> => parseHealth(await run(client(connId), `timeout 60 sh -c ${shq(healthCmd(!!smart))}`)))
}
