import { app, ipcMain } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// 테마 = JSON 파일. 앱에 들어 있는 themes/ + 사용자 폴더(%APPDATA%\nanoterm\themes)에 JSON을 넣으면 메뉴에 추가됨
// 설치판에선 themes/가 app.asar 안에 들어감 (package.json build.files)
const dirs = () => [join(app.getAppPath(), 'themes'), join(app.getPath('userData'), 'themes')]

export function listThemes(): unknown[] {
  const byId = new Map<string, unknown>()
  for (const dir of dirs()) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      try {
        const t = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        // 최소 형식만 확인: 잘못된 파일 하나 때문에 앱이 안 뜨면 안 되므로 건너뜀
        if (typeof t?.id !== 'string' || typeof t.ui !== 'object' || typeof t.terminal?.theme !== 'object') throw new Error('id/ui/terminal.theme 없음')
        byId.set(t.id, t) // 같은 id면 사용자 폴더 것이 우선
      } catch (e) {
        console.warn(`테마 파일 건너뜀: ${f} (${(e as Error).message})`)
      }
    }
  }
  // 메뉴 순서: 기본 4 → 추가 7 → 네온 3 → 캐릭터 3, 사용자가 추가한 테마는 뒤에
  const order = ['lime-dark', 'light-olive', 'mono-dark', 'cotton', 'sunset', 'forest', 'ocean', 'paper', 'retro-crt', 'lavender', 'high-contrast',
    'cyber-neon', 'neon-phosphor', 'neon-overdrive', 'limited-bloom', 'limited-night', 'limited-festival']
  const rank = (t: unknown) => ((i) => (i < 0 ? order.length : i))(order.indexOf((t as { id: string }).id))
  return [...byId.values()].sort((a, b) => rank(a) - rank(b))
}

export function registerThemeIpc(): void {
  ipcMain.handle('themes:list', () => listThemes())
}
