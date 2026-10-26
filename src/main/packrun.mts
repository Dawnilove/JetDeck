// 팩 항목을 실행할 명령으로 만들고 출력을 표시용으로 바꿈 (Electron 없이 시험)
import { resolveFields } from './packfields.mts'
import { sanitizeOutput } from './packsafe.mts'
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

// 화면이 보낸 값을 검사해서 {이름} → 명령에 끼워 넣을 글자 표로. params(고정 선택지)는 팩에 적힌 선택지 안에서만 인정하고(안 보냈으면 첫 선택지),
// fields(입력 폼, 5.1.0)는 packfields가 형식·글자를 검사하고 필요하면 작은따옴표로 감쌈. 틀린 값이면 Error
export function resolveParams(a: PackAction, given: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of a.params ?? []) {
    const v = given[p.name] ?? p.choices[0].value
    if (!p.choices.some((c) => c.value === v)) throw new Error(`선택값이 올바르지 않아요: ${p.name}`)
    out[p.name] = v
  }
  return Object.assign(out, resolveFields(a.fields, given))
}
export const fill = (cmd: string, values: Record<string, string>) => cmd.replace(/\{(\w+)\}/g, (_m, n: string) => values[n])
// 배지 명령의 {dir}: 항상 작은따옴표로 감싼 글자 하나로 (폴더 이름에 셸 글자가 있어도 명령이 되지 않음)
export const fillDir = (cmd: string, dir: string) => cmd.replace(/\{dir\}/g, () => shq(dir))

const DEFAULT_TIMEOUT = 60
// git은 저장소 설정(core.fsmonitor, 외부 diff·textconv)이 코드를 실행할 수 있어서, 명령에 git이 보이면 앱이 함수로 감싸 그 기능을 끄고 실행함 (팩 글자는 그대로, 터미널 입력 모드는 해당 없음).
// risk.mts가 git 앞 옵션을 -C·--no-pager·--no-optional-locks로만 허용하므로 그 셋만 처리하면 됨
export const GIT_GUARD = `git() { case "$1" in -C) _d=$2; shift 2; (cd "$_d" && git "$@");; --no-pager|--no-optional-locks) shift; git "$@";; diff|log|show) _s=$1; shift; command git -c core.fsmonitor=false "$_s" --no-ext-diff --no-textconv "$@";; *) command git -c core.fsmonitor=false "$@";; esac; }; unset GIT_EXTERNAL_DIFF
`
// 끝에 종료 코드를 붙여 성공·실패를 구분. { …; } 로 묶어 stderr도 함께 받음 (run()은 stderr를 버림)
const wrap = (inner: string, timeout: number, shell: 'sh' | 'bash-i' = 'sh') => `timeout ${timeout} ${shell === 'bash-i' ? 'bash -ic' : 'sh -c'} ${shq(`${/\bgit\b/.test(inner) ? GIT_GUARD : ''}{ ${inner}\n} 2>&1; echo __EXIT__$?`)}` // bash-i: ~/.bashrc 환경(ROS2)

export function buildRun(a: PackAction, values: Record<string, string>): { command: string; termCmd: string } {
  const cmd = fill(a.cmd, values)
  return { command: wrap(a.sudo ? `sudo -n ${cmd}` : cmd, a.timeout ?? DEFAULT_TIMEOUT, a.shell), termCmd: `sudo ${cmd}` }
}
export const buildPreview = (a: PackAction, values: Record<string, string>) => wrap(fill(a.preview ?? a.cmd, values), Math.min(a.timeout ?? DEFAULT_TIMEOUT, 120), a.shell) // 미리보기는 짧게

