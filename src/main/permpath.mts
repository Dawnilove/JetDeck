// 앱 기능 권한의 Device 경로 규칙 (6.0.0, 설계안 §2-4). 팩이 정한 root 아래의 상대 경로만 인정하고, 실행할 때마다 실제 경로(realpath)로 다시 검사한다.
// 순수 로직: Device 파일 시스템은 PathFs로 받는다 (SFTP는 packapp.ts가 연결). Electron 없이 시험 (permpath.test.mts)
import { tr } from './i18n.mts'
import type { Permission } from './packschema.mts'
import { isSensitivePath } from './risk.mts'

export type FsKind = 'file' | 'dir' | 'link' | 'other'
export type FsStat = { kind: FsKind; size: number }
export interface PathFs {
  realpath(p: string): Promise<string> // 없으면 throw
  stat(p: string): Promise<FsStat | null> // 링크를 따라감. 없으면 null
  lstat(p: string): Promise<FsStat | null> // 링크를 따라가지 않음. 없으면 null
}

export const PATH_LIMITS = { path: 1024, piece: 255, root: 200 }
// 제어 문자·역슬래시·BiDi·보이지 않는 글자 (화면에 보이는 경로와 실제 경로가 달라지는 것 방지)
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\\​-‏‪-‮⁠-⁯﻿]/
const ENCODED = /%(2e|2f|5c)/i // 퍼센트 인코딩 우회 흉내 (SFTP는 해석하지 않지만 팩 글자에서 아예 막음)
const BAD_PORTS = new Set([2375, 3389, 6379, 9200, 11211, 27017])

// Device에서 받은 이름을 표시용으로 정리 (제어 문자·BiDi 제거, 길이 제한). 다시 경로로 쓸 때는 splitRel부터 다시 지남
export const safeName = (n: string): string => n.replace(new RegExp(BAD_CHARS, 'g'), '').slice(0, PATH_LIMITS.piece)

function pieceProblem(s: string): boolean {
  return !s || s === '.' || s === '..' || s.length > PATH_LIMITS.piece || BAD_CHARS.test(s) || ENCODED.test(s)
}

// 터널 Device 포트: 1024 이상 65535 이하 정수, 인증 없는 관리 서비스 포트(거부 목록) 제외
export function portProblem(p: unknown): string | null {
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1024 || p > 65535) return '포트는 1024~65535 사이 정수예요'
  if (BAD_PORTS.has(p) || (p >= 5900 && p <= 5909)) return `포트 ${p}는 쓸 수 없어요 (인증 없는 관리 서비스)`
  return null
}

// root: "~/" 아래 폴더 1개 이상. ~ 자체·/·..·//·민감 경로 금지. 팩을 읽을 때(스키마) 쓰는 글자 검사
export function rootProblem(root: unknown): string | null {
  if (typeof root !== 'string' || !root.startsWith('~/') || root.length > PATH_LIMITS.root) return `root는 "~/"로 시작하는 ${PATH_LIMITS.root}자 이내 경로예요`
  const pieces = root.slice(2).split('/')
  if (pieces.some(pieceProblem)) return 'root에 빈 조각·..·제어 문자는 쓸 수 없어요'
  if (isSensitivePath(root)) return 'root가 민감한 경로예요 (.ssh, .env 등)'
  return null
}

// 상대 경로(root 기준). 빈 글자는 root 자신. 절대 경로·..·빈 조각·제어 문자는 거부 (단계 2)
export function splitRel(rel: string): string[] {
  if (rel === '') return []
  if (typeof rel !== 'string' || rel.length > PATH_LIMITS.path || rel.split('/').some(pieceProblem)) throw new Error(tr('경로가 올바르지 않아요'))
  return rel.split('/')
}

// 쓰기에서 더 막는 이름: 셸 시작 파일·자동 실행 폴더·git 설정 (읽기·쓰기 공통 거부 목록은 risk.mts isSensitivePath)
const WRITE_DENY = /(^|\/)(\.bashrc|\.bash_profile|\.bash_login|\.bash_logout|\.profile|\.zshrc|\.zprofile|\.zshenv|\.xprofile|\.xsession|\.pam_environment|\.gitconfig)$|(^|\/)\.config\/(autostart|systemd|git)(\/|$)|(^|\/)\.git(\/|$)|(^|\/)\.local\/share\/systemd(\/|$)|crontab/i
export const deniedPath = (rest: string, mode: 'read' | 'write'): boolean => isSensitivePath('~' + rest) || (mode === 'write' && WRITE_DENY.test(rest))

