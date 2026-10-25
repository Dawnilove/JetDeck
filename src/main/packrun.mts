// 팩 항목을 실행할 명령으로 만들고 출력을 표시용으로 바꿈 (Electron 없이 시험)
import { shq } from './shq.mts'
import type { Display, PackAction } from './packschema.mts'
import { parseAction } from './svcparse.mts'

export type PackResult = {
  ok: boolean
  needPassword: boolean
  text: string
  rows?: string[][] // 표 표시일 때
  termCmd?: string // 비밀번호가 필요하면 새 터미널에서 직접 입력할 sudo 명령
}

// 화면이 보낸 선택값을 팩에 적힌 선택지 안에서만 인정함 (안 보냈으면 첫 선택지)
export function resolveParams(a: PackAction, given: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of a.params ?? []) {
    const v = given[p.name] ?? p.choices[0].value
    if (!p.choices.some((c) => c.value === v)) throw new Error(`선택값이 올바르지 않아요: ${p.name}`)
    out[p.name] = v
  }
  return out
}
export const fill = (cmd: string, values: Record<string, string>) => cmd.replace(/\{(\w+)\}/g, (_m, n: string) => values[n])

const DEFAULT_TIMEOUT = 60
// 끝에 종료 코드를 붙여 성공·실패를 구분. { …; } 로 묶어 stderr도 함께 받음 (run()은 stderr를 버림)
const wrap = (inner: string, timeout: number) => `timeout ${timeout} sh -c ${shq(`{ ${inner}\n} 2>&1; echo __EXIT__$?`)}`

export function buildRun(a: PackAction, values: Record<string, string>): { command: string; termCmd: string } {
  const cmd = fill(a.cmd, values)
  return { command: wrap(a.sudo ? `sudo -n ${cmd}` : cmd, a.timeout ?? DEFAULT_TIMEOUT), termCmd: `sudo ${cmd}` }
}
export const buildPreview = (a: PackAction, values: Record<string, string>) => wrap(fill(a.preview ?? a.cmd, values), Math.min(a.timeout ?? DEFAULT_TIMEOUT, 120)) // 미리보기는 짧게

// 출력을 표로: match(정규식, 묶음 = 열) 또는 split 'ws'(공백으로 나눔, 머리말 줄 skip). 안 맞는 줄은 건너뜀
export function toRows(d: Display, text: string): string[][] | undefined {
  if (d.type !== 'table') return undefined
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim())
  if (d.match) {
    const re = new RegExp(d.match)
    return lines.flatMap((l) => {
      const m = l.match(re)
      return m ? [m.slice(1).map((x) => x ?? '')] : []
    })
  }
  const n = d.columns.length
  return lines.slice(d.skip ?? 0).flatMap((l) => {
    const parts = l.trim().split(/\s+/)
    if (parts.length < n) return []
    return [[...parts.slice(0, n - 1), parts.slice(n - 1).join(' ')]] // 마지막 열은 남은 것 전부 (경로에 공백)
  })
}

export function parseResult(a: PackAction, out: string, termCmd: string): PackResult {
  const hasExit = /__EXIT__\d+/.test(out)
  const r = parseAction(out)
  if (!hasExit) {
    // 종료 코드가 없음: 재부팅·종료는 연결이 끊긴 것이라 정상, 아니면 시간 초과·끊김
    return a.disconnects ? { ok: true, needPassword: false, text: r.text } : { ok: false, needPassword: false, text: r.text }
  }
  if (r.needPassword) return { ok: false, needPassword: true, text: r.text, termCmd }
  const rows = r.ok && a.display ? toRows(a.display, r.text) : undefined
  return { ok: r.ok, needPassword: false, text: r.text, rows }
}
