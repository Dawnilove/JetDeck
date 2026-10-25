import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tr } from './i18n.mts'

// 터미널 로그 저장 (4.4.0): 화면이 만든 글자를 사용자가 고른 파일로 씀. 비밀 가리기는 하지 않음(내 터미널의 내 기록이라서)
export function registerTermLogIpc(): void {
  ipcMain.handle('termlog:save', async (e, text: string, name: string): Promise<string | null> => {
    const safe = String(name ?? 'terminal').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'terminal'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('터미널 로그 저장'), defaultPath: join(app.getPath('documents'), `jetdeck-${safe}-${stamp}.log`), filters: [{ name: 'Log', extensions: ['log', 'txt'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, String(text ?? ''), 'utf8')
    return r.filePath
  })
}
