// 팩 그래프 되풀이 실행(5.2.0)의 순수 부분: 출력 읽기(파서 3종), 간격 조절, 연속 실패 세기. Electron 없이 시험 (packpollcore.test.mts)
// 출력은 Device가 정하므로 믿지 않음: sanitizeOutput → 1000줄·줄 1000자까지만 → 유한한 수(|값|≤1e9)만 받음
import { sanitizeOutput, MAX_OUTPUT } from './packsafe.mts'
import { LIMITS, type ChartDisplay, type L10n } from './packschema.mts'

export const POLL_FAIL_LIMIT = 5 // 연속 실패가 이만큼이면 자동 정지
export const POLL_EVERY_MAX = 60 // 느려져서 늘린 간격의 상한(초)
export type Sample = { key: string; label: L10n; value: number } // key: 같은 선을 이어 주는 식별자 (선 이름 글자가 아님)
export type PollEndReason = 'stopped' | 'closed' | 'failures'

const MARK = '__EXIT__'
// packrun의 wrap이 끝에 붙이는 종료 코드를 떼어냄. 표시가 없으면 code는 null (시간 초과·연결 끊김)
export function splitExit(raw: string): { body: string; code: number | null } {
  const i = raw.lastIndexOf(MARK)
  if (i < 0) return { body: raw, code: null }
  const m = /^(\d+)\s*$/.exec(raw.slice(i + MARK.length))
  return m ? { body: raw.slice(0, i), code: Number(m[1]) } : { body: raw, code: null }
}

// 파싱할 줄: sanitize(제어 문자·ANSI·비밀 가림) 뒤 앞에서 1000줄, 줄마다 1000자까지, 빈 줄 제외
export function readLines(raw: string): string[] {
  const t = sanitizeOutput(raw.length > MAX_OUTPUT ? raw.slice(0, MAX_OUTPUT) : raw)
  return t.split('\n').slice(0, LIMITS.chartReadLines).map((l) => l.slice(0, LIMITS.chartReadLineChars)).filter((l) => l.trim())
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
// 숫자 글자만 받음 (빈 글자·0x10·1_000·NaN·Infinity 거부). 곱한 뒤에도 유한하고 |값| ≤ 1e9
function num(s: string | undefined, scale: number): number | null {
  const t = s?.trim()
  if (!t || !NUM.test(t)) return null
  const v = Number(t) * scale
  return Number.isFinite(v) && Math.abs(v) <= LIMITS.chartValueMax ? v : null
}

const LABEL_VALUE = /^[A-Za-z0-9_.-]{1,20}$/ // 선 이름 글자 틀 {n}에 끼울 수 있는 값
const SLOT = /\{(\d+)\}/g
const fillLabel = (t: string, m: RegExpMatchArray): string | null => {
  let bad = false
  const out = t.replace(SLOT, (_x, n: string) => {
    const g = m[Number(n)]
    if (g === undefined || !LABEL_VALUE.test(g)) bad = true
    return g ?? ''
  })
  return bad ? null : out
}

const cache = new WeakMap<ChartDisplay, RegExp>()
const regexOf = (d: ChartDisplay): RegExp => {
  let re = cache.get(d)
  if (!re) cache.set(d, (re = new RegExp(d.match!)))
  return re
}

// 출력(줄 목록)에서 이번 점들을 읽음. 못 읽은 선은 그냥 빠짐
export function parseChart(d: ChartDisplay, lines: string[]): Sample[] {
  const out: Sample[] = []
  if (d.match !== undefined) {
    const re = regexOf(d)
    if (d.perLine) {
      const p = d.perLine
      const seen = new Set<string>()
      for (const l of lines) {
        const m = l.match(re)
        if (!m) continue
        const value = num(m[p.value], p.scale)
        const ko = fillLabel(p.label.ko, m)
        const en = fillLabel(p.label.en, m)
        if (value === null || ko === null || en === null) continue
        let key = m.slice(1).filter((_g, i) => i + 1 !== p.value).join('|') || 'line'
        for (let n = 2; seen.has(key); n++) key = `${key.replace(/#\d+$/, '')}#${n}` // 이름이 같은 줄이 여럿이면 번호를 붙여 따로 그림
        if (seen.size >= LIMITS.chartLines) break
        seen.add(key)
        out.push({ key, label: { ko, en }, value })
      }
    } else {
      const first = new Map<string, string>() // 이름표 → 첫 값 (같은 이름이 또 나오면 처음 것)
      for (const l of lines) {
        const m = l.match(re)
        if (m && m[1] !== undefined && !first.has(m[1])) first.set(m[1], m[2])
      }
      d.series!.forEach((s, i) => {
        const value = first.has(s.key!) ? num(first.get(s.key!), s.scale) : null
        if (value !== null) out.push({ key: `s${i}`, label: s.label, value })
      })
    }
    return out
  }
  // split: 건너뛴 뒤 첫 데이터 줄을 칸으로 나눔
  const line = lines[d.skip ?? 0]
  if (line === undefined) return out
  const cells = (d.split === 'tab' ? line.split('\t') : d.split === 'csv' ? line.split(',') : line.trim().split(/\s+/)).map((c) => c.trim())
  d.series!.forEach((s, i) => {
    const value = num(cells[s.col! - 1], s.scale)
    if (value !== null) out.push({ key: `s${i}`, label: s.label, value })
  })
  return out
}

// 간격 조절: 한 번 실행 시간이 현재 간격의 절반을 넘으면 두 배(최대 60초), 간격의 1/4 이하로 빨라지면 반으로 되돌림(기본 간격까지). 기준 간격이 60초 이상이면 그대로
export class Pacer {
  base: number
  cur: number
  constructor(base: number) {
    this.base = base
    this.cur = base
  }
  record(durMs: number): void {
    if (durMs > (this.cur * 1000) / 2) this.cur = Math.max(this.cur, Math.min(this.cur * 2, POLL_EVERY_MAX))
    else if (this.cur > this.base && durMs <= (this.cur * 1000) / 4) this.cur = Math.max(this.base, this.cur / 2)
  }
}

// 연속 실패 세기: 성공하면 0으로. 한도에 닿으면 true
export class FailCounter {
  n = 0
  fail(): boolean {
    return ++this.n >= POLL_FAIL_LIMIT
  }
  ok(): void {
    this.n = 0
  }
}

// 읽기 실패 이유로 보여 줄 마지막 줄 (출력 마지막 비어 있지 않은 줄, 200자)
export const lastLine = (lines: string[]): string => (lines.length ? lines[lines.length - 1].slice(0, 200) : '')
