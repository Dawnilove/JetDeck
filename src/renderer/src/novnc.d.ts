// noVNC는 타입 정의가 없음 (쓰는 부분만 선언)
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: unknown, options?: { credentials?: { password?: string }; shared?: boolean })
    scaleViewport: boolean
    resizeSession: boolean
    sendCredentials(c: { password?: string }): void
    disconnect(): void
  }
}
