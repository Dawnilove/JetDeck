// 모음 탭 상단 안내 (5.5.0): 목록 상태·오류 코드를 쉬운 말로. 순수 함수라 Electron 없이 시험 (gallerynote.test.mts)
// 오류는 모음 탭 안에서만 보인다 (설계안 §8-11). 색인이 준 글자는 여기서 쓰지 않는다
import type { GalleryView, ListError } from './galleryflow.mts'
import { tr } from './i18n.mts'

export type Note = { kind: 'err' | 'warn' | 'info'; text: string }

// 오류 코드 → 원인 (한 줄). Record라서 코드가 늘면 타입 검사가 빠진 것을 알려 줌
const CODE_TEXT: Record<ListError, () => string> = {
  'too-big': () => tr('받은 목록이 너무 커서 쓰지 않았어요'),
  'bad-signature': () => tr('목록의 서명이 맞지 않아요'),
  'bad-json': () => tr('받은 목록을 읽을 수 없어요'),
  'bad-format': () => tr('받은 목록의 형식이 맞지 않아요'),
  rollback: () => tr('받은 목록이 저장해 둔 것보다 옛날 것이에요'),
  'no-keys': () => tr('이 JetDeck에는 목록을 확인할 열쇠가 아직 없어요'),
  'bad-url': () => tr('목록 주소가 올바르지 않아요'),
  redirect: () => tr('서버가 다른 주소로 보내서 받지 않았어요'),
  'http-status': () => tr('서버가 목록을 주지 못했어요'),
  timeout: () => tr('서버가 15초 안에 답하지 않았어요'),
  network: () => tr('인터넷에 연결되지 않았거나 서버에 닿지 않았어요'),
  aborted: () => tr('받기를 취소했어요')
}
export const errorText = (c: ListError): string => CODE_TEXT[c]()

export function galleryNotes(v: GalleryView, fmt: (iso: string) => string): Note[] {
  const out: Note[] = []
  const has = v.items.length > 0
  const when = v.fetchedAt ? fmt(v.fetchedAt) : ''
  if (v.status === 'untrusted') {
    out.push({ kind: 'err', text: `${tr('목록을 믿을 수 없어서 안 보여요. 잠시 뒤 다시 시도하거나 새 버전 JetDeck인지 확인하세요.')}${v.error ? ` (${errorText(v.error)})` : ''}` })
    if (has) out.push({ kind: 'warn', text: tr('아래는 저장해 둔 마지막 정상 목록이에요 (마지막 갱신 {0}). 설치는 막혀 있어요.', when) })
  } else if (v.status === 'offline') {
    out.push(has ? { kind: 'warn', text: tr('오프라인 목록입니다 (마지막 갱신 {0}). 설치는 인터넷이 있을 때 할 수 있어요.', when) } : { kind: 'err', text: tr('지금은 목록을 받을 수 없어요') })
    if (v.error) out.push({ kind: 'info', text: errorText(v.error) })
  } else if (v.status === 'ok') {
    if (v.expired) out.push({ kind: 'warn', text: tr('목록이 오래됐어요. 새 설치는 막혀 있어요.') })
    else out.push({ kind: 'info', text: `${tr('마지막 갱신 {0}', when)} · ${tr('서명 확인됨')} ✔` })
    if (!has) out.push({ kind: 'info', text: tr('아직 올라온 팩이 없어요.') })
  }
  if (v.safeMode) out.push({ kind: 'warn', text: tr('안전 모드예요. 목록은 볼 수 있지만 모음에서 설치할 수는 없어요.') })
  if (v.dev) out.push({ kind: 'info', text: tr('개발 빌드가 시험 서버를 쓰는 중이에요.') })
  return out
}
