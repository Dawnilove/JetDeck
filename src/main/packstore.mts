// 팩 저장소 (5.0.0): 사용자 폴더의 팩 파일 훑기, 파일 지문(해시), 켜짐·허용 상태, 충돌 규칙. Electron 없이 시험 (packstore.test.mts)
// 공식 팩(앱 동봉)은 허용 창 없이 켜짐, 외부 팩은 "내가 허용한 지문과 같을 때만" 켜짐 — 파일이 한 글자라도 바뀌면 자동으로 꺼지고 다시 허용해야 함
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tr } from './i18n.mts'
import { compareSemver, LIMITS, validatePack, type ChartDisplay, type Pack } from './packschema.mts'

export const PACK_EXT = '.jdpack.json'
export const MAX_FILES = 100
export const OFFICIAL_DEFAULT_OFF = new Set(['examples', 'ros2-live']) // 공식이어도 기본 꺼짐인 팩 (예제 팩, 베타 팩)

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

// ───────────── 상태 파일 (packs-state.json) ─────────────
export type PackState = {
  enabled: boolean
  approvedHash?: string
  approvedVersion?: string
  approvedAt?: string
  approvedCmds?: Record<string, string> // '플러그인/항목' → 허용한 명령 (다음에 파일이 바뀌면 "바뀐 명령"을 보여 주려고)
  badgesOff?: string[] // 5.3.0: 팩은 켠 채 탐색기 배지(자동 실행)만 끈 배지 id
}
export type StateFile = { version: 1; packs: Record<string, PackState> }
const ID = /^[a-z][a-z0-9-]{0,39}$/

// 깨졌거나 이상한 파일이면 빈 상태 (앱이 죽지 않게). 아는 필드만 받음
export function readState(file: string): StateFile {
  const out: StateFile = { version: 1, packs: Object.create(null) }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
    if (!raw || typeof raw !== 'object' || !raw.packs || typeof raw.packs !== 'object') return out
    for (const [id, v] of Object.entries(raw.packs as Record<string, Record<string, unknown>>)) {
      if (!ID.test(id) || !v || typeof v !== 'object') continue
      const s: PackState = { enabled: v.enabled === true }
      if (typeof v.approvedHash === 'string' && /^[0-9a-f]{64}$/.test(v.approvedHash)) s.approvedHash = v.approvedHash
      if (typeof v.approvedVersion === 'string') s.approvedVersion = v.approvedVersion.slice(0, 40)
      if (typeof v.approvedAt === 'string') s.approvedAt = v.approvedAt.slice(0, 40)
      if (v.approvedCmds && typeof v.approvedCmds === 'object') {
        const cmds: Record<string, string> = Object.create(null)
        for (const [k, c] of Object.entries(v.approvedCmds)) if (typeof c === 'string' && k !== '__proto__') cmds[k] = c
        s.approvedCmds = cmds
      }
      if (Array.isArray(v.badgesOff)) {
        const ids = [...new Set(v.badgesOff.filter((x): x is string => typeof x === 'string' && ID.test(x)))].slice(0, 20)
        if (ids.length) s.badgesOff = ids
      }
      out.packs[id] = s
    }
  } catch {
    /* 파일 없음·깨짐 → 빈 상태 */
  }
  return out
}
export function writeState(file: string, st: StateFile): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(st, null, 2), 'utf8')
  renameSync(tmp, file) // 쓰는 도중 꺼져도 옛 파일이 남도록
}

// ───────────── 명령 비교 (허용 창에서 "바뀐 명령" 강조) ─────────────
export type CommandDiff = { added: string[]; changed: string[]; removed: string[] }
// 그래프에서 "무엇을 읽어 보여 주나"를 정하는 부분 (단위·범위·점 수는 제외): 바뀌면 허용 창에서 바뀐 항목으로 보임
const chartCmdPart = (d: ChartDisplay) => ({ every: d.every, match: d.match, split: d.split, skip: d.skip, perLine: d.perLine, series: d.series })
export function commandMap(p: Pack): Record<string, string> {
  const m: Record<string, string> = Object.create(null)
  for (const pl of p.plugins) for (const a of pl.actions) m[`${pl.id}/${a.id}`] = a.cmd + (a.preview ? `\u0000${a.preview}` : '') + (a.sudo ? '\u0000sudo' : '') + `\u0000${a.mode}` + (a.fields ? `\u0000fields:${JSON.stringify(a.fields)}` : '') + (a.display?.type === 'chart' ? `\u0000chart:${JSON.stringify(chartCmdPart(a.display))}` : '')
  for (const b of p.badges ?? []) m[`badge:${b.id}`] = JSON.stringify({ cmd: b.cmd, shell: b.shell, separator: b.separator, root: b.root, match: b.match, code: b.code, path: b.path, codes: b.codes, tag: b.tag }) // 5.3.0: 배지가 읽는 방법이 바뀌면 허용 창에 바뀐 항목으로 보임
  return m
}
export function diffCommands(before: Record<string, string> | undefined, after: Record<string, string>): CommandDiff {
  const b = before ?? {}
  return {
    added: Object.keys(after).filter((k) => !(k in b)),
    changed: Object.keys(after).filter((k) => k in b && b[k] !== after[k]),
    removed: Object.keys(b).filter((k) => !(k in after))
  }
}

