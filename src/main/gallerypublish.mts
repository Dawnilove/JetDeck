// 모음 게시 도구의 로직 (5.5.0, 설계안 §8-10): 색인 만들기·서명·확인. scripts/gallery-*.mjs가 얇게 감싸서 씀. 앱은 쓰지 않음. Electron 없이 시험 (gallerypublish.test.mts)
// 사람이 하는 일: catalog.json 쓰기, 요약 읽기, 서명(비밀 열쇠는 사용자만 만짐), push. 이 파일은 비밀 열쇠를 읽는 signDir 말고는 열쇠를 다루지 않음
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPIRES_DAYS, GALLERY_LIMITS, checkPackFile, checkPackIdentity, fileOf, parseIndex, readIndex, readPack, sha256Hex, type GalleryIndex, type GalleryPack, type Revoked } from './gallerycore.mts'
import { renderIndexHtml } from './gallerypage.mts'
import { signBytes } from './gallerykit.mts'
import { summarizePack, validatePack } from './packschema.mts'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))

export type BuildOk = { ok: true; index: GalleryIndex; text: string; summary: string[] }
export type BuildFail = { ok: false; problems: string[] }

// catalog.json(관리자가 쓰는 목록) + files/ 아래 팩 파일 → 색인. 팩은 앱과 같은 검증기로 검사하고, 오류·경고·낮게 적힌 위험도가 있으면 실패
export function buildIndex(dir: string, o: { now?: Date; serial?: number; expiresDays?: number } = {}): BuildOk | BuildFail {
  const now = o.now ?? new Date()
  const problems: string[] = []
  const catFile = join(dir, 'catalog.json')
  if (!existsSync(catFile)) return { ok: false, problems: [`${catFile} 이 없어요`] }
  let cat: unknown
  try {
    cat = readJson(catFile)
  } catch {
    return { ok: false, problems: ['catalog.json 이 JSON이 아니에요'] }
  }
  if (!isObj(cat) || !Array.isArray(cat.packs)) return { ok: false, problems: ['catalog.json 에 packs 배열이 필요해요'] }
  if (cat.packs.length > GALLERY_LIMITS.packs) return { ok: false, problems: [`팩은 ${GALLERY_LIMITS.packs}개까지예요`] }

  // 지난 색인: serial을 이어 가고, 이미 올린 버전의 파일이 바뀌지 않았는지 확인
  let prev: GalleryIndex | null = null
  const idxFile = join(dir, 'index.json')
  if (existsSync(idxFile)) {
    try {
      const j = readJson(idxFile)
      if (isObj(j) && Number.isInteger(j.serial) && Array.isArray(j.packs)) prev = j as unknown as GalleryIndex
    } catch {
      /* 깨진 옛 색인은 무시 */
    }
  }
  const serial = o.serial ?? (prev ? prev.serial + 1 : 1)

  const packs: GalleryPack[] = []
  for (const c of cat.packs) {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.version !== 'string') {
      problems.push('catalog 항목에 id·version이 필요해요')
      continue
    }
    const tag = `${c.id}@${c.version}`
    const file = join(dir, fileOf(c.id, c.version))
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(c.id) || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(c.version)) {
      problems.push(`${tag}: id 또는 version 형식이 틀려요`)
      continue
    }
    if (!existsSync(file)) {
      problems.push(`${tag}: ${fileOf(c.id, c.version)} 파일이 없어요`)
      continue
    }
    const bytes = readFileSync(file)
    if (bytes.length > GALLERY_LIMITS.pack) {
      problems.push(`${tag}: 팩 파일이 ${GALLERY_LIMITS.pack / 1024}KB보다 커요`)
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''))
    } catch {
      problems.push(`${tag}: 팩 파일이 JSON이 아니에요`)
      continue
    }
    const v = validatePack(raw, { official: false })
    if (!v.pack) {
      problems.push(`${tag}: ${v.errors[0] ?? '팩이 올바르지 않아요'}`)
      continue
    }
    for (const e of v.errors) problems.push(`${tag}: ${e}`) // 검증기가 빼 버린 항목이 있으면 게시하지 않음
    for (const w of v.warnings) problems.push(`${tag}: 경고 — ${w}`)
    const idErr = checkPackIdentity({ id: c.id, version: c.version }, v.pack)
    if (idErr) problems.push(`${tag}: 팩 파일 안의 id/version이 달라요 (${idErr})`)
    const sum = summarizePack(v.pack)
    if (sum.understated) problems.push(`${tag}: 위험도를 낮게 적은 항목이 ${sum.understated}개 있어요`)
    if (sum.hidden) problems.push(`${tag}: 이 앱이 모르는 방식의 항목이 ${sum.hidden}개 있어요`)
    if (!v.pack.license) problems.push(`${tag}: license가 필요해요`)
    if (!v.pack.desc) problems.push(`${tag}: desc가 필요해요`)
    const sha = sha256Hex(bytes)
    const before = prev?.packs?.find((p) => p?.id === c.id && p?.version === c.version)
    if (before && before.sha256 !== sha) problems.push(`${tag}: 이미 올린 버전의 파일이 바뀌었어요. 고치지 말고 새 버전 폴더를 쓰세요`)
    const entry = readPack({
      id: c.id, version: c.version, name: v.pack.name, desc: v.pack.desc, author: v.pack.author, submitter: c.submitter, license: v.pack.license, tier: 'reviewed', minApp: v.pack.minApp,
      file: fileOf(c.id, c.version), sha256: sha, size: bytes.length,
      caps: { read: sum.read, change: sum.change, danger: sum.danger, stream: sum.stream, form: sum.form, chart: sum.chart, badge: sum.badge, autoRun: sum.autoRun, perms: [] },
      tags: c.tags ?? [], reviewedAt: c.reviewedAt
    })
    if (typeof entry === 'string') problems.push(`${tag}: 색인 항목이 올바르지 않아요 (${entry})`)
    else packs.push(entry)
  }
  const revoked: Revoked[] = []
  const revRaw = cat.revoked === undefined ? [] : cat.revoked
  if (!Array.isArray(revRaw)) problems.push('revoked 는 배열이에요')
  else for (const r of revRaw) revoked.push(r as Revoked)
  if (problems.length) return { ok: false, problems }

  const index: GalleryIndex = { format: 1, serial, generatedAt: now.toISOString(), expires: new Date(now.getTime() + (o.expiresDays ?? EXPIRES_DAYS) * 86400_000).toISOString(), packs, revoked }
  const text = JSON.stringify(index, null, 2) + '\n'
  const chk = readIndex(JSON.parse(text), { lastSerial: 0, now }) // 앱이 읽는 규칙(철회 항목 포함)을 통과하는지 서명 전에 확인
  if (!chk.ok) return { ok: false, problems: [`만든 색인을 앱이 거부할 거예요: ${chk.code}${chk.detail ? ' ' + chk.detail : ''}`] }
  return { ok: true, index, text, summary: summarize(prev, index) }
}

