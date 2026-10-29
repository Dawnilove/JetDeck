import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'path'
import { closeConnsOf, registerSessionIpc } from './session'
import { registerSftpIpc } from './sftp'
import { registerThemeIpc } from './themes'
import { registerTransferIpc } from './transfer'
import { registerDiscoverIpc } from './discover'
import { registerUpdateIpc, startUpdater } from './update'
import { cancelApprovals, registerMcpIpc, startMcp } from './mcp'
import { runBridge } from './mcp-bridge'
import { registerForwardIpc } from './forward'
import { registerDockerIpc } from './docker'
import { registerSvcIpc } from './svc'
import { registerHealthIpc } from './health'
import { registerPackIpc } from './pack'
import { registerGalleryIpc } from './gallery'
import { registerSettingsIpc } from './settingsfile'
import { registerTermLogIpc } from './termlog'
import { registerDiagIpc } from './diag'
import { captureConsole } from './diagbundle.mts'
import { registerBuildIpc } from './build'
import { registerGitIpc } from './git'
import { registerSearchIpc } from './search'
import { registerVncIpc } from './vnc'
import { registerCamIpc } from './cam'
import { registerX11Ipc } from './x11'
import { setLang, tr } from './i18n.mts'
import { registerActivityIpc } from './activity'
import { registerHistoryIpc } from './history'
import { registerObserveIpc } from './observe'
import { registerProcIpc } from './proc'
import { registerRemoteIpc } from './remote'
import { registerRosIpc } from './ros'
import { registerSerialIpc } from './serial'
import { cancelHostKeys, registerSshIpc } from './ssh'
import { registerStoreIpc } from './store'

// 앱 이름(productName)이 JetDeck이라 기본 데이터 폴더가 %APPDATA%\JetDeck이 되는데, 예전(nanoterm) 폴더를 계속 써서 저장된 호스트·비밀번호를 그대로 유지
// (--user-data-dir로 따로 지정하면 그걸 씀: 테스트용 실행이 실제 호스트 목록을 건드리지 않게)
app.setPath('userData', app.commandLine.hasSwitch('user-data-dir') ? app.commandLine.getSwitchValue('user-data-dir') : join(app.getPath('appData'), 'nanoterm'))

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0E1014', // 로딩 중 흰 화면 깜빡임 방지
    icon: join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'), // 설치판에선 app.asar 안의 resources/ (package.json build.files)
    title: 'JetDeck',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // 화면(renderer)은 Node에 직접 접근 못 함 — SSH는 main에서만
      sandbox: true // preload는 electron 모듈만 쓰므로 OS 샌드박스 안에서 돌림
    }
  })

  // 외부 링크는 앱 안이 아니라 기본 브라우저로 (http/https만 — file:, ms-msdt: 같은 프로토콜로 로컬 실행 방지)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 링크·파일을 창에 끌어다 놓거나 Ctrl+R로 다른 페이지/새로고침이 되면 preload API가 남의 페이지에 붙거나 작업이 사라짐 → 이동 금지
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) e.preventDefault()
  })
  // 카메라·위치 같은 권한은 쓰지 않음. 터미널 복사(clipboard writeText)만 허용
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'))

  // 저장 안 된 편집 파일이 있으면 창 닫기 전에 확인 (renderer의 window.__unsaved로 개수 조회)
  let confirmed = false
  win.on('close', (e) => {
    if (confirmed) return
    e.preventDefault()
    // 화면이 멈춰 응답이 없으면 2초 뒤 0개로 보고 닫음 (창이 영영 안 닫히는 것 방지)
    Promise.race([win.webContents.executeJavaScript('window.__unsaved ? window.__unsaved() : 0'), new Promise((r) => setTimeout(() => r(0), 2000))])
      .catch(() => 0)
      .then((n: number) => {
        if (n > 0) {
          const r = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: [tr('취소'), tr('저장하지 않고 종료')],
            defaultId: 0,
            cancelId: 0,
            message: tr('저장하지 않은 파일이 {0}개 있어요.', n),
            detail: tr('종료하면 변경 내용이 사라져요.')
          })
          if (r === 0) return
        }
        confirmed = true
        win.close()
      })
  })

  // 화면이 (다시) 불러와지기 시작하면 이전 화면이 열어 둔 연결·질문을 정리 (언어 전환은 새로고침으로 함)
  win.webContents.on('did-start-loading', () => {
    closeConnsOf(win.webContents)
    cancelHostKeys()
    cancelApprovals()
  })
  win.on('closed', () => {
    cancelApprovals()
  })

  startUpdater(win.webContents)
  startMcp(win.webContents)
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// `JetDeck.exe --mcp` = Claude용 브리지 (창 없음). 아니면 보통 앱
if (process.argv.includes('--mcp')) runBridge()
// 보통 앱은 하나만: 두 번 실행하면 새 창 대신 기존 창을 앞으로 (MCP 서버·자동 업데이트가 겹치지 않게)
else if (!app.requestSingleInstanceLock()) app.quit()
else startApp()

function startApp(): void {
  let win: BrowserWindow | null = null
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  captureConsole()
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('io.github.dawnilove.jetdeck')
    // 배포판은 기본 메뉴(개발자 도구 Ctrl+Shift+I 등)를 없앰. 개발 중(npm run dev)엔 그대로
    if (app.isPackaged) Menu.setApplicationMenu(null)
    registerStoreIpc()
    registerSshIpc()
    registerSessionIpc()
    registerSftpIpc()
    registerThemeIpc()
    registerTransferIpc()
    registerForwardIpc()
    registerRemoteIpc()
    registerDockerIpc()
    registerSvcIpc()
    registerHealthIpc()
    registerPackIpc()
    registerGalleryIpc()
    registerSettingsIpc()
    registerTermLogIpc()
    registerDiagIpc()
    registerBuildIpc()
    registerGitIpc()
    registerSearchIpc()
    registerVncIpc()
    registerCamIpc()
    registerX11Ipc()
    registerHistoryIpc()
    registerActivityIpc()
    registerProcIpc()
    registerObserveIpc()
    registerSerialIpc()
    registerRosIpc()
    registerDiscoverIpc()
    registerUpdateIpc()
    registerMcpIpc()
    ipcMain.on('lang:set', (_e, l: string) => setLang(l))
    // 언어 전환용 새로고침: 화면의 location.reload()는 위의 이동 금지(will-navigate)에 막히므로 main이 다시 불러옴
    ipcMain.on('app:reload', (e) => e.sender.reload())
    ipcMain.handle('app:version', () => app.getVersion())
    win = createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