// ───────────── 훑기 ─────────────
export type RawFile = { fileName: string; file?: string; bytes: Uint8Array | null; error?: string } // bytes: null이면 읽지 못함
export type Source = 'official' | 'user'
export type PackStatus = 'ok' | 'invalid' | 'conflict' | 'unreadable' | 'too-big'
export type Approval = 'official' | 'approved' | 'new' | 'changed' // new: 처음 발견(허용 필요), changed: 허용한 뒤 파일이 바뀜(다시 허용 필요)
export type PackEntry = {
  id: string // 팩 id (읽지 못한 파일은 `file:이름`)
  source: Source
  fileName: string
  file?: string
  hash: string
  size: number
  pack: Pack | null
  errors: string[]
  warnings: string[]
  status: PackStatus
  conflictWith?: string[] // 같은 id를 쓰는 다른 파일 이름
  wantEnabled: boolean // 상태 파일의 켜짐
  enabled: boolean // 실제로 동작하는지 (허용된 지문과 같고 문제가 없을 때만)
  approval: Approval
  approvedVersion?: string
  approvedAt?: string
  changes?: CommandDiff // approval이 changed일 때: 허용했던 명령 대비
  badgesOff: string[] // 5.3.0: 꺼 둔 탐색기 배지 id (팩이 켜져 있어도 이 배지는 실행 안 함)
}

// 사용자 폴더 안 팩 파일 읽기: 이 폴더 바로 아래의 *.jdpack.json 일반 파일만 (하위 폴더·심볼릭 링크 제외), 512KB 초과는 읽지 않음
export function readUserDir(dir: string): RawFile[] {
  if (!existsSync(dir)) return []
  const out: RawFile[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(PACK_EXT) || out.length >= MAX_FILES) continue
    const file = join(dir, name)
    try {
      const st = lstatSync(file)
      if (!st.isFile()) continue // 폴더·링크 제외
      if (st.size > LIMITS.fileBytes) out.push({ fileName: name, file, bytes: null, error: `파일이 ${LIMITS.fileBytes / 1024}KB보다 커요` })
      else out.push({ fileName: name, file, bytes: readFileSync(file) })
    } catch (e) {
      out.push({ fileName: name, file, bytes: null, error: '파일을 읽지 못했어요' })
    }
  }
  return out
}
export const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true })

function parseBytes(bytes: Uint8Array): unknown {
  return JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^﻿/, ''))
}

export type CatalogInput = {
  official: { fileName: string; raw: unknown }[]
  user: RawFile[] // safeMode면 빈 배열로 넘김
  state: StateFile
  appVersion: string
}

