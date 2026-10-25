import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 폰트 CSS 다듬기 → 설치 파일 축소: Chromium은 woff2만 쓰므로 옛 형식(woff) 경로를 빼고,
// Pretendard는 앱이 쓰는 굵기(400·500·600, 제목·<b> 기본 700)만 남김
const slimFonts = {
  name: 'slim-fonts',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!/node_modules[\\/](@fontsource|pretendard)[\\/].*\.css$/.test(id)) return
    let css = code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '')
    if (id.includes('pretendard')) css = css.replace(/@font-face\s*\{[^}]*\}/g, (b) => (/font-weight:\s*[4-7]00;/.test(b) ? b : ''))
    return css
  }
}

export default defineConfig({
  // main은 V8 바이트코드로 컴파일 → 설치 파일에 원본 JS가 들어가지 않음 (역설계 어렵게)
  main: { build: { bytecode: true } },
  // preload는 샌드박스(sandbox: true)에서 돌아 바이트코드 로더(vm 모듈)를 쓸 수 없음 → 압축만. 화면↔main 통로라 비밀 로직 없음
  preload: { build: { minify: true } },
  renderer: {
    plugins: [slimFonts, react()],
    build: { minify: true, sourcemap: false } // 화면 코드는 바이트코드 불가 → 압축(난독화) + 소스맵 미포함
  }
})
