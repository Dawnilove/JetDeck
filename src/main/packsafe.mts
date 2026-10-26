// 팩 출력 보호 (5.0.0): Device가 돌려준 글자를 화면에 보이기 전에 정리. 순서: 제어 문자·ANSI·BiDi 제거 → 비밀 가림 → 크기 상한 (Electron 없이 시험)
import { redact } from './activitylog.mts'
import { tr } from './i18n.mts'

export const MAX_OUTPUT = 256 * 1024
const PRE_CAP = 1024 * 1024 // 비밀 가림 정규식이 거대한 입력을 오래 붙들지 않게 먼저 자름

// ESC 시퀀스: CSI(색·커서), OSC(제목·링크, BEL 또는 ESC \ 로 끝), 그 밖의 ESC 한두 글자
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[PX^_][^\u001b]*(?:\u001b\\)?|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g
// 남는 제어 문자 (탭·줄바꿈 제외), DEL, 제로폭·BiDi 제어 문자
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁯﻿]/g

export function cleanText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(ANSI, '').replace(CONTROL, '')
}

// 팩 출력(표·글자·확인창 미리보기 공통). 256KB를 넘으면 앞부분만 남기고 알림 한 줄
// shortcut: 크기는 글자 수로 셈 (UTF-16 단위, 바이트 아님), 정확한 바이트 상한이 필요하면 Buffer로 자를 것
export function sanitizeOutput(s: string): string {
  const clean = redact(cleanText(s.length > PRE_CAP ? s.slice(0, PRE_CAP) : s))
  return clean.length > MAX_OUTPUT ? clean.slice(0, MAX_OUTPUT) + '\n' + tr('…잘렸어요 (출력이 너무 길어서 앞부분만 보여요)') : clean
}
