import { detectLang, getLang, setLang, type Lang } from '../../main/i18n.mts'

// 화면 언어: 이 PC에 기억(없으면 OS 언어로 정함). 다른 모듈이 문구를 만들기 전에 정해져야 해서 main.tsx에서 맨 먼저 불러옴
const KEY = 'jetdeck.lang'
let saved: string | null = null
try {
  saved = localStorage.getItem(KEY)
} catch {
  /* 저장소를 못 쓰면 OS 언어 */
}
setLang(saved === 'ko' || saved === 'en' ? saved : detectLang(navigator.language))
window.api.setLang(getLang()) // 메인 프로세스의 오류·안내 문구도 같은 언어로

// 언어를 바꾸면 모든 화면 문구가 새로 만들어지도록 다시 불러옴 (연결은 끊김 — App이 먼저 확인하고 정리)
// location.reload()는 main의 페이지 이동 금지에 막혀서 main에 새로고침을 부탁함
export function switchLang(): void {
  const next: Lang = getLang() === 'ko' ? 'en' : 'ko'
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return
  }
  window.api.reloadApp()
}
