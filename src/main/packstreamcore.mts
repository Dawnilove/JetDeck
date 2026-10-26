// 팩 흐르는 출력(5.1.0)의 순수 부분: 줄 모으기·정리, 속도·총량 감시, 화면에 보낼 묶음 만들기. Electron 없이 시험 (packstreamcore.test.mts)
import { sanitizeOutput } from './packsafe.mts'

export const STREAM_LIMITS = {
  line: 2000, // 한 줄 최대 글자 (넘으면 자르고 …)
  partialBytes: 4096, // 줄바꿈 없이 이만큼 쌓이면 한 줄로 내보냄
  partialIdleMs: 400, // 줄바꿈 없이 이만큼 조용하면 남은 조각을 한 줄로 내보냄
  batchMs: 200, // 화면에 묶어서 보내는 간격
  batchBytes: 64 * 1024, // 한 번에 보내는 최대 크기 (넘으면 오래된 줄부터 버림)
  rateBytesPerSec: 1024 * 1024, // 5초 평균이 이를 넘으면 자동 정지
  rateWindowMs: 5000,
  totalBytes: 20 * 1024 * 1024, // 한 번 실행의 총량 상한
  perPack: 2, // 팩당 동시 스트림
  perApp: 4, // 앱 전체 동시 스트림
  stopGraceMs: 3000 // Ctrl-C 뒤 이 시간 안에 안 끝나면 채널을 닫음
}

const cleanLine = (l: string): string => sanitizeOutput(l.length > STREAM_LIMITS.line ? l.slice(0, STREAM_LIMITS.line) + '…' : l)

// 받은 글자를 줄로 나눔. \r\n·\r·\n 모두 줄바꿈 (진행 막대의 \r 도 줄). 줄마다 제어 문자·ANSI 제거 + 비밀 가림 + 길이 자르기
export class LineAssembler {
  private rest = ''
  private lastCr = false // 지난 조각이 \r 로 끝남 (\r\n 이 조각 사이에 갈린 경우 빈 줄이 생기지 않게)
  private lastAt = 0
  push(text: string, now = Date.now()): string[] {
    let t = text
    if (this.lastCr && t.startsWith('\n')) t = t.slice(1)
    if (t.length) this.lastCr = t.endsWith('\r')
    this.lastAt = now
    const parts = (this.rest + t).split(/\r\n|\r|\n/)
    this.rest = parts.pop() ?? ''
    const out = parts.map(cleanLine)
    if (this.rest.length >= STREAM_LIMITS.partialBytes) {
      out.push(cleanLine(this.rest))
      this.rest = ''
    }
    return out
  }
  // 줄바꿈 없이 조용한 조각을 내보냄 (타이머가 부름). force면 지금 남은 것을 모두
  flush(now = Date.now(), force = false): string[] {
    if (!this.rest || (!force && now - this.lastAt < STREAM_LIMITS.partialIdleMs)) return []
    const l = cleanLine(this.rest)
    this.rest = ''
    return [l]
  }
}

// 속도·총량 감시: 5초 창의 합이 한도를 넘으면 'rate', 전체가 상한을 넘으면 'total'
export class Throttle {
  private win: [number, number][] = []
  private sum = 0
  total = 0
  add(bytes: number, now = Date.now()): 'ok' | 'rate' | 'total' {
    this.total += bytes
    this.win.push([now, bytes])
    this.sum += bytes
    while (this.win.length && now - this.win[0][0] > STREAM_LIMITS.rateWindowMs) this.sum -= this.win.shift()![1]
    if (this.total > STREAM_LIMITS.totalBytes) return 'total'
    return this.sum > STREAM_LIMITS.rateBytesPerSec * (STREAM_LIMITS.rateWindowMs / 1000) ? 'rate' : 'ok'
  }
}

// 화면에 보낼 줄 모으기: 묶음이 커지면 오래된 줄부터 버리고 개수를 셈
export class Batcher {
  private lines: string[] = []
  private bytes = 0
  private skipped = 0
  add(ls: string[]): void {
    for (const l of ls) {
      this.lines.push(l)
      this.bytes += l.length + 1
    }
    while (this.bytes > STREAM_LIMITS.batchBytes && this.lines.length > 1) {
      this.bytes -= this.lines.shift()!.length + 1
      this.skipped++
    }
  }
  take(): { lines: string[]; skipped: number } | null {
    if (!this.lines.length && !this.skipped) return null
    const r = { lines: this.lines, skipped: this.skipped }
    this.lines = []
    this.bytes = 0
    this.skipped = 0
    return r
  }
}

export type EndReason = 'stopped' | 'timeout' | 'closed' | 'rate' | 'total' | 'exit'
