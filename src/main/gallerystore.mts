// 모음 상태 파일 (userData/gallery.json): 동의, 마지막으로 본 serial(되돌림 방지), 마지막 정상 목록(오프라인용). Electron 없이 시험
// 저장한 목록은 믿지 않고, 읽을 때마다 서명을 다시 확인한다 (파일을 바꿔 끼워도 서명 없는 목록은 쓰지 못함)
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { GALLERY_LIMITS } from './gallerycore.mts'

export type GalleryState = {
  version: 1
  consent: boolean // 처음 열 때 안내에 동의했는가
  lastSerial: number
  fetchedAt?: string
  etag?: string
  etagBase?: string // etag를 받은 주소 (다른 주소에는 보내지 않음)
  index?: string // 마지막 정상 색인 원본 바이트 (base64)
  sig?: string
}
export const emptyGalleryState = (): GalleryState => ({ version: 1, consent: false, lastSerial: 0 })

export function readGalleryState(file: string): GalleryState {
  const out = emptyGalleryState()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
    if (!raw || typeof raw !== 'object') return out
    out.consent = raw.consent === true
    if (Number.isInteger(raw.lastSerial) && raw.lastSerial >= 0) out.lastSerial = raw.lastSerial
    if (typeof raw.fetchedAt === 'string') out.fetchedAt = raw.fetchedAt.slice(0, 40)
    if (typeof raw.etag === 'string' && raw.etag.length <= 200) out.etag = raw.etag
    if (typeof raw.etagBase === 'string' && raw.etagBase.length <= 200) out.etagBase = raw.etagBase
    if (typeof raw.index === 'string' && raw.index.length <= Math.ceil((GALLERY_LIMITS.index * 4) / 3) + 8 && typeof raw.sig === 'string' && raw.sig.length <= GALLERY_LIMITS.sig) {
      out.index = raw.index
      out.sig = raw.sig
    }
  } catch {
    /* 없음·깨짐 → 빈 상태 */
  }
  return out
}
export function writeGalleryState(file: string, st: GalleryState): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(st), 'utf8')
  renameSync(tmp, file)
}
