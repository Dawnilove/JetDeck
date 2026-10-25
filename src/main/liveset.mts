// 화면이 id를 정해 여는 실시간 채널(카메라·ROS echo/hz·Device 화면) 관리
// 채널이 열리기 전에 정지 요청이 오면(시작 직후 정지·화면 이동) 기억해 두었다가 열리자마자 닫음 → Device 쪽 프로세스가 남지 않게
export class LiveSet<C extends { close: () => void }> {
  private live = new Map<string, C>()
  private starting = new Map<string, boolean>() // id → 여는 중에 정지 요청이 왔는지

  begin(id: string): void {
    this.starting.set(id, false)
  }
  // 채널이 열림: 그 사이 정지 요청이 있었으면 바로 닫고 false
  attach(id: string, ch: C): boolean {
    const stopped = this.starting.get(id)
    this.starting.delete(id)
    if (stopped) {
      ch.close()
      return false
    }
    this.live.set(id, ch)
    return true
  }
  // 여는 데 실패함
  fail(id: string): void {
    this.starting.delete(id)
  }
  // 채널이 닫힘 (같은 id로 새 채널이 열렸으면 그대로 둠)
  remove(id: string, ch: C): void {
    if (this.live.get(id) === ch) this.live.delete(id)
  }
  stop(id: string): void {
    const ch = this.live.get(id)
    if (ch) return ch.close()
    if (this.starting.has(id)) this.starting.set(id, true)
  }
  get(id: string): C | undefined {
    return this.live.get(id)
  }
  get size(): number {
    return this.live.size + this.starting.size
  }
}
