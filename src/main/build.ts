import { ipcMain } from 'electron'
import type { ClientChannel } from 'ssh2'
import { tr } from './i18n.mts'
import { buildCommand, isBuildDir, isPackages, WS_CMD, type BuildKind } from './buildparse.mts'
import { LiveSet } from './liveset.mts'
import { run } from './monitor'
import { ptyStream } from './ptystream'
import { requireClient } from './session'
import { shq } from './shq.mts'

// 빌드 도구: Device의 colcon·catkin_make를 SSH로 실행해 출력을 화면에 흘려 보냄 (ROS 환경은 사용자의 ~/.bashrc에서)
const builds = new LiveSet<ClientChannel>()

export function registerBuildIpc(): void {
  ipcMain.handle('build:workspaces', async (_e, connId: string): Promise<string[]> => (await run(requireClient(connId), WS_CMD)).split('\n').filter(Boolean))
  ipcMain.handle('build:start', (e, connId: string, id: string, kind: BuildKind, dir: string, symlink: boolean, packages: string) => {
    dir = String(dir)
    packages = String(packages ?? '')
    if (!isBuildDir(dir)) throw new Error(tr('절대 경로가 아니에요'))
    if (!isPackages(packages)) throw new Error(tr('패키지 이름은 영문·숫자·_·-·. 만 쓸 수 있어요'))
    return ptyStream(e.sender, connId, String(id), buildCommand(kind === 'catkin' ? 'catkin' : 'colcon', shq(dir), { symlink: !!symlink, packages }), builds, 'build:data', 'build:end')
  })
  ipcMain.handle('build:stop', (_e, id: string) => builds.stop(String(id)))
}
