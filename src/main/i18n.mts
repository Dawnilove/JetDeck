// 화면 문구 번역: 한글 문구를 그대로 키로 쓴다. 영어 모드일 때만 사전(en/*.mts)에서 찾고, 없으면 한글 그대로 (빠진 곳이 있어도 앱은 동작)
// 변수는 {0}, {1}처럼 자리를 만들어 tr('{0}개 선택됨', n) 형태로 넘긴다
import { EN } from './en/index.mts'

export type Lang = 'ko' | 'en'
let lang: Lang = 'ko'
export const getLang = (): Lang => lang
export const setLang = (l: unknown): void => void (lang = l === 'en' ? 'en' : 'ko')

// 첫 실행이면 OS 언어로 정함 (한국어가 아니면 영어)
export const detectLang = (osLocale: string): Lang => (osLocale.toLowerCase().startsWith('ko') ? 'ko' : 'en')

export function tr(ko: string, ...args: unknown[]): string {
  const s = lang === 'en' ? (EN[ko] ?? ko) : ko
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) : s
}
