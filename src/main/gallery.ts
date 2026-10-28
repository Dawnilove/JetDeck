import { app, ipcMain, net } from 'electron'
import { join } from 'node:path'
import { checkPackIdentity, revokedFor, type GalleryPack } from './gallerycore.mts'
import { buildView, cachedListing, fetchPackFile, refreshListing, type FlowDeps, type GalleryView, type InstalledPack, type Listing, type PackFileError } from './galleryflow.mts'
import { fetchLimited, REFRESH_GAP_MS, resolveSource } from './gallerynet.mts'
import { readGalleryState, writeGalleryState } from './gallerystore.mts'
import { tr } from './i18n.mts'
import { installFromGallery, isSafeMode, packEntries, type Catalog } from './pack'
import { inspectPackBytes, type Inspect } from './packstore.mts'

// 모음 (5.5.0): 서명된 색인을 내려받아 보여 주고, 사용자가 누르면 팩 파일을 받아 지문·검사를 거쳐 기존 설치 흐름으로 설치.
// 내려받기는 main에서만 한다 (화면 CSP는 그대로). 순수 로직은 gallerycore/gallerynet/galleryflow (시험 있음)
const source = resolveSource(process.env, app.isPackaged)
const stateFile = () => join(app.getPath('userData'), 'gallery.json')

let current: Listing | null = null // 이번 실행에서 받은 목록 (설치는 이 목록의 항목만)
let lastRefresh = 0
let refreshing: Promise<Listing> | null = null
let ctl = new AbortController() // 취소: 목록 받기·팩 받기를 한꺼번에 끊음
let pending: { entry: GalleryPack; bytes: Uint8Array; hash: string; serial: number } | null = null // 확인 창에서 보여 준 팩 (같은 지문만 설치)
const reviewing = new Map<string, Promise<GalleryInspect>>() // 팩 id → 확인 중 (같은 팩 이중 클릭은 한 번만)

export type GalleryInspect = { entry: GalleryPack; inspect: Inspect; serial: number; generatedAt?: string }

const deps = (): FlowDeps => ({
  source,
  now: () => new Date(),
  fetch: (url, o) => fetchLimited(url, { max: o.max, etag: o.etag, userAgent: `JetDeck/${app.getVersion()}`, allowLoopbackHttp: source.allowLoopbackHttp, fetchImpl: net.fetch as unknown as typeof fetch, signal: ctl.signal }),
  load: () => readGalleryState(stateFile()),
  save: (s) => writeGalleryState(stateFile(), s)
})

function installed(): InstalledPack[] {
  return packEntries().flatMap((e) => (e.source === 'user' && e.pack ? [{ id: e.id, version: e.pack.version, hash: e.hash, fromGallery: !!e.origin }] : []))
}
const view = (): GalleryView => buildView(current, { consent: readGalleryState(stateFile()).consent, safeMode: isSafeMode(), dev: source.dev, appVersion: app.getVersion(), installed: installed() })

function fileError(code: PackFileError): string {
  if (code === 'blocked') return tr('지금은 이 팩을 설치할 수 없어요. 목록 상태, 철회 여부, 앱 버전을 확인해 주세요')
  if (code === 'not-listed') return tr('목록에 없는 팩이에요')
  if (code === 'too-big') return tr('팩 파일이 너무 커서 받지 않았어요')
  if (code === 'size-mismatch' || code === 'hash-mismatch') return tr('받은 팩 파일이 목록과 달라서 설치를 멈췄어요')
  return tr('팩 파일을 받지 못했어요. 인터넷 연결을 확인해 주세요')
}
function need(): void {
  if (!readGalleryState(stateFile()).consent) throw new Error(tr('먼저 모음 안내에 동의해 주세요'))
}

