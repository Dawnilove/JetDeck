import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir, release, userInfo } from 'os'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { recentActs } from './activity'
import { buildDiag, recentLogs } from './diagbundle.mts'
import { getLang, tr } from './i18n.mts'
import { listHosts } from './store'

// 진단 번들 저장 (4.4.0): 내용은 diagbundle.mts가 만들고, 여기서는 모아서 사용자가 고른 파일에 씀
export function registerDiagIpc(): void {
  ipcMain.handle('diag:save', async (e): Promise<string | null> => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('진단 정보 저장'), defaultPath: join(app.getPath('documents'), 'jetdeck-diagnostics.txt'), filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (r.canceled || !r.filePath) return null
    const hosts = listHosts()
    const text = buildDiag({
      version: app.getVersion(),
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      lang: getLang(),
      hosts,
      acts: recentActs(),
      logs: recentLogs(),
      scrubOpts: { home: homedir(), user: userInfo().username, names: hosts.flatMap((h) => [h.name, h.host, h.username]) }
    })
    writeFileSync(r.filePath, text, 'utf8')
    return r.filePath
  })
}
