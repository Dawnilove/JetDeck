// 모음 흐름(5.5.0): 목록 받기·검증·저장, 오프라인/서명 실패 때 마지막 정상 목록, 팩 파일 받기, 화면용 목록 만들기.
// 네트워크·저장은 deps로 받아서 Electron 없이 시험 (galleryflow.test.mts). 설계안 §8-5·§8-11
import { appVersionOk, checkPackFile, GALLERY_LIMITS, parseIndex, revokedFor, type GalleryPack, type IndexError, type Revoked } from './gallerycore.mts'
import type { FetchResult, NetError, Source } from './gallerynet.mts'
import type { GalleryState } from './gallerystore.mts'
import { compareSemver, type L10n } from './packschema.mts'

export type FlowDeps = {
  source: Source
  now: () => Date
  fetch: (url: string, o: { max: number; etag?: string }) => Promise<FetchResult>
  load: () => GalleryState
  save: (st: GalleryState) => void
}
export type ListStatus = 'ok' | 'offline' | 'untrusted'
export type ListError = IndexError | NetError | 'no-keys'
export type Listing = {
  status: ListStatus
  error?: ListError
  expired: boolean
  fromCache: boolean // 지금 못 받아서 마지막 정상 목록을 보이는 중
  serial?: number
  fetchedAt?: string
  generatedAt?: string
  expires?: string
  base?: string // 이 목록을 받은 주소
  packs: GalleryPack[]
  revoked: Revoked[]
}
const EMPTY: Listing = { status: 'offline', expired: false, fromCache: false, packs: [], revoked: [] }
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

function listingOf(r: Extract<ReturnType<typeof parseIndex>, { ok: true }>, st: Pick<GalleryState, 'fetchedAt'>, fromCache: boolean, status: ListStatus, error?: ListError, base?: string): Listing {
  return { status, error, expired: r.expired, fromCache, serial: r.index.serial, fetchedAt: st.fetchedAt, generatedAt: r.index.generatedAt, expires: r.index.expires, base, packs: r.index.packs, revoked: r.index.revoked }
}

// 저장해 둔 목록을 서명부터 다시 확인해서 읽음 (네트워크 없음)
export function cachedListing(d: FlowDeps, status: ListStatus = 'offline', error?: ListError): Listing {
  const st = d.load()
  if (!st.index || !st.sig) return { ...EMPTY, status, error }
  const bytes = Buffer.from(st.index, 'base64')
  const r = parseIndex(bytes, st.sig, { keys: d.source.keys, lastSerial: 0, now: d.now() })
  return r.ok ? listingOf(r, st, true, status, error, st.etagBase) : { ...EMPTY, status, error }
}

// 목록 받기: 주소를 차례로 시도(서버 오류·서명 틀림·옛 목록이면 다음 주소). 전부 실패하면 마지막 정상 목록
export async function refreshListing(d: FlowDeps): Promise<Listing> {
  if (!d.source.keys.length) return cachedListing(d, 'untrusted', 'no-keys')
  const st = d.load()
  let netErr: NetError | null = null
  let trustErr: IndexError | null = null
  for (const base of d.source.bases) {
    const idx = await d.fetch(base + 'index.json', { max: GALLERY_LIMITS.index, etag: st.etagBase === base && st.index ? st.etag : undefined })
    let bytes: Uint8Array
    let sig: string
    let etag: string | undefined
    if (idx.ok && idx.status === 304) {
      if (!st.index || !st.sig) continue
      bytes = Buffer.from(st.index, 'base64')
      sig = st.sig
      etag = st.etag
    } else if (idx.ok && idx.status === 200) {
      const s = await d.fetch(base + 'index.json.sig', { max: GALLERY_LIMITS.sig })
      if (!s.ok || s.status !== 200) {
        netErr = s.ok ? 'http-status' : s.code
        continue
      }
      bytes = idx.bytes
      sig = s.bytes.toString('utf8')
      etag = idx.etag
    } else {
      netErr = idx.ok ? 'http-status' : idx.code
      continue
    }
    const r = parseIndex(bytes, sig, { keys: d.source.keys, lastSerial: st.lastSerial, now: d.now() })
    if (!r.ok) {
      trustErr = trustErr ?? r.code
      continue
    }
    const fetchedAt = d.now().toISOString()
    d.save({ ...st, lastSerial: Math.max(st.lastSerial, r.index.serial), fetchedAt, etag, etagBase: etag ? base : undefined, index: b64(bytes), sig: sig.trim() })
    return listingOf(r, { fetchedAt }, false, 'ok', undefined, base)
  }
  return trustErr ? cachedListing(d, 'untrusted', trustErr) : cachedListing(d, 'offline', netErr ?? 'network')
}

