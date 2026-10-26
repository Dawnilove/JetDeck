// 입력 폼 필드 (5.1.0): 사용자가 고르거나 적은 값을 검사하고, 명령에 끼워 넣을 "글자 하나"로 바꿈. Electron 없이 시험 (packfields.test.mts)
// 원칙: 값은 항상 main이 실행할 때마다 다시 검사한다 (화면 검사는 편의일 뿐). 자유 글자는 작은따옴표로 감싸고, 맨 앞 '-'·제어 문자·줄바꿈은 거부한다
import { tr } from './i18n.mts'
import type { Choice, L10n } from './packschema.mts'
import { shq } from './shq.mts'

export type FromSpec = { cmd: string; shell: 'sh' | 'bash-i'; timeout: number; charset: 'word' | 'ros' | 'path'; max: number } // 읽기 명령의 출력 줄이 선택지가 됨
type Base = { name: string; label: L10n; desc?: L10n; required: boolean; default?: string }
export type Field = Base &
  (
    | { type: 'select'; choices?: Choice[]; from?: FromSpec }
    | { type: 'text'; charset: 'word' | 'ros' | 'free'; maxLen: number }
    | { type: 'int'; min: number; max: number }
    | { type: 'path'; maxLen: number }
    | { type: 'flag'; on: string }
  )

export const FIELD_LIMITS = { fields: 6, textMax: 200, textDefault: 60, pathMax: 300, intMax: 1_000_000, fromItems: 200, fromTimeout: 15, valueMax: 100 }
export const FIELD_TYPES = ['select', 'text', 'int', 'path', 'flag']
export const FLAG_ON = /^[A-Za-z0-9_.=-]{1,40}$/

// 제어 문자·줄바꿈·BiDi·제로폭 (확인창에 보이는 글자와 실제 입력이 달라지는 것 방지)
const BAD = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/
const WORD = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/
const ROS = /^[A-Za-z0-9_~/][A-Za-z0-9_~/]*$/

type Charset = 'word' | 'ros' | 'free' | 'path'
// 글자 종류 하나에 대한 검사. 맞으면 null, 아니면 사유 코드
export function charsetProblem(cs: Charset, v: string, maxLen: number): 'empty' | 'long' | 'chars' | 'abs' | null {
  if (!v) return 'empty'
  if (v.length > maxLen) return 'long'
  if (BAD.test(v) || v.startsWith('-')) return 'chars'
  if (cs === 'word') return WORD.test(v) ? null : 'chars'
  if (cs === 'ros') return ROS.test(v) ? null : 'chars'
  if (cs === 'path') return !v.startsWith('/') ? 'abs' : v.split('/').includes('..') ? 'chars' : null
  return null // free
}

// 값 하나 검사: 맞으면 null, 아니면 사용자에게 보일 사유 (앱 글자)
export function checkValue(f: Field, v: string): string | null {
  const n = f.name
  if (f.type === 'flag') return v === 'true' || v === 'false' ? null : tr('{0}: 쓸 수 없는 값이에요', n)
  if (f.type === 'int') {
    if (!/^\d{1,7}$/.test(v)) return tr('{0}: {1}~{2} 사이 숫자만 쓸 수 있어요', n, f.min, f.max)
    const x = Number(v)
    return x < f.min || x > f.max ? tr('{0}: {1}~{2} 사이 숫자만 쓸 수 있어요', n, f.min, f.max) : null
  }
  if (f.type === 'select' && f.choices) return f.choices.some((c) => c.value === v) ? null : tr('{0}: 선택지에 없는 값이에요', n)
  let p: ReturnType<typeof charsetProblem>
  if (f.type === 'select') p = charsetProblem(f.from?.charset ?? 'word', v, FIELD_LIMITS.valueMax)
  else if (f.type === 'text') p = charsetProblem(f.charset, v, f.maxLen)
  else p = charsetProblem('path', v, f.maxLen)
  if (p === null) return null
  if (p === 'empty') return tr('{0}: 값이 필요해요', n)
  if (p === 'long') return tr('{0}: 너무 길어요', n)
  if (p === 'abs') return tr('{0}: 절대 경로(/로 시작)만 쓸 수 있어요', n)
  return tr('{0}: 쓸 수 없는 글자가 있어요', n)
}

// 명령에 끼워 넣을 글자. 고정 선택지·숫자·플래그는 그대로(팩에 적힌 안전한 값), 사용자가 적었거나 기기가 준 글자는 작은따옴표로 감쌈
export function renderValue(f: Field, v: string): string {
  if (f.type === 'flag') return v === 'true' ? f.on : ''
  if (f.type === 'int') return String(Number(v))
  if (f.type === 'select' && f.choices) return v
  return v === '' ? '' : shq(v)
}

const initial = (f: Field): string => {
  if (f.default !== undefined) return f.default
  if (f.type === 'flag') return 'false'
  if (f.type === 'int') return String(f.min)
  if (f.type === 'select' && f.choices) return f.choices[0].value
  return ''
}

// 화면이 보낸 값(없으면 기본값)을 검사해서 {이름} → 끼워 넣을 글자 표로. 틀린 값이 있으면 Error (main이 실행할 때마다 호출)
export function resolveFields(fields: Field[] | undefined, given: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields ?? []) {
    const raw = Object.hasOwn(given, f.name) ? given[f.name] : undefined
    const v = typeof raw === 'string' ? raw : initial(f)
    if (v === '' && f.required === false && f.type !== 'flag' && f.type !== 'int') {
      out[f.name] = ''
      continue
    }
    const bad = checkValue(f, v)
    if (bad) throw new Error(bad)
    out[f.name] = renderValue(f, v)
  }
  return out
}

// 위험도 계산(로드 때)에 쓸 대표 값 조합. 사용자가 나중에 넣을 값은 실행 직전 재분석이 맡는다. 너무 많으면 null
export function sampleCombos(fields: Field[] | undefined, limit: number): Record<string, string>[] | null {
  let out: Record<string, string>[] = [{}]
  for (const f of fields ?? []) {
    let samples: string[]
    if (f.type === 'select' && f.choices) samples = f.choices.map((c) => c.value)
    else if (f.type === 'flag') samples = ['', f.on]
    else if (f.type === 'int') samples = [String(f.min)]
    else if (f.type === 'path' || (f.type === 'select' && f.from?.charset === 'path')) samples = [shq('/tmp/sample')]
    else {
      const ros = (f.type === 'text' && f.charset === 'ros') || (f.type === 'select' && f.from?.charset === 'ros')
      samples = [shq(ros ? '/sample' : 'sample')]
    }
    if (!f.required && f.type !== 'flag' && f.type !== 'int') samples = [...samples, '']
    out = out.flatMap((o) => samples.map((s) => ({ ...o, [f.name]: s })))
    if (out.length > limit) return null
  }
  return out
}

// from 목록 명령의 출력 → 선택지 값들: 줄마다 글자 종류 검사, 맞는 것만, 중복 제거, 최대 개수
export function parseFromOutput(spec: FromSpec, out: string): string[] {
  const seen = new Set<string>()
  for (const line of out.split('\n')) {
    const v = line.replace(/\r$/, '').trim()
    if (!v || charsetProblem(spec.charset, v, FIELD_LIMITS.valueMax)) continue
    seen.add(v)
    if (seen.size >= spec.max) break
  }
  return [...seen]
}