// 공식 + 사용자 팩 전부를 읽고 검사해서 목록으로. 충돌·예약 id·지문 불일치 규칙을 여기서 적용
export function buildCatalog(inp: CatalogInput): PackEntry[] {
  const entries: PackEntry[] = []
  const officialIds = new Set<string>()
  for (const o of inp.official) {
    const text = JSON.stringify(o.raw)
    const r = validatePack(o.raw, { official: true, appVersion: inp.appVersion })
    const id = r.pack?.id ?? `file:${o.fileName}`
    if (r.pack) officialIds.add(r.pack.id)
    const want = inp.state.packs[id]?.enabled ?? !OFFICIAL_DEFAULT_OFF.has(id)
    entries.push({ id, source: 'official', fileName: o.fileName, hash: sha256(text), size: text.length, pack: r.pack, errors: r.errors, warnings: r.warnings, status: r.pack ? 'ok' : 'invalid', wantEnabled: want, enabled: want && !!r.pack, approval: 'official', badgesOff: inp.state.packs[id]?.badgesOff ?? [] })
  }
  const users: PackEntry[] = []
  for (const f of inp.user) {
    const base = { source: 'user' as const, fileName: f.fileName, file: f.file, wantEnabled: false, enabled: false, approval: 'new' as Approval, warnings: [] as string[], badgesOff: [] as string[] }
    if (!f.bytes) {
      users.push({ ...base, id: `file:${f.fileName}`, hash: '', size: 0, pack: null, errors: [f.error ?? '읽지 못했어요'], status: f.error?.includes('커요') ? 'too-big' : 'unreadable' })
      continue
    }
    const hash = sha256(f.bytes)
    let raw: unknown
    try {
      raw = parseBytes(f.bytes)
    } catch {
      users.push({ ...base, id: `file:${f.fileName}`, hash, size: f.bytes.length, pack: null, errors: ['JSON 형식이 올바르지 않아요'], status: 'invalid' })
      continue
    }
    const r = validatePack(raw, { official: false, appVersion: inp.appVersion })
    const errors = [...r.errors]
    let pack = r.pack
    const id = pack?.id ?? `file:${f.fileName}`
    if (pack && officialIds.has(pack.id)) {
      errors.unshift(`팩 id "${pack.id}"는 공식 팩이 이미 써요`)
      pack = null
    }
    users.push({ ...base, id, hash, size: f.bytes.length, pack, errors, warnings: r.warnings, status: pack ? 'ok' : 'invalid' })
  }
  // 같은 id가 둘 이상이면 모호하므로 고르지 않고 전부 끔
  const byId = new Map<string, PackEntry[]>()
  for (const u of users) if (u.pack) byId.set(u.id, [...(byId.get(u.id) ?? []), u])
  for (const group of byId.values()) {
    if (group.length < 2) continue
    for (const u of group) {
      u.status = 'conflict'
      u.conflictWith = group.filter((x) => x !== u).map((x) => x.fileName)
      u.errors = [`같은 id의 팩 파일이 여러 개예요: ${group.map((x) => x.fileName).join(', ')}`, ...u.errors]
    }
  }
  for (const u of users) {
    const st = u.pack ? inp.state.packs[u.id] : undefined
    u.wantEnabled = !!st?.enabled
    u.badgesOff = st?.badgesOff ?? []
    u.approvedVersion = st?.approvedVersion
    u.approvedAt = st?.approvedAt
    if (st?.approvedHash && st.approvedHash === u.hash) u.approval = 'approved'
    else if (st?.approvedHash) {
      u.approval = 'changed'
      if (u.pack) u.changes = diffCommands(st.approvedCmds, commandMap(u.pack))
    } else u.approval = 'new'
    u.enabled = u.status === 'ok' && u.approval === 'approved' && u.wantEnabled
  }
  return [...entries, ...users]
}

// 켜진 팩만 (활동 막대·팔레트·실행이 쓰는 목록)
export const enabledPacks = (entries: PackEntry[]): Pack[] => entries.filter((e) => e.enabled && e.pack).map((e) => e.pack!)

// ───────────── 켜기·끄기·허용 (상태 바꾸기) ─────────────
// 사용자 팩 켜기: 화면이 사용자에게 보여 준 지문(shownHash)과 지금 파일의 지문이 같아야 함 → 보여 준 내용과 다른 파일을 켤 수 없음
export function approveAndEnable(st: StateFile, e: PackEntry, shownHash: string, now = new Date()): StateFile {
  if (e.source !== 'user') throw new Error(tr('공식 팩은 허용이 필요 없어요'))
  if (e.status !== 'ok' || !e.pack) throw new Error(tr('문제가 있는 팩은 켤 수 없어요'))
  if (!shownHash || shownHash !== e.hash) throw new Error(tr('팩 파일이 바뀌었어요. 다시 확인해 주세요'))
  return { ...st, packs: { ...st.packs, [e.id]: { enabled: true, approvedHash: e.hash, approvedVersion: e.pack.version, approvedAt: now.toISOString(), approvedCmds: commandMap(e.pack), badgesOff: st.packs[e.id]?.badgesOff } } }
}
export function setEnabled(st: StateFile, e: PackEntry, on: boolean): StateFile {
  if (!e.pack) throw new Error(tr('쓸 수 없는 팩이에요'))
  if (on && e.source === 'user' && !(e.approval === 'approved' && e.status === 'ok')) throw new Error(tr('허용이 필요한 팩이에요')) // 이미 허용한 같은 지문일 때만 허용 창 없이 다시 켬
  return { ...st, packs: { ...st.packs, [e.id]: { ...st.packs[e.id], enabled: on } } }
}
// 탐색기 배지 끄기·켜기 (5.3.0): 팩은 그대로 두고 자동 실행만. 이 팩에 없는 id는 버림
export function setBadgesOff(st: StateFile, e: PackEntry, ids: string[]): StateFile {
  if (!e.pack) throw new Error(tr('쓸 수 없는 팩이에요'))
  const known = new Set((e.pack.badges ?? []).map((b) => b.id))
  const off = [...new Set(ids.map(String))].filter((i) => known.has(i)).slice(0, 20)
  const cur = st.packs[e.id] ?? { enabled: e.wantEnabled }
  return { ...st, packs: { ...st.packs, [e.id]: { ...cur, badgesOff: off.length ? off : undefined } } }
}
export function forgetPack(st: StateFile, id: string): StateFile {
  const packs = { ...st.packs }
  delete packs[id]
  return { ...st, packs }
}

