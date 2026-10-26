import type { WebContents } from 'electron'

// 화면(webContents)이 사라지면 그 화면이 시작한 Device 일을 모두 끝내기 위한 소유자 추적 (5.1.0 packstream에서 뽑아냄, 5.2.0 packpoll이 같이 씀).
// 사라짐 = 닫힘(destroyed) · 렌더러 죽음 · 메인 프레임 새 이동(새로고침·다른 주소). 같은 문서 안 이동·하위 프레임 이동은 해당 없음.
// 쓰는 모듈은 onOwnerGone(자기 정리 함수)를 한 번 등록하고, 일을 시작할 때 watchOwner(wc)를 부름. Electron 없이 시험 (packowner.test.mts)
type Cleanup = (wc: object) => void
const cleanups = new Set<Cleanup>()
const hooked = new WeakSet<object>()

export const onOwnerGone = (fn: Cleanup): void => void cleanups.add(fn)

export function watchOwner(wc: Pick<WebContents, 'once' | 'on'>): void {
  if (hooked.has(wc)) return
  hooked.add(wc)
  const stop = () => cleanups.forEach((fn) => fn(wc))
  wc.once('destroyed', stop)
  wc.on('render-process-gone', stop)
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) stop()
  })
}