export type PackFileError = NetError | 'not-listed' | 'blocked' | 'too-big' | 'size-mismatch' | 'hash-mismatch'
// 팩 파일 받기: 목록이 정상(ok)이고 만료 전일 때만. 주소는 목록의 base(우선)와 나머지. 크기·지문이 색인과 같아야 함
export async function fetchPackFile(d: FlowDeps, list: Listing, id: string, appVersion: string): Promise<{ ok: true; pack: GalleryPack; bytes: Buffer } | { ok: false; code: PackFileError }> {
  const pack = list.packs.find((p) => p.id === id)
  if (!pack) return { ok: false, code: 'not-listed' }
  if (list.status !== 'ok' || list.expired || list.fromCache || !appVersionOk(pack, appVersion) || revokedFor(list, pack.id, pack.version, pack.sha256)) return { ok: false, code: 'blocked' }
  const bases = [...(list.base ? [list.base] : []), ...d.source.bases.filter((b) => b !== list.base)]
  let last: PackFileError = 'network'
  for (const base of bases) {
    const r = await d.fetch(base + pack.file, { max: GALLERY_LIMITS.pack })
    if (!r.ok || r.status !== 200) {
      last = r.ok ? 'http-status' : r.code
      continue
    }
    const bad = checkPackFile(pack, r.bytes)
    if (bad) {
      last = bad
      continue
    }
    return { ok: true, pack, bytes: r.bytes }
  }
  return { ok: false, code: last }
}

// ───────────── 화면용 목록 ─────────────
export type Block = 'app-version' | 'revoked' | 'safe-mode' | 'offline' | 'expired' | 'untrusted'
export type GalleryItem = GalleryPack & { block?: Block; revokedReason?: L10n; installedVersion?: string; fromGallery: boolean; update: boolean }
export type InstalledPack = { id: string; version: string; hash: string; fromGallery: boolean }
export type GalleryView = {
  consent: boolean
  safeMode: boolean
  dev: boolean // 개발 빌드가 시험 서버를 쓰는 중
  status: ListStatus | 'idle' // idle: 아직 받지 않음
  error?: ListError
  expired: boolean
  fromCache: boolean
  serial?: number
  fetchedAt?: string
  generatedAt?: string
  expires?: string
  items: GalleryItem[]
  revokedInstalled: { id: string; version: string; reason: L10n }[] // 철회된 팩을 이미 설치함 (5.6.0에서 자동으로 끔)
}
export function buildView(list: Listing | null, o: { consent: boolean; safeMode: boolean; dev: boolean; appVersion: string; installed: InstalledPack[] }): GalleryView {
  const l = list ?? { ...EMPTY, status: 'offline' as ListStatus }
  const global: Block | undefined = l.status === 'untrusted' ? 'untrusted' : l.status === 'offline' ? 'offline' : l.expired ? 'expired' : o.safeMode ? 'safe-mode' : undefined
  const items: GalleryItem[] = l.packs.map((p) => {
    const rev = revokedFor(l, p.id, p.version, p.sha256)
    const inst = o.installed.find((i) => i.id === p.id)
    const block: Block | undefined = rev ? 'revoked' : !appVersionOk(p, o.appVersion) ? 'app-version' : global
    return { ...p, block, revokedReason: rev?.reason, installedVersion: inst?.version, fromGallery: !!inst?.fromGallery, update: !!inst?.fromGallery && compareSemver(p.version, inst.version) > 0 }
  })
  const revokedInstalled = o.installed.filter((i) => i.fromGallery).flatMap((i) => {
    const rev = revokedFor(l, i.id, i.version, i.hash)
    return rev ? [{ id: i.id, version: i.version, reason: rev.reason }] : []
  })
  return { consent: o.consent, safeMode: o.safeMode, dev: o.dev, status: list ? l.status : 'idle', error: l.error, expired: l.expired, fromCache: l.fromCache, serial: l.serial, fetchedAt: l.fetchedAt, generatedAt: l.generatedAt, expires: l.expires, items, revokedInstalled }
}
