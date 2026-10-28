// 모음(5.5.0) 순수 로직: 색인 형식·ed25519 서명 확인·serial/만료·팩 파일 지문. Electron·네트워크 없이 시험 (gallerycore.test.mts)
// 순서(설계안 §8-5): 크기 → 서명 → JSON 해석 → 스키마 → serial → 만료. 서명이 맞기 전에는 JSON을 해석하지 않음
import { createHash, createPublicKey, verify } from 'node:crypto'
import { compareSemver, type L10n } from './packschema.mts'

export const GALLERY_LIMITS = { index: 1024 * 1024, sig: 200, pack: 128 * 1024, packs: 500, revoked: 1000, tags: 5, tagChars: 20, name: 60, desc: 300, author: 100, license: 60, reason: 300, perms: 10, permChars: 40, capMax: 1000 }
export const EXPIRES_DAYS = 90 // 색인 만료: 만든 날에서 90일 (gallery:build)

const ID = /^[a-z][a-z0-9-]{2,39}$/ // 모음 팩 id는 3자 이상 (설계안 §8-9)
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const FILE = /^files\/[a-z][a-z0-9-]{2,39}\/\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\/[a-z][a-z0-9-]{2,39}\.jdpack\.json$/
const HEX64 = /^[0-9a-f]{64}$/
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/
const BAD_TEXT = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/ // 제어 문자·BiDi·보이지 않는 글자: 있으면 거부(색인은 관리자가 만든 것이라 고치지 않음)
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex') // 32바이트 공개 열쇠 앞에 붙이는 DER 머리

export const fileOf = (id: string, version: string) => `files/${id}/${version}/${id}.jdpack.json`
export const sha256Hex = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

export type Caps = { read: number; change: number; danger: number; stream: number; form: number; chart: number; badge: number; autoRun: number; perms: string[] }
export type GalleryPack = {
  id: string
  version: string
  name: L10n
  desc: L10n
  author?: string
  submitter?: string
  license: string
  tier: 'reviewed'
  minApp?: string
  file: string
  sha256: string
  size: number
  caps: Caps
  tags: string[]
  reviewedAt: string
}
export type Revoked = { id: string; version?: string; sha256?: string; reason: L10n; at: string }
export type GalleryIndex = { format: 1; serial: number; generatedAt: string; expires: string; packs: GalleryPack[]; revoked: Revoked[] }

// ───────────── 서명 ─────────────
// 공개 열쇠: 32바이트를 base64로 쓴 44글자. 틀린 형식이면 null (그 자리는 건너뜀)
export function publicKeyOf(rawB64: string) {
  if (typeof rawB64 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(rawB64)) return null
  const raw = Buffer.from(rawB64, 'base64')
  if (raw.length !== 32) return null
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}
// 서명 글자(base64, 64바이트 = 88글자, 앞뒤 공백·줄바꿈은 허용)가 열쇠 중 하나로 맞으면 그 열쇠의 번호, 아니면 -1
export function verifySignature(data: Uint8Array, sigText: string, keys: string[]): number {
  if (typeof sigText !== 'string' || sigText.length > GALLERY_LIMITS.sig) return -1
  const t = sigText.trim()
  if (!/^[A-Za-z0-9+/]{86}==$/.test(t)) return -1
  const sig = Buffer.from(t, 'base64')
  if (sig.length !== 64) return -1
  for (let i = 0; i < keys.length; i++) {
    const k = publicKeyOf(keys[i])
    if (k && verify(null, data, k, sig)) return i
  }
  return -1
}

// ───────────── 색인 해석 ─────────────
export type IndexError = 'too-big' | 'bad-signature' | 'bad-json' | 'bad-format' | 'rollback'
export type ParseOk = { ok: true; index: GalleryIndex; expired: boolean; keyIndex: number }
export type ParseFail = { ok: false; code: IndexError; detail?: string }
export type ParseOpts = { keys: string[]; lastSerial: number; now: Date }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number, min = 1): v is string => typeof v === 'string' && v.length >= min && v.length <= max && !BAD_TEXT.test(v)
const pair = (v: unknown, max: number): L10n | null => (isObj(v) && text(v.ko, max) && text(v.en, max) ? { ko: v.ko, en: v.en } : null)
const date = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && DATE.test(v) && !Number.isNaN(Date.parse(v))
const int = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

