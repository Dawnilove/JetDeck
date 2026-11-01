// 모음 철회 처리 (5.6.0): 서명된 목록의 revoked에 든 팩을 이미 설치했다면 자동으로 끄고, 하루 1번 확인할지 정함.
// 순수 로직 (Electron·네트워크 없음): galleryrevoke.test.mts. 설계안 §8-7
import { revokedFor, type GalleryIndex } from './gallerycore.mts'
import { markRevoked, type PackEntry, type StateFile } from './packstore.mts'
import type { L10n } from './packschema.mts'

export const CHECK_GAP_MS = 24 * 60 * 60 * 1000 // 철회 확인은 하루 1번

export type TurnedOff = { id: string; version: string; reason: L10n }

// 모음에서 받은 파일 그대로인 팩(origin 있음)만 본다. 내가 파일을 바꿨거나 직접 설치한 팩은 건드리지 않음
export function applyRevocations(st: StateFile, entries: PackEntry[], list: Pick<GalleryIndex, 'revoked'>, now = new Date()): { state: StateFile; turnedOff: TurnedOff[] } {
  let state = st
  const turnedOff: TurnedOff[] = []
  for (const e of entries) {
    if (e.source !== 'user' || !e.pack || !e.origin) continue
    const rev = revokedFor(list, e.id, e.pack.version, e.hash)
    if (!rev) continue
    const wasOn = !!state.packs[e.id]?.enabled
    const next = markRevoked(state, e, rev.reason, now)
    if (next === state) continue
    state = next
    if (wasOn) turnedOff.push({ id: e.id, version: e.pack.version, reason: rev.reason })
  }
  return { state, turnedOff }
}

// 앱을 켤 때 확인할지: 동의했고, 스위치가 켜져 있고, 모음에서 받은 팩이 하나라도 있고, 마지막 확인이 하루보다 오래됨
export function shouldCheck(o: { consent: boolean; autoCheck: boolean; hasGalleryPacks: boolean; checkedAt?: string; now: Date }): boolean {
  if (!o.consent || !o.autoCheck || !o.hasGalleryPacks) return false
  const last = o.checkedAt ? Date.parse(o.checkedAt) : NaN
  return !(Number.isFinite(last) && o.now.getTime() - last < CHECK_GAP_MS && last <= o.now.getTime())
}
