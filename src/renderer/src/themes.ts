import { getLang, tr } from '../../main/i18n.mts'
import type { ITheme } from '@xterm/xterm'
import { useSyncExternalStore } from 'react'
import { terms } from './components/Terminal'

// 테마 = themes/*.json. main이 앱 폴더 + 사용자 폴더의 JSON을 읽어 줌
type Rule = { token: string; foreground?: string; fontStyle?: string }
type Mood = 'happy' | 'wait' | 'oops'
// 캐릭터 테마(JSON 키는 limited)의 마스코트: 연결 상태 → 표정, 32px 미만 자리는 얼굴만 자른 mini 그림
export type Mascot = { name: string; assets: Record<Mood, string>; assetsMini?: Record<Mood, string>; moodByStatus: Record<string, Mood>; miniBelowPx?: number }
export type ThemeJson = {
  id: string
  label: string
  labelEn?: string // 영어 화면에서 쓰는 이름 (없으면 label)
  kind: 'dark' | 'light'
  ui: Record<string, string>
  status?: Record<string, string>
  statusColors?: Record<string, string> // cotton.json은 이 이름을 씀
  terminal: { theme: ITheme }
  editor?: { monacoBase: 'vs' | 'vs-dark'; colors: Record<string, string>; rules: Rule[] }
  shape?: Record<string, number | string>
  font?: Record<string, string>
  family?: string // 'neon' = 네온 묶음
  limited?: boolean // 캐릭터 테마
  mascot?: Mascot
  effects?: { glass?: { blur: number }; connectingGlow?: { color: string; duration: string } }
}

const KEY = 'theme'
const DEFAULT = 'lime-dark'
let themes: ThemeJson[] = []

export async function loadThemes(): Promise<void> {
  themes = (await window.api.listThemes()) as ThemeJson[]
}
export const themeList = () => themes
export const themeLabel = (t: ThemeJson) => (getLang() === 'en' && t.labelEn) || t.label

// 테마 메뉴 묶음: 에센셜(기본 4) → 컬러 무드 → 네온 사인 → 마스코트 (main/themes.ts가 이 순서로 정렬해 줌)
const BASE = ['lime-dark', 'light-olive', 'mono-dark', 'cotton']
export const groupOf = (t: ThemeJson) => (t.limited ? tr('마스코트') : t.family === 'neon' ? tr('네온 사인') : BASE.includes(t.id) ? tr('에센셜') : tr('컬러 무드'))
export function themeGroups(): { label: string; items: ThemeJson[] }[] {
  const groups: { label: string; items: ThemeJson[] }[] = []
  for (const t of themes) {
    const label = groupOf(t)
    const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups.at(-1)!)
    g.items.push(t)
  }
  return groups
}

export function currentTheme(): string {
  let id: string | null = null
  try {
    id = localStorage.getItem(KEY)
  } catch {
    /* 읽기 실패 → 기본 테마 */
  }
  return themes.some((t) => t.id === id) ? id! : (themes.find((t) => t.id === DEFAULT) ?? themes[0])?.id ?? DEFAULT
}
const current = () => themes.find((t) => t.id === currentTheme())
export const termTheme = (): ITheme => current()?.terminal.theme ?? {}
export const editorTheme = () => current()?.editor