// 바뀐 점 요약 (사용자가 서명 전에 읽는 것)
export function summarize(prev: GalleryIndex | null, next: GalleryIndex): string[] {
  const out: string[] = [`serial ${prev?.serial ?? 0} → ${next.serial}, 만료 ${next.expires.slice(0, 10)}, 팩 ${next.packs.length}개`]
  const before = new Map((prev?.packs ?? []).map((p) => [p.id, p]))
  for (const p of next.packs) {
    const b = before.get(p.id)
    if (!b) out.push(`+ 새 팩 ${p.id} ${p.version} (읽기 ${p.caps.read} · 바꿈 ${p.caps.change} · 위험 ${p.caps.danger} · 자동 ${p.caps.autoRun}) 제출 @${p.submitter ?? '?'}`)
    else if (b.version !== p.version || b.sha256 !== p.sha256) out.push(`~ 바뀐 팩 ${p.id} ${b.version} → ${p.version}`)
    before.delete(p.id)
  }
  for (const b of before.values()) out.push(`- 목록에서 뺀 팩 ${b.id} ${b.version}`)
  const oldRev = new Set((prev?.revoked ?? []).map((r) => `${r.id}/${r.version ?? ''}/${r.sha256 ?? ''}`))
  for (const r of next.revoked) if (!oldRev.has(`${r.id}/${r.version ?? ''}/${r.sha256 ?? ''}`)) out.push(`! 새 철회 ${r.id}${r.version ? ' ' + r.version : ''}: ${r.reason.ko}`)
  if (out.length === 1) out.push('(팩 변화 없음 — 재서명만)')
  return out
}

// 새 색인과 사람이 읽는 목록 페이지(index.html)를 쓰고, 이전 서명은 지움 (내용이 바뀌었으니 서명도 다시 해야 함)
export function writeBuild(dir: string, b: BuildOk): void {
  const tmp = join(dir, 'index.json.tmp')
  writeFileSync(tmp, b.text, 'utf8')
  renameSync(tmp, join(dir, 'index.json'))
  writeFileSync(join(dir, 'index.html'), renderIndexHtml(b.index), 'utf8')
  rmSync(join(dir, 'index.json.sig'), { force: true })
}