function readCaps(v: unknown): Caps | null {
  if (!isObj(v)) return null
  const o: Record<string, number> = {}
  for (const k of ['read', 'change', 'danger', 'stream', 'form', 'chart', 'badge', 'autoRun']) {
    if (!int(v[k], GALLERY_LIMITS.capMax)) return null
    o[k] = v[k] as number
  }
  const perms = v.perms === undefined ? [] : v.perms
  if (!Array.isArray(perms) || perms.length > GALLERY_LIMITS.perms || !perms.every((p) => text(p, GALLERY_LIMITS.permChars))) return null
  return { ...(o as Omit<Caps, 'perms'>), perms: perms as string[] }
}

// 한 항목 검사: 틀리면 이유 글자(개발자용), 맞으면 아는 필드만 골라 새 객체로
export function readPack(v: unknown): GalleryPack | string {
  if (!isObj(v)) return '항목이 객체가 아님'
  const bad = (m: string) => `${typeof v.id === 'string' ? v.id.slice(0, 40) : '?'}: ${m}`
  if (typeof v.id !== 'string' || !ID.test(v.id)) return bad('id')
  if (typeof v.version !== 'string' || !SEMVER.test(v.version)) return bad('version')
  const name = pair(v.name, GALLERY_LIMITS.name)
  const desc = pair(v.desc, GALLERY_LIMITS.desc)
  if (!name) return bad('name')
  if (!desc) return bad('desc')
  if (v.author !== undefined && !text(v.author, GALLERY_LIMITS.author)) return bad('author')
  if (v.submitter !== undefined && !(typeof v.submitter === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(v.submitter))) return bad('submitter')
  if (!text(v.license, GALLERY_LIMITS.license)) return bad('license')
  if (v.tier !== 'reviewed') return bad('tier')
  if (v.minApp !== undefined && !(typeof v.minApp === 'string' && SEMVER.test(v.minApp))) return bad('minApp')
  // 파일 경로는 상대 경로 정규식에 맞고 id·버전과 같아야 함 (절대 주소·.. 불가)
  if (typeof v.file !== 'string' || !FILE.test(v.file) || v.file !== fileOf(v.id, v.version)) return bad('file')
  if (typeof v.sha256 !== 'string' || !HEX64.test(v.sha256)) return bad('sha256')
  if (typeof v.size !== 'number' || !Number.isInteger(v.size) || v.size < 1 || v.size > GALLERY_LIMITS.pack) return bad('size')
  const caps = readCaps(v.caps)
  if (!caps) return bad('caps')
  const tags = v.tags === undefined ? [] : v.tags
  if (!Array.isArray(tags) || tags.length > GALLERY_LIMITS.tags || !tags.every((t) => text(t, GALLERY_LIMITS.tagChars))) return bad('tags')
  if (!date(v.reviewedAt)) return bad('reviewedAt')
  return { id: v.id, version: v.version, name, desc, author: v.author as string | undefined, submitter: v.submitter as string | undefined, license: v.license, tier: 'reviewed', minApp: v.minApp as string | undefined, file: v.file, sha256: v.sha256, size: v.size, caps, tags: tags as string[], reviewedAt: v.reviewedAt }
}
function readRevoked(v: unknown): Revoked | null {
  if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id)) return null
  if (v.version !== undefined && !(typeof v.version === 'string' && SEMVER.test(v.version))) return null
  if (v.sha256 !== undefined && !(typeof v.sha256 === 'string' && HEX64.test(v.sha256))) return null
  const reason = pair(v.reason, GALLERY_LIMITS.reason)
  if (!reason || !date(v.at)) return null
  return { id: v.id, version: v.version as string | undefined, sha256: v.sha256 as string | undefined, reason, at: v.at }
}

