// 앱 아이콘 생성: resources/icon.svg, icon.png(256), icon.ico(16~256)
// 실행: npx electron scripts/make-icon.cjs   (그림을 바꾸려면 아래 svg()만 고치고 다시 실행)
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

// 160 기준 좌표. 큰 크기(48px 이상)는 가는 선(시안 1번), 작은 크기(≤32px)는 선을 굵게 하고 꺾쇠를 키운 모양(시안 11번 채움)
// — 작업 표시줄·창 제목(16~32px)에서 뭉개지지 않게. 두 모양은 같은 '꺾쇠 → 케이블 → 점'이라 한 아이콘으로 읽힘
const svg = (small) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <rect width="160" height="160" rx="36" fill="#0E1014"/>
  ${
    small
      ? `<polyline points="30,50 58,78 30,106" fill="none" stroke="#A3E06B" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M72 106 H92 C116 106 128 88 128 70" fill="none" stroke="#A3E06B" stroke-width="14" stroke-linecap="round"/>
  <circle cx="128" cy="48" r="16" fill="#A3E06B"/>`
      : `<polyline points="34,52 60,78 34,104" fill="none" stroke="#A3E06B" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M72 104 H92 C114 104 126 84 126 62" fill="none" stroke="#A3E06B" stroke-width="9" stroke-linecap="round"/>
  <circle cx="126" cy="48" r="11" fill="#A3E06B"/>`
  }
</svg>`
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const out = join(__dirname, '..', 'resources')

// ICO = 헤더 + 크기별 항목 + PNG 데이터 (Windows Vista 이후 PNG 항목 지원)
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i
    head[e] = size >= 256 ? 0 : size // 0 = 256
    head[e + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, e + 4) // planes
    head.writeUInt16LE(32, e + 6) // bpp
    head.writeUInt32LE(buf.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += buf.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p.buf)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const pngs = []
  for (const size of SIZES) {
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg(size <= 32)).toString('base64')
    const b64 = await win.webContents.executeJavaScript(`new Promise((ok, no) => {
      const img = new Image()
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size}
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png').split(',')[1]) }
      img.onerror = no
      img.src = '${url}'
    })`)
    pngs.push({ size, buf: Buffer.from(b64, 'base64') })
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'icon.svg'), svg(false))
  writeFileSync(join(out, 'icon.png'), pngs.at(-1).buf)
  writeFileSync(join(out, 'icon.ico'), ico(pngs))
  // 자체 확인: ICO 항목 수와 첫 PNG 서명
  const f = ico(pngs)
  console.assert(f.readUInt16LE(4) === SIZES.length && f.toString('latin1', f.readUInt32LE(18) + 1, f.readUInt32LE(18) + 4) === 'PNG', 'ICO 형식 오류')
  console.log('아이콘 생성:', out, SIZES.join(','))
  app.quit()
})