export type SignResult = { ok: true; keyIndex: number; publicB64: string } | { ok: false; problem: string }
// 서명: 비밀 열쇠(PEM 글자)로 index.json의 원본 바이트에 서명하고 index.json.sig에 씀. 쓴 뒤 공개 열쇠로 다시 확인.
// keys는 앱에 박힌 공개 열쇠. 이 서명 열쇠의 공개 부분이 keys에 없으면(앱이 거부할 서명이면) allowUnknown 없이는 실패
export function signDir(dir: string, secretPem: string, o: { keys: string[]; allowUnknown?: boolean }): SignResult {
  const idxFile = join(dir, 'index.json')
  if (!existsSync(idxFile)) return { ok: false, problem: 'index.json 이 없어요. 먼저 gallery:build 를 실행하세요' }
  let secret
  try {
    secret = createPrivateKey(secretPem)
  } catch {
    return { ok: false, problem: '열쇠 파일을 읽을 수 없어요 (PEM 형식이어야 해요)' }
  }
  if (secret.asymmetricKeyType !== 'ed25519') return { ok: false, problem: 'ed25519 열쇠가 아니에요' }
  const spki = createPublicKey(secret).export({ format: 'der', type: 'spki' })
  const publicB64 = spki.subarray(spki.length - 32).toString('base64')
  const slot = o.keys.indexOf(publicB64)
  if (slot < 0 && !o.allowUnknown) return { ok: false, problem: '이 열쇠의 공개 열쇠가 앱(gallerykeys.mts)에 없어요. 이대로 서명하면 앱이 목록을 거부해요' }
  const bytes = readFileSync(idxFile)
  const sig = signBytes(bytes, secret)
  const check = parseIndex(bytes, sig, { keys: [publicB64], lastSerial: 0, now: new Date(0) })
  if (!check.ok) return { ok: false, problem: `서명 직후 확인에 실패했어요 (${check.code}${check.detail ? ': ' + check.detail : ''}). index.json 형식을 확인하세요` }
  writeFileSync(join(dir, 'index.json.sig'), sig + '\n', 'utf8')
  return { ok: true, keyIndex: slot, publicB64 }
}

export type VerifyResult = { ok: boolean; problems: string[]; warnings: string[]; info: string[] }
// 게시 전 확인: 공개 열쇠로 서명·형식·만료, 모든 팩 파일의 지문·크기·검증기·캐쉬 요약 일치
export function verifyDir(dir: string, o: { keys: string[]; now?: Date; lastSerial?: number }): VerifyResult {
  const now = o.now ?? new Date()
  const r: VerifyResult = { ok: false, problems: [], warnings: [], info: [] }
  const idxFile = join(dir, 'index.json')
  const sigFile = join(dir, 'index.json.sig')
  if (!existsSync(idxFile) || !existsSync(sigFile)) {
    r.problems.push('index.json 또는 index.json.sig 가 없어요')
    return r
  }
  if (!o.keys.length) r.problems.push('앱에 공개 열쇠가 없어요 (gallerykeys.mts). 앱이 모든 목록을 거부해요')
  const bytes = readFileSync(idxFile)
  const p = parseIndex(bytes, readFileSync(sigFile, 'utf8'), { keys: o.keys, lastSerial: o.lastSerial ?? 0, now })
  if (!p.ok) {
    r.problems.push(`색인을 앱이 거부해요: ${p.code}${p.detail ? ' ' + p.detail : ''}`)
    return r
  }
  if (p.expired) r.problems.push('색인이 이미 만료됐어요')
  const daysLeft = Math.floor((Date.parse(p.index.expires) - now.getTime()) / 86400_000)
  if (!p.expired && daysLeft < 14) r.warnings.push(`만료까지 ${daysLeft}일 남았어요. 다시 서명하세요`)
  r.info.push(`서명 확인됨 (열쇠 ${p.keyIndex + 1}번 자리), serial ${p.index.serial}, 팩 ${p.index.packs.length}개, 철회 ${p.index.revoked.length}개, 만료 ${p.index.expires.slice(0, 10)}`)
  for (const e of p.index.packs) {
    const file = join(dir, e.file)
    if (!existsSync(file)) {
      r.problems.push(`${e.id}: ${e.file} 파일이 없어요`)
      continue
    }
    const b = readFileSync(file)
    const bad = checkPackFile(e, b)
    if (bad) {
      r.problems.push(`${e.id}: 팩 파일이 색인과 달라요 (${bad})`)
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(b.toString('utf8').replace(/^﻿/, ''))
    } catch {
      r.problems.push(`${e.id}: 팩 파일이 JSON이 아니에요`)
      continue
    }
    const v = validatePack(raw, { official: false })
    if (!v.pack || v.errors.length || v.warnings.length) {
      r.problems.push(`${e.id}: 앱 검증기가 받아들이지 않아요 — ${[...v.errors, ...v.warnings][0] ?? ''}`)
      continue
    }
    const id = checkPackIdentity(e, v.pack)
    if (id) r.problems.push(`${e.id}: 팩 안의 id/version이 색인과 달라요 (${id})`)
    const s = summarizePack(v.pack)
    if (s.understated || s.hidden) r.problems.push(`${e.id}: 위험도를 낮게 적었거나 모르는 항목이 있어요`)
    const caps = e.caps
    if (caps.read !== s.read || caps.change !== s.change || caps.danger !== s.danger || caps.stream !== s.stream || caps.form !== s.form || caps.chart !== s.chart || caps.badge !== s.badge || caps.autoRun !== s.autoRun) r.problems.push(`${e.id}: 색인의 능력 요약(caps)이 팩과 달라요`)
  }
  r.ok = r.problems.length === 0
  return r
}
