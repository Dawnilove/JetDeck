import './lang'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './theme.css'
import '@fontsource/jua/400.css' // cotton·lavender·모모 테마 제목용 (오프라인 동작하도록 앱에 동봉)
import '@fontsource/vt323/400.css' // 네온·레트로 테마 앱 이름
import '@fontsource/black-han-sans/400.css' // 볼트·두두 테마 제목
import '@fontsource/gowun-batang/400.css' // paper 테마 제목
import 'pretendard/dist/web/static/pretendard-dynamic-subset.css' // 다크 테마 2종·cotton 본문용
import App from './App'
import { applyTheme, currentTheme, loadThemes } from './themes'

// 파일 전송 드롭존 밖에 파일·링크를 놓아도 창이 그 페이지로 이동하지 않게 (main의 will-navigate 차단과 이중 방어)
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

// 터미널 글꼴(보통·굵게)을 미리 불러옴: 굵은 글꼴 파일이 늦게 오면 xterm이 대체 글꼴로 글자 폭을 재 버려
// 프롬프트 같은 굵은 글씨 간격이 어긋남 (테마를 바꾸기 전까지 그대로 남음)
function preloadTerminalFont(): Promise<unknown> {
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace'
  return Promise.all([document.fonts.load(`13px ${mono}`), document.fonts.load(`bold 13px ${mono}`)]).catch(() => {})
}

// 테마 JSON을 읽고 적용한 뒤 화면을 그림 (첫 화면부터 저장된 테마로)
loadThemes()
  .catch((e) => console.warn('테마를 읽지 못했어요', e))
  .then(() => {
    applyTheme(currentTheme())
    return preloadTerminalFont()
  })
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