async function review(id: string): Promise<GalleryInspect> {
  need()
  if (isSafeMode()) throw new Error(tr('안전 모드에서는 모음에서 팩을 설치할 수 없어요'))
  if (!current) throw new Error(tr('지금은 목록을 받을 수 없어요'))
  const r = await fetchPackFile(deps(), current, String(id), app.getVersion())
  if (!r.ok) throw new Error(fileError(r.code))
  const ins = inspectPackBytes(r.bytes, app.getVersion(), packEntries())
  // 받은 팩이 색인이 약속한 팩이 맞는지 (id·버전). 다르면 지문이 맞아도 설치하지 않음
  if (!ins.ok || !ins.pack || checkPackIdentity(r.pack, ins.pack)) throw new Error(tr('받은 팩에 문제가 있어요') + (ins.errors[0] ? `: ${ins.errors[0]}` : ''))
  pending = { entry: r.pack, bytes: r.bytes, hash: ins.hash, serial: current.serial ?? 0 }
  return { entry: r.pack, inspect: ins, serial: current.serial ?? 0, generatedAt: current.generatedAt }
}

export function registerGalleryIpc(): void {
  ipcMain.handle('gallery:view', (): GalleryView => view())
  // 처음 열 때 안내에 동의(true)하거나 끔(false). 끄면 받은 목록도 화면에서 지움
  ipcMain.handle('gallery:consent', (_e, on: boolean): GalleryView => {
    const st = readGalleryState(stateFile())
    writeGalleryState(stateFile(), { ...st, consent: on === true })
    if (on !== true) {
      current = null
      pending = null
    }
    return view()
  })
  // 목록 받기: 10초에 1번. 실패해도 오류는 상태로 돌려줌 (마지막 정상 목록이 있으면 그것)
  ipcMain.handle('gallery:refresh', async (): Promise<GalleryView> => {
    need()
    if (refreshing) {
      await refreshing
      return view()
    }
    if (current && Date.now() - lastRefresh < REFRESH_GAP_MS) return view()
    lastRefresh = Date.now()
    ctl = new AbortController()
    refreshing = refreshListing(deps())
    try {
      current = await refreshing
    } finally {
      refreshing = null
    }
    return view()
  })
  // 내용 보기: 팩 파일을 받아 지문·검사를 거친 결과를 돌려줌 (설치는 아직 안 함)
  ipcMain.handle('gallery:inspect', (_e, id: string): Promise<GalleryInspect> => {
    const key = String(id)
    const busy = reviewing.get(key)
    if (busy) return busy
    ctl = new AbortController()
    const p = review(key).finally(() => reviewing.delete(key))
    reviewing.set(key, p)
    return p
  })
  // 설치: 방금 확인한 팩(같은 지문)만. enable이면 허용·켜기까지 한 번에
  ipcMain.handle('gallery:install', (_e, id: string, hash: string, enable: boolean): Catalog => {
    need()
    if (isSafeMode()) throw new Error(tr('안전 모드에서는 모음에서 팩을 설치할 수 없어요'))
    if (!pending || pending.entry.id !== String(id)) throw new Error(tr('설치할 팩을 먼저 확인해 주세요'))
    if (pending.hash !== String(hash) || !current || current.status !== 'ok' || current.expired) throw new Error(tr('확인한 팩과 달라요. 다시 확인해 주세요'))
    if (revokedFor(current, pending.entry.id, pending.entry.version, pending.entry.sha256)) throw new Error(tr('지금은 이 팩을 설치할 수 없어요. 목록 상태, 철회 여부, 앱 버전을 확인해 주세요'))
    const p = pending
    pending = null
    return installFromGallery(p.bytes, { kind: 'gallery', serial: p.serial, sha256: p.hash }, enable === true, p.hash)
  })
  ipcMain.handle('gallery:cancel', (): void => {
    ctl.abort()
    pending = null
  })
  // 저장해 둔 목록만 보기 (앱을 켠 직후 오프라인 확인용). 네트워크 없음
  ipcMain.handle('gallery:cached', (): GalleryView => {
    if (!current && readGalleryState(stateFile()).consent) current = cachedListing(deps())
    return view()
  })
}