const under = (p: string, dir: string) => p.startsWith(dir + '/')
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
export const toTilde = (abs: string, home: string): string => (abs === home ? '~' : under(abs, home) ? '~' + abs.slice(home.length) : abs)

export type Want = 'dir' | 'file' | 'write'
export type Resolved = { path: string; exists: boolean; stat: FsStat | null } // path: Device의 실제 경로 (심볼릭 링크 없음)

// 단계 1~8: 상대 경로를 root 안의 실제 경로로. 하나라도 틀리면 거기서 멈춘다
// want: dir=폴더 보기, file=받기·읽기(일반 파일, maxBytes 이하), write=올리기(없거나 일반 파일, 링크는 거부)
export async function resolveTarget(fs: PathFs, home: string, perm: Permission, rel: string, want: Want): Promise<Resolved> {
  if (!perm.root || rootProblem(perm.root)) throw new Error(tr('경로가 올바르지 않아요'))
  const mode = want === 'write' ? 'write' : 'read'
  const pieces = splitRel(rel)
  const rootAbs = home + perm.root.slice(1)
  const full = [rootAbs, ...pieces].join('/')
  const realRoot = await fs.realpath(rootAbs).catch(() => Promise.reject(new Error(tr('허용된 폴더를 찾을 수 없어요'))))
  if (!under(realRoot, home)) throw new Error(tr('허용된 폴더 밖이에요')) // 링크로 바뀐 root (홈 자체도 거부)
  const rest = (abs: string) => abs.slice(home.length)
  if (deniedPath(rest(realRoot), mode) || deniedPath(rest(full), mode)) throw new Error(tr('막힌 경로예요 (민감한 파일)'))
  const link = await fs.lstat(full)
  let real: string
  if (link) real = await fs.realpath(full)
  else if (want === 'write' && pieces.length) real = (await fs.realpath(dirOf(full)).catch(() => Promise.reject(new Error(tr('올릴 폴더가 없어요'))))) + '/' + pieces[pieces.length - 1]
  else throw new Error(tr('파일이나 폴더가 없어요'))
  if (real !== realRoot && !under(real, realRoot)) throw new Error(tr('허용된 폴더 밖이에요')) // 심볼릭 링크 탈출
  if (deniedPath(rest(real), mode)) throw new Error(tr('막힌 경로예요 (민감한 파일)'))
  const stat = link ? await fs.stat(real) : null
  if (want === 'dir') {
    if (stat?.kind !== 'dir') throw new Error(tr('폴더가 아니에요'))
  } else if (want === 'file') {
    if (stat?.kind !== 'file') throw new Error(tr('일반 파일만 쓸 수 있어요')) // 폴더·FIFO·장치 파일 거부
    if (stat.size > (perm.maxBytes ?? 0)) throw new Error(tr('파일이 너무 커요'))
  } else {
    if (real === realRoot) throw new Error(tr('경로가 올바르지 않아요'))
    if (link && link.kind === 'link') throw new Error(tr('링크 파일은 덮어쓸 수 없어요'))
    if (stat && stat.kind !== 'file') throw new Error(tr('일반 파일만 쓸 수 있어요'))
    if (!link) {
      const parent = await fs.stat(dirOf(real))
      if (parent?.kind !== 'dir') throw new Error(tr('올릴 폴더가 없어요'))
    }
  }
  return { path: real, exists: !!link, stat }
}

// PC에 받을 때 이름 거부: Windows에서 바로 실행될 수 있는 확장자 (끝의 점·공백은 Windows가 떼므로 같이 본다)
const EXEC_EXT = new Set(['exe', 'bat', 'cmd', 'ps1', 'lnk', 'scr', 'msi', 'vbs', 'js', 'jar', 'com'])
export function badSaveName(name: string): boolean {
  const n = name.replace(/[. ]+$/, '').toLowerCase()
  const dot = n.lastIndexOf('.')
  return n.includes(':') || (dot >= 0 && EXEC_EXT.has(n.slice(dot + 1)))
}
