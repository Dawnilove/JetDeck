// banner.html → banner.png (1280×640, 2배 해상도) — Electron 화면 캡처
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 640, show: false, useContentSize: true, webPreferences: { zoomFactor: 1 } })
  await win.loadFile(join(__dirname, 'banner.html'))
  await new Promise((r) => setTimeout(r, 800)) // 폰트·이미지 로드 대기
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 640 })
  writeFileSync(join(__dirname, 'banner.png'), img.toPNG())
  console.log('saved', img.getSize())
  app.quit()
})