// ───────────── 설치 ─────────────
export type Inspect = {
  ok: boolean
  pack: Pack | null
  errors: string[]
  warnings: string[]
  hash: string
  size: number
  existing?: { fileName: string; version: string; relation: 'upgrade' | 'downgrade' | 'same'; diff: CommandDiff } // 같은 id가 이미 설치됨: 버전 비교와 바뀐 명령
}
// 설치 전 내용 확인 (허용 창과 같은 화면에 쓸 정보). 아무것도 쓰지 않음
export function inspectPackBytes(bytes: Uint8Array, appVersion: string, current: PackEntry[]): Inspect {
  const hash = sha256(bytes)
  if (bytes.length > LIMITS.fileBytes) return { ok: false, pack: null, errors: [`파일이 ${LIMITS.fileBytes / 1024}KB보다 커요`], warnings: [], hash, size: bytes.length }
  let raw: unknown
  try {
    raw = parseBytes(bytes)
  } catch {
    return { ok: false, pack: null, errors: ['JSON 형식이 올바르지 않아요'], warnings: [], hash, size: bytes.length }
  }
  const r = validatePack(raw, { official: false, appVersion })
  const errors = [...r.errors]
  let pack = r.pack
  const clash = pack && current.find((e) => e.source === 'official' && e.id === pack!.id)
  if (clash) {
    errors.unshift(`팩 id "${pack!.id}"는 공식 팩이 이미 써요`)
    pack = null
  }
  const out: Inspect = { ok: !!pack, pack, errors, warnings: r.warnings, hash, size: bytes.length }
  const old = pack && current.find((e) => e.source === 'user' && e.id === pack!.id && e.pack)
  if (pack && old?.pack) {
    const c = compareSemver(pack.version, old.pack.version)
    out.existing = { fileName: old.fileName, version: old.pack.version, relation: c > 0 ? 'upgrade' : c < 0 ? 'downgrade' : 'same', diff: diffCommands(commandMap(old.pack), commandMap(pack)) }
  }
  return out
}
// 파일 복사: 이름은 팩 id로 만들어서(사용자 파일 이름을 쓰지 않음 → 경로 조작 없음) 사용자 폴더에 씀. 같은 id 파일이 이미 있으면 그 파일을 덮어씀. 꺼진 채로 들어옴(허용은 따로)
export function installPackBytes(dir: string, bytes: Uint8Array, appVersion: string, current: PackEntry[]): { file: string; hash: string; pack: Pack } {
  const ins = inspectPackBytes(bytes, appVersion, current)
  if (!ins.ok || !ins.pack) throw new Error(ins.errors[0] ?? tr('설치할 수 없는 팩이에요'))
  const same = current.filter((e) => e.source === 'user' && e.id === ins.pack!.id && e.file)
  if (same.length > 1) throw new Error(tr('같은 id의 팩 파일이 여러 개예요. 폴더에서 정리한 뒤 다시 시도하세요'))
  ensureDir(dir)
  const file = same[0]?.file ?? join(dir, ins.pack.id + PACK_EXT)
  const tmp = file + '.tmp'
  writeFileSync(tmp, bytes)
  renameSync(tmp, file)
  return { file, hash: ins.hash, pack: ins.pack }
}