// 흐르는 출력(mode:'stream'): pty에서 그대로 실행할 명령. 최대 실행 시간은 앱이 재고(packstream) 끝나면 채널을 닫음.
// timeout 명령으로 감싸지 않는 이유: timeout은 새 프로세스 그룹을 만들어서, pty를 닫을 때 가는 SIGHUP·Ctrl-C(SIGINT)가 자식에게 안 닿을 수 있음
export const buildStream = (a: PackAction, values: Record<string, string>): string => {
  const inner = fill(a.cmd, values)
  return `${a.shell === 'bash-i' ? 'bash -ic' : 'sh -c'} ${shq(`${/\bgit\b/.test(inner) ? GIT_GUARD : ''}${inner}`)}`
}

// 그래프(display.type:'chart') 되풀이 실행에 쓰는 한 번의 명령: 매번 끝나는 모양(timeout)이고 끝에 종료 코드가 붙음. 읽기로 증명된 명령만 오도록 packschema가 거른 항목에만 씀
export const buildPoll = (a: PackAction): string => wrap(a.cmd, a.timeout ?? 10, a.shell)

// from 목록 명령 (읽기로 증명된 것): 오류 출력은 버리고 표준 출력만 받음 → 선택지로 오해될 글자가 섞이지 않게
export const buildFrom = (f: { cmd: string; shell: 'sh' | 'bash-i'; timeout: number }): string => `timeout ${f.timeout} ${f.shell === 'bash-i' ? 'bash -ic' : 'sh -c'} ${shq(f.cmd)} 2>/dev/null`

// 터미널 입력 모드(mode:'terminal'): 결과를 받지 않고 터미널에 입력할 글자. enter는 확인을 통과했을 때만 화면이 씀
export const buildTerminal = (a: PackAction, values: Record<string, string>): { text: string; enter: boolean } => ({ text: fill(a.cmd, values), enter: a.enter !== false })

export const MAX_ROWS = 500
export const MAX_LINE = 1000 // 표로 읽을 한 줄의 최대 글자 (넘으면 자름 — 정규식 시간도 묶어 둠)
// 출력을 표로: match(정규식, 묶음 = 열) 또는 split 'ws'(공백)·'tab'(탭)으로 나눔(머리말 줄 skip). 안 맞는 줄은 건너뜀. 최대 500행
export function toRows(d: Display, text: string): string[][] | undefined {
  if (d.type !== 'table') return undefined
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '').slice(0, MAX_LINE)).filter((l) => l.trim())
  let rows: string[][]
  if (d.match) {
    const re = new RegExp(d.match)
    rows = []
    for (const l of lines) {
      const m = l.match(re)
      if (m) rows.push(m.slice(1).map((x) => x ?? ''))
      if (rows.length >= MAX_ROWS) break
    }
    return rows
  }
  const n = d.columns.length
  const sep = d.split === 'tab' ? '\t' : null
  rows = []
  for (const l of lines.slice(d.skip ?? 0)) {
    const parts = sep ? l.split(sep) : l.trim().split(/\s+/)
    if (parts.length < n) continue
    rows.push([...parts.slice(0, n - 1), parts.slice(n - 1).join(sep ?? ' ')]) // 마지막 열은 남은 것 전부 (경로에 공백)
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}

export function parseResult(a: PackAction, out: string, termCmd: string): PackResult {
  const hasExit = /__EXIT__\d+/.test(out)
  const r = parseAction(out)
  r.text = sanitizeOutput(r.text) // 제어 문자·ANSI 제거, 비밀 가림, 256KB 상한 (표·글자 모두 이 글자에서 만듦)
  if (!hasExit) {
    // 종료 코드가 없음: 재부팅·종료는 연결이 끊긴 것이라 정상, 아니면 시간 초과·끊김
    return a.disconnects ? { ok: true, needPassword: false, text: r.text } : { ok: false, needPassword: false, text: r.text }
  }
  if (r.needPassword) return { ok: false, needPassword: true, text: r.text, termCmd }
  const rows = r.ok && a.display ? toRows(a.display, r.text) : undefined
  return { ok: r.ok, needPassword: false, text: r.text, rows }
}