// 색인 바이트 + 서명 글자 → 믿을 수 있는 색인. 서명 → JSON → 형식 → serial 순서. 하나라도 틀리면 거기서 멈춤
export function parseIndex(bytes: Uint8Array, sigText: string, o: ParseOpts): ParseOk | ParseFail {
  if (bytes.length > GALLERY_LIMITS.index) return { ok: false, code: 'too-big' }
  const keyIndex = verifySignature(bytes, sigText, o.keys)
  if (keyIndex < 0) return { ok: false, code: 'bad-signature' }
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^﻿/, ''))
  } catch {
    return { ok: false, code: 'bad-json' }
  }
  const fail = (detail: string): ParseFail => ({ ok: false, code: 'bad-format', detail })
  if (!isObj(raw) || raw.format !== 1) return fail('format')
  if (!int(raw.serial, Number.MAX_SAFE_INTEGER)) return fail('serial')
  if (!date(raw.generatedAt) || !date(raw.expires) || Date.parse(raw.expires) <= Date.parse(raw.generatedAt)) return fail('dates')
  if (!Array.isArray(raw.packs) || raw.packs.length > GALLERY_LIMITS.packs) return fail('packs')
  const revokedRaw = raw.revoked === undefined ? [] : raw.revoked
  if (!Array.isArray(revokedRaw) || revokedRaw.length > GALLERY_LIMITS.revoked) return fail('revoked')
  const packs: GalleryPack[] = []
  const seen = new Set<string>()
  for (const p of raw.packs) {
    const r = readPack(p)
    if (typeof r === 'string') return fail(r)
    if (seen.has(r.id)) return fail(`${r.id}: id가 겹침`) // 색인에는 팩 id마다 한 버전만
    seen.add(r.id)
    packs.push(r)
  }
  const revoked: Revoked[] = []
  for (const r of revokedRaw) {
    const x = readRevoked(r)
    if (!x) return fail('revoked 항목')
    revoked.push(x)
  }
  if (raw.serial < o.lastSerial) return { ok: false, code: 'rollback', detail: `${raw.serial} < ${o.lastSerial}` } // 옛 목록 되돌리기 방지
  return { ok: true, index: { format: 1, serial: raw.serial, generatedAt: raw.generatedAt, expires: raw.expires, packs, revoked }, expired: Date.parse(raw.expires) < o.now.getTime(), keyIndex }
}

// ───────────── 철회·앱 버전·팩 파일 확인 ─────────────
export function revokedFor(index: Pick<GalleryIndex, 'revoked'>, id: string, version: string, sha256: string): Revoked | null {
  return index.revoked.find((r) => r.id === id && (!r.version || r.version === version) && (!r.sha256 || r.sha256 === sha256)) ?? null
}
export const appVersionOk = (p: { minApp?: string }, appVersion: string) => !p.minApp || compareSemver(appVersion, p.minApp) >= 0

export type FileError = 'too-big' | 'size-mismatch' | 'hash-mismatch'
// 내려받은 팩 파일 바이트가 색인이 약속한 크기·지문과 같은가
export function checkPackFile(p: Pick<GalleryPack, 'size' | 'sha256'>, bytes: Uint8Array): FileError | null {
  if (bytes.length > GALLERY_LIMITS.pack) return 'too-big'
  if (bytes.length !== p.size) return 'size-mismatch'
  return sha256Hex(bytes) === p.sha256 ? null : 'hash-mismatch'
}
// 팩 안의 id·버전이 색인 항목과 같은가 (색인이 약속한 팩이 맞는지)
export const checkPackIdentity = (p: Pick<GalleryPack, 'id' | 'version'>, pack: { id: string; version: string }): 'id-mismatch' | 'version-mismatch' | null => (pack.id !== p.id ? 'id-mismatch' : pack.version !== p.version ? 'version-mismatch' : null)
