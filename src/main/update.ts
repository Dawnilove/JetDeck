import { app, ipcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'

// 자동 업데이트: GitHub Releases(package.json build.publish)에서 새 버전을 찾아 받아 두고, 화면에 알림
// 설치 파일로 설치한 앱(app.isPackaged)에서만 동작. 개발 중(npm run dev)에는 확인하지 않음
export type UpdateState = { state: 'downloading' | 'ready'; version: string }

export function startUpdater(wc: WebContents): void {
  if (!app.isPackaged) return
  const send = (s: UpdateState) => !wc.isDestroyed() && wc.send('update', s)
  autoUpdater.autoDownload = true // 받는 건 뒤에서, 설치는 사용자가 누를 때 (안 누르면 다음 종료 때)
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (i) => send({ state: 'downloading', version: i.version }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => console.warn('업데이트 확인 실패', e.message)) // 오프라인 등: 조용히 넘어감
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  wc.once('did-finish-load', check)
  setInterval(check, 6 * 60 * 60 * 1000) // 켜 둔 채로 오래 쓰는 경우 6시간마다
}

export function registerUpdateIpc(): void {
  // "다시 시작해서 업데이트": 저장 안 한 파일이 있으면 창 닫기 확인이 먼저 뜸 (index.ts close 처리)
  // (true, true) = 설치 창 없이 조용히 설치하고 끝나면 앱을 다시 켬 (1.0.0은 기본값이라 설치 창이 떴음)
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(true, true))
}