// JSON → CSS 변수. cotton.json처럼 키 이름이 다른 형식(surface, borderSubtle …)도 같은 변수로 맞춤
function cssVars(t: ThemeJson): Record<string, string | undefined> {
  const u = t.ui
  const st = t.status ?? t.statusColors ?? {}
  const sh = t.shape ?? {}
  const f = t.font ?? {}
  const px = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : undefined)
  return {
    'color-scheme': t.kind === 'light' ? 'light' : 'dark',
    '--bg': u.bg,
    '--header': u.header ?? u.surface2,
    '--panel': u.panel ?? u.surface,
    '--panel-2': u.panel2 ?? u.surface2,
    '--selected': u.selection ?? u.selectionBg,
    '--border': u.border ?? u.borderSubtle,
    '--border-strong': u.inputBorder ?? u.borderInput,
    '--track': u.track ?? u.surface2,
    '--text': u.text,
    '--text-dim': u.textMuted,
    '--text-soft': u.statusBarText ?? u.text,
    '--muted': u.placeholder ?? u.textMuted,
    '--accent': u.accentFill,
    '--accent-hover': u.accentFillHover ?? `color-mix(in srgb, ${u.accentFill} 85%, ${t.kind === 'light' ? 'black' : 'white'})`,
    '--on-accent': u.accentFillText,
    '--accent-text': u.accentStrong,
    '--focus': u.focusRing ?? u.accentStrong,
    '--info': u.chartSecondary ?? u.infoText,
    '--warn': u.warningText ?? st.connecting,
    '--secondary-fill': u.secondaryFill,
    '--secondary-text': u.secondaryText ?? u.secondaryFillText,
    '--status-bar': u.statusBar ?? u.surface2,
    '--status-bar-text': u.statusBarText ?? u.text,
    '--chart-1': u.chartPrimary ?? u.accentStrong,
    '--chart-2': u.chartSecondary ?? u.infoText,
    '--status-ok': st.connected,
    '--status-busy': st.connecting,
    '--status-off': st.disconnected,
    '--term-bg': t.terminal.theme.background,
    '--editor-bg': t.editor?.colors['editor.background'] ?? u.bg,
    '--r-sm': px(sh.radiusSmall),
    '--r-input': px(sh.radiusInput),
    '--r-btn': px(sh.radiusButton),
    '--r-card': px(sh.radiusCard),
    '--r-dialog': px(sh.radiusDialog),
    '--btn-shadow': sh.buttonShadow as string | undefined,
    '--card-shadow': sh.shadowCard as string | undefined,
    '--border-w': px(sh.borderWidth),
    '--font': f.ui,
    '--font-display': f.display,
    '--mono': f.mono,
    // 네온: 고정 그라데이션 배경, 앱 이름 발광, 유리 패널 흐림, 연결 중 테두리 발광 색·속도
    '--bg-image': u.backgroundCss,
    '--display-glow': f.displayGlow,
    '--glass-blur': px(t.effects?.glass?.blur),
    '--glow': t.effects?.connectingGlow?.color,
    '--glow-dur': t.effects?.connectingGlow?.duration
  }
}

export function applyTheme(id: string): void {
  const t = themes.find((x) => x.id === id)
  if (!t) return
  const root = document.documentElement
  root.style.cssText = '' // 이전 테마 값 제거 → 빠진 값은 theme.css :root 기본값 사용
  for (const [k, v] of Object.entries(cssVars(t))) if (v) root.style.setProperty(k, v)
  root.toggleAttribute('data-glass', !!t.effects?.glass)
  root.toggleAttribute('data-glow', !!t.effects?.connectingGlow)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* 저장 실패해도 이번 실행 동안은 적용됨 */
  }
  // 숨겨진(display:none) 터미널에 적용하면 글자 폭을 0으로 다시 재서 간격이 깨짐 → 보일 때 Terminal.tsx가 적용
  for (const term of terms.values()) if (term.element?.offsetParent) term.options.theme = t.terminal.theme
  window.dispatchEvent(new Event('nanoterm-theme')) // 편집기(monaco.ts)가 다시 적용
}

// 마스코트 그림: JSON의 "assets/mascots/momo-happy.svg" → 앱에 동봉된 같은 이름 파일
const MASCOT_FILES = import.meta.glob('./assets/mascots/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const STATUS_KEY = { online: 'connected', connecting: 'connecting', offline: 'disconnected' } as const
// 숨김은 테마별: 모모는 숨기고 두두는 보기 같은 선택이 서로 덮어쓰지 않게
const hideKey = () => `mascot-hidden:${currentTheme()}`
export const mascotHidden = () => {
  try {
    return localStorage.getItem(hideKey()) === '1'
  } catch {
    return false
  }
}
export function setMascotHidden(hide: boolean): void {
  try {
    localStorage.setItem(hideKey(), hide ? '1' : '0')
  } catch {
    /* 저장 실패해도 이번 실행 동안은 적용 */
  }
  window.dispatchEvent(new Event('nanoterm-theme'))
}
export const currentMascot = () => current()?.mascot
// 지금 테마에 마스코트가 있고 숨기지 않았으면 그림 주소, 아니면 null
export function mascotSrc(status: keyof typeof STATUS_KEY, size: number): string | null {
  const m = current()?.mascot
  if (!m || mascotHidden()) return null
  const mood = m.moodByStatus[STATUS_KEY[status]] ?? 'happy'
  const path = (size < (m.miniBelowPx ?? 32) && m.assetsMini?.[mood]) || m.assets[mood]
  return MASCOT_FILES[`./assets/mascots/${path?.split('/').pop()}`] ?? null
}
// 테마·마스코트 숨기기가 바뀌면 다시 그리기 (applyTheme·setMascotHidden이 보내는 이벤트)
const subscribe = (cb: () => void) => (window.addEventListener('nanoterm-theme', cb), () => window.removeEventListener('nanoterm-theme', cb))
export const useThemeTick = () => useSyncExternalStore(subscribe, () => `${currentTheme()}|${mascotHidden()}`)
