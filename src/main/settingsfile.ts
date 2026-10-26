import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tr } from './i18n.mts'
import { buildExport, parseImport, type Snip } from './settingsio.mts'
import { buildSnippetPack } from './snippack.mts'
import { addHosts, clean, listHosts, type Host } from './store'

export type ImportResult = { canceled: true } | { canceled?: false; added: number; updated: number; skipped: number; invalid: number; snippets: Snip[]; theme: string }

// 설정 내보내기·가져오기: 호스트는 main이 저장소에서 읽고 쓰고, 스니펫·테마(화면 localStorage)는 화면이 넘기고 받음
export function registerSettingsIpc(): void {
  ipcMain.handle('settings:export', async (e, snippets: Snip[], theme: string): Promise<{ path: string; hosts: number; snippets: number; masked: number } | null> => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('설정 내보내기'), defaultPath: join(app.getPath('documents'), 'jetdeck-settings.json'), filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    const hosts = listHosts() as unknown as Record<string, unknown>[]
    const { text, masked } = buildExport({ hosts, snippets: Array.isArray(snippets) ? snippets : [], theme: String(theme ?? ''), version: app.getVersion() })
    writeFileSync(r.filePath, text, 'utf8')
    return { path: r.filePath, hosts: hosts.length, snippets: (Array.isArray(snippets) ? snippets : []).length, masked }
  })

  // 스니펫 → 팩 파일 (스니펫 저장소는 건드리지 않음)
  ipcMain.handle('settings:export-pack', async (e, snippets: Snip[]): Promise<{ path: string; exported: number; skipped: number; masked: number } | null> => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('팩으로 내보내기'), defaultPath: join(app.getPath('documents'), 'my-snippets.jdpack.json'), filters: [{ name: 'JetDeck pack', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    const b = buildSnippetPack(Array.isArray(snippets) ? snippets : [], app.getVersion())
    writeFileSync(r.filePath, b.text, 'utf8')
    return { path: r.filePath, exported: b.exported, skipped: b.skipped, masked: b.masked }
  })

  ipcMain.handle('settings:import', async (e, overwrite?: boolean): Promise<ImportResult> => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: tr('설정 가져오기'), defaultPath: app.getPath('documents'), filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return { canceled: true }
    if (statSync(r.filePaths[0]).size > 2_000_000) throw new Error(tr('설정 파일이 너무 커요'))
    const { hosts, snippets, theme } = parseImport(readFileSync(r.filePaths[0], 'utf8'))
    // 호스트마다 저장할 때와 같은 검사(clean)를 거침. 새 id로 저장하고 비밀번호는 없음
    const ok: Host[] = []
    let invalid = 0
    for (const h of hosts) {
      try {
        ok.push(clean({ ...(h as unknown as Host), id: '' }))
      } catch {
        invalid++
      }
    }
    return { ...addHosts(ok, overwrite === true), invalid, snippets, theme }
  })
}
