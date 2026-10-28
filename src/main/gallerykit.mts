// 모음 시험·스크립트 공용 도구: 열쇠 쌍 만들기, 색인 만들기, 서명. 앱 코드는 이 파일을 쓰지 않음 (scripts/gallery-*.mjs와 시험이 씀)
import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { EXPIRES_DAYS, fileOf, sha256Hex, type GalleryIndex, type GalleryPack } from './gallerycore.mts'

// 새 ed25519 열쇠 쌍: 공개 열쇠는 32바이트 base64, 비밀 열쇠는 PKCS8 PEM
export function newKeyPair(): { publicB64: string; secretPem: string; secret: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return { publicB64: spki.subarray(spki.length - 32).toString('base64'), secretPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), secret: privateKey }
}
export const secretFromPem = (pem: string) => createPrivateKey(pem)
// 서명: 색인의 원본 바이트에 대한 분리 서명(base64)
export const signBytes = (data: Uint8Array, secret: KeyObject): string => sign(null, data, secret).toString('base64')

// 시험용 팩 항목 (파일 바이트에서 지문·크기를 계산)
export function packEntry(id: string, version: string, bytes: Uint8Array, over: Partial<GalleryPack> = {}): GalleryPack {
  return {
    id, version, name: { ko: '시험 팩', en: 'Test pack' }, desc: { ko: '시험', en: 'test' }, author: 'tester', submitter: 'someuser', license: 'MIT', tier: 'reviewed',
    file: fileOf(id, version), sha256: sha256Hex(bytes), size: bytes.length, caps: { read: 1, change: 0, danger: 0, stream: 0, form: 0, chart: 0, badge: 0, autoRun: 0, perms: [] }, tags: [], reviewedAt: '2026-10-28', ...over
  }
}
export function makeIndex(packs: GalleryPack[], over: Partial<GalleryIndex> = {}, now = new Date('2026-10-28T00:00:00Z')): GalleryIndex {
  return { format: 1, serial: 1, generatedAt: now.toISOString(), expires: new Date(now.getTime() + EXPIRES_DAYS * 86400_000).toISOString(), packs, revoked: [], ...over }
}
export const indexBytes = (idx: unknown): Uint8Array => Buffer.from(JSON.stringify(idx, null, 2) + '\n', 'utf8')
