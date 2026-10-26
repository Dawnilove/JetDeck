// 선언형 팩 (4.5.0 → 5.0.0): 명령·표시 방식·확인창을 JSON 데이터로 적고, 코드는 읽어서 실행만 함. 팩 > 플러그인(화면) > 항목(버튼). Electron 없이 시험
// 위험도는 팩이 적은 값이 아니라 risk.mts가 계산한 값과의 max (내려갈 수 없음)
import { fill } from './packrun.mts'
import { analyze, destroysBlockedPath, maxRisk, type Reason, type Risk } from './risk.mts'

export type { Risk, Reason }
export type L10n = { ko: string; en: string }
export type Display =
  | { type: 'text' }
  | { type: 'table'; columns: L10n[]; match?: string; split?: 'ws' | 'tab'; skip?: number; empty?: L10n; labels?: Record<string, L10n> } // labels: 첫 열의 값을 사람이 읽는 이름으로 바꿈
export type Choice = { value: string; label: L10n }
export type Param = { name: string; label: L10n; choices: Choice[] }
export type PackAction = {
  id: string
  label: L10n
  desc?: L10n
  cmd: string // sudo는 쓰지 않음 (sudo: true면 앱이 붙임)
  risk: Risk // 실질 위험도 = max(declared, 앱 계산). 화면·실행은 이 값을 씀
  declared: Risk // 팩이 적은 값
  computed: Risk // 앱이 cmd를 분석한 값 (모든 선택지 조합 중 가장 높은 것)
  reasons: Reason[] // 앱 계산 이유 (확인창·허용 창에 앱 글자로 보여 줌)
  understated: boolean // 팩이 계산보다 낮게 적음 → ⚠ (악의 의심 신호)
  sudo?: boolean
  confirm?: L10n
  preview?: string // 실행 전에 보여 줄 읽기 전용 명령 (정리·설치 성격은 필수)
  params?: Param[]
  auto?: boolean // 화면을 열 때 바로 실행 (실질 위험도가 read일 때만, 팩당 5개)
  display?: Display
  timeout?: number // 초
  disconnects?: boolean // 실행하면 연결이 끊김 (재부팅·종료)
  mode: 'exec' | 'terminal' // terminal: 결과를 받지 않고 현재 터미널에 명령을 입력 (스니펫 방식)
  enter?: boolean // terminal에서 끝에 Enter (기본 true)
  shell: 'sh' | 'bash-i' // bash-i: ~/.bashrc 환경이 필요할 때 (ROS2)
  when?: 'jetson' // 젯슨일 때만 표시
  hidden?: 'display' | 'mode' // 이 앱이 모르는 표시·실행 방식 → 숨기고 "새 버전 앱이 필요해요"를 안내
}
export type PackPlugin = { id: string; title: L10n; desc?: L10n; icon?: string; group?: 'dev' | 'link' | 'manage' | 'media'; actions: PackAction[] }
export type Pack = {
  id: string
  format: 1
  version: string
  name: L10n
  desc?: L10n
  author?: string
  license?: string
  homepage?: string // 표시만. 앱이 접속하지 않음
  minApp?: string
  official: boolean // 앱에 동봉된 팩만 true (검증 호출 쪽이 정함, 파일 내용으로는 못 정함)
  plugins: PackPlugin[]
}
export type ValidateOptions = { official?: boolean; appVersion?: string }
export type ValidateResult = { pack: Pack | null; errors: string[]; warnings: string[] }

export const LIMITS = { fileBytes: 512 * 1024, plugins: 20, actionsPerPlugin: 50, actionsPerPack: 200, cmd: 2000, choices: 30, columns: 20, auto: 5, name: 60, desc: 300, confirm: 500, terminalLines: 20, matchLen: 200, comboMax: 500, timeoutExternal: 600, timeoutOfficial: 1800, timeoutDefault: 60 }
export const RESERVED_IDS = ['device', 'ros2', 'monitor', 'perf', 'examples', 'jetdeck', 'official', 'app', 'core', 'snippets']
// 공식 팩에서 읽기로 증명되지 않아도 읽기로 인정하는 항목 (팩id/항목id → 고정된 명령). 새 공식 항목을 추가하면 여기와 시험을 고쳐야 함 = 리뷰 강제
export const OFFICIAL_UNPROVEN_READS = new Map<string, string>([
  ['device/pwr-status', 'echo "target=$(systemctl get-default 2>/dev/null)"; echo "up=$(uptime -p)"; echo "since=$(uptime -s)"; if [ -f /var/run/reboot-required ]; then echo reboot=yes; else echo reboot=no; fi; if [ -f /run/systemd/shutdown/scheduled ]; then s=$(grep -m1 \'^USEC=\' /run/systemd/shutdown/scheduled | cut -d= -f2); echo "scheduled=$(date -d @$((s/1000000)) \'+%F %T\') $(grep -m1 \'^MODE=\' /run/systemd/shutdown/scheduled | cut -d= -f2)"; else echo scheduled=none; fi']
])

const ID = /^[a-z][a-z0-9-]{0,39}$/
const VALUE = /^[A-Za-z0-9_.@:~/+][A-Za-z0-9_.@:~/+-]*$/ // 선택지 값: 셸 특수문자 없음, 맨 앞 '-' 금지(옵션 주입 방지) → 따옴표 없이 명령에 끼워도 안전
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g // 제어 문자·BiDi·보이지 않는 글자
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

const cleanText = (s: string, multi: boolean) => {
  const t = s.replace(BAD_TEXT, '').replace(/\r\n?/g, '\n')
  return (multi ? t.replace(/[ \t]+\n/g, '\n') : t.replace(/\s+/g, ' ')).trim()
}
// 글자쌍 읽기: 공식(strict)은 {ko, en} 둘 다 필수. 외부 팩은 글자 하나 / {ko}만 / {en}만도 되고 없는 쪽은 있는 쪽을 씀. 모르는 언어 키는 무시
function loc(v: unknown, strict: boolean, max: number, multi = false): L10n | null {
  let ko: string | undefined
  let en: string | undefined
  if (typeof v === 'string' && !strict) ko = en = v
  else if (isObj(v)) {
    ko = typeof v.ko === 'string' ? v.ko : undefined
    en = typeof v.en === 'string' ? v.en : undefined
    if (strict && (ko === undefined || en === undefined)) return null
    ko ??= en
    en ??= ko
  } else return null
  ko = cleanText(ko!, multi)
  en = cleanText(en!, multi)
  if (!ko || !en || ko.length > max || en.length > max) return null
  return { ko, en }
}
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && cleanText(v, false) && cleanText(v, false).length <= max ? cleanText(v, false) : undefined)

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
// 선택지 조합 전부 (한 항목의 모든 실행 가능한 명령). 너무 많으면 null
function combos(params: Param[]): Record<string, string>[] | null {
  let out: Record<string, string>[] = [{}]
  for (const p of params) {
    out = out.flatMap((o) => p.choices.map((c) => ({ ...o, [p.name]: c.value })))
    if (out.length > LIMITS.comboMax) return null
  }
  return out
}
// 외부 팩 정규식: 길이 제한, 중첩 수량자·역참조·lookbehind 금지
const NESTED_QUANT = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]/
const BACKREF = /\\[1-9]|\\k</
const LOOKBEHIND = /\(\?<[=!]/
export function regexProblem(src: string): string | null {
  if (src.length > LIMITS.matchLen) return `match 정규식은 ${LIMITS.matchLen}자 이내예요`
  if (NESTED_QUANT.test(src)) return 'match 정규식에 중첩 수량자 (a+)+ 는 쓸 수 없어요'
  if (BACKREF.test(src)) return 'match 정규식에 역참조는 쓸 수 없어요'
  if (LOOKBEHIND.test(src)) return 'match 정규식에 lookbehind는 쓸 수 없어요'
  return null
}

type Ctx = { official: boolean; packId: string; seen: Set<string>; autoCount: { n: number } }

function checkAction(a: unknown, ctx: Ctx, warnings: string[]): { action?: PackAction; error?: string } {
  if (!isObj(a)) return { error: '항목이 객체가 아니에요' }
  const id = a.id
  if (typeof id !== 'string' || !ID.test(id)) return { error: `id가 올바르지 않아요: ${String(id).slice(0, 40)}` }
  const bad = (m: string) => ({ error: `${id}: ${m}` })
  const S = ctx.official
  if (ctx.seen.has(id)) return bad('id가 겹쳐요')
  const label = loc(a.label, S, LIMITS.name)
  if (!label) return bad(S ? 'label은 {ko, en} 둘 다 있어야 해요' : `label은 글자(또는 {ko, en})이고 ${LIMITS.name}자 이내예요`)
  if (typeof a.cmd !== 'string' || !a.cmd.trim()) return bad('cmd가 비었어요')
  if (a.cmd.length > LIMITS.cmd) return bad(`cmd는 ${LIMITS.cmd}자 이내예요`)
  if (a.risk !== 'read' && a.risk !== 'change' && a.risk !== 'danger') return bad('risk는 read·change·danger 중 하나예요')
  const declared: Risk = a.risk
  let desc: L10n | undefined
  if (a.desc !== undefined && !(desc = loc(a.desc, S, LIMITS.desc, true) ?? undefined)) return bad(`desc가 올바르지 않아요 (${LIMITS.desc}자 이내)`)
  let confirm: L10n | undefined
  if (a.confirm !== undefined && !(confirm = loc(a.confirm, S, LIMITS.confirm, true) ?? undefined)) return bad(`confirm이 올바르지 않아요 (${LIMITS.confirm}자 이내)`)
  if (a.mode !== undefined && typeof a.mode !== 'string') return bad('mode는 글자예요')
  const modeRaw = a.mode ?? 'exec'
  const mode: 'exec' | 'terminal' = modeRaw === 'terminal' ? 'terminal' : 'exec'
  let hidden: PackAction['hidden'] = modeRaw !== 'exec' && modeRaw !== 'terminal' ? 'mode' : undefined // 이 앱이 모르는 실행 방식 → 숨김
  if (a.shell !== undefined && a.shell !== 'sh' && a.shell !== 'bash-i') return bad("shell은 'sh' 또는 'bash-i'예요")
  if (a.when !== undefined && a.when !== 'jetson') return bad("when은 'jetson'만 돼요")
  if (a.enter !== undefined && typeof a.enter !== 'boolean') return bad('enter는 true/false예요')
  for (const k of ['sudo', 'auto', 'disconnects'] as const) if (a[k] !== undefined && typeof a[k] !== 'boolean') return bad(`${k}는 true/false예요`)
  const sudo = a.sudo === true
  const cmd = a.cmd
  const terminal = mode === 'terminal'
  if (terminal) {
    if (sudo) return bad('terminal 항목은 sudo 필드를 쓸 수 없어요 (명령에 직접 쓰세요)')
    if (cmd.split('\n').length > LIMITS.terminalLines) return bad(`terminal 명령은 ${LIMITS.terminalLines}줄 이내예요`)
  } else {
    if (/^\s*sudo\b/.test(cmd)) return bad('cmd에 sudo를 쓰지 마세요 (sudo: true로)')
    if (declared === 'read' && sudo) return bad('읽기 항목은 sudo를 쓸 수 없어요')
    if (sudo && /[;&|<>`$()\\\n]/.test(cmd)) return bad('sudo 명령은 파이프·리다이렉트 없는 단일 명령이어야 해요')
  }

  // 선택지(params): 값은 팩에 적힌 것만, 셸 특수문자 없음, 맨 앞 '-' 금지
  const params: Param[] = []
  if (a.params !== undefined) {
    if (!Array.isArray(a.params)) return bad('params는 배열이에요')
    for (const p of a.params) {
      if (!isObj(p) || typeof p.name !== 'string' || !/^\w+$/.test(p.name) || !Array.isArray(p.choices) || !p.choices.length || p.choices.length > LIMITS.choices) return bad('params 항목이 올바르지 않아요')
      const plabel = loc(p.label, S, LIMITS.name)
      if (!plabel) return bad('params의 label이 올바르지 않아요')
      const choices: Choice[] = []
      for (const c of p.choices) {
        const clabel = isObj(c) ? loc(c.label, S, LIMITS.name) : null
        if (!isObj(c) || typeof c.value !== 'string' || !VALUE.test(c.value) || c.value.length > 100 || !clabel) return bad(`선택지가 올바르지 않아요: ${JSON.stringify(c).slice(0, 80)}`)
        choices.push({ value: c.value, label: clabel })
      }
      params.push({ name: p.name, label: plabel, choices })
    }
  }
  if (new Set(params.map((p) => p.name)).size !== params.length) return bad('params 이름이 겹쳐요')
  let preview: string | undefined
  if (a.preview !== undefined) {
    if (typeof a.preview !== 'string' || !a.preview.trim() || a.preview.length > LIMITS.cmd) return bad('preview가 올바르지 않아요')
    preview = a.preview
  }
  const names = new Set(params.map((p) => p.name))
  for (const n of [...placeholders(cmd), ...(preview ? placeholders(preview) : [])]) if (!names.has(n)) return bad(`{${n}}에 맞는 params가 없어요`)

  // 위험도 계산: 선택지를 채운 모든 명령을 분석해서 가장 높은 값을 씀
  const all = combos(params)
  if (!all) return bad(`선택지 조합이 ${LIMITS.comboMax}개를 넘어요`)
  let computed: Risk = 'read'
  const reasons: Reason[] = []
  for (const v of all) {
    const f = fill(cmd, v)
    const r = analyze(f)
    computed = maxRisk(computed, r.risk)
    for (const x of r.reasons) if (!reasons.includes(x)) reasons.push(x)
    const blocked = destroysBlockedPath(f)
    if (blocked) return bad(`막힌 경로를 지워요: ${blocked}`)
  }
  if (preview) {
    for (const v of all) {
      const pf = fill(preview, v)
      const pr = analyze(pf)
      if (pr.risk !== 'read') return bad(`preview는 읽기 전용이어야 해요 — ${pr.reasons.join(',')}`)
    }
  }
  let risk = maxRisk(declared, computed)
  let understated = maxRisk(declared, computed) !== declared // 적힌 값이 계산보다 낮음
  if (S && declared === 'read' && computed !== 'read' && OFFICIAL_UNPROVEN_READS.get(`${ctx.packId}/${id}`) === cmd) {
    risk = 'read' // 공식 팩의 고정된 예외 (시험이 목록을 지킴)
    understated = false
  }
  if (sudo) risk = maxRisk(risk, 'change')
  if (declared !== 'read' && !confirm) return bad('change·danger 항목은 confirm 문구가 필요해요')
  if (understated) warnings.push(`${id}: 읽기라고 적혀 있지만 앱 계산은 ${computed}예요 (${reasons.join(',')})`)
  let auto = a.auto === true
  if (auto && declared !== 'read') return bad('바꾸는 항목은 auto를 쓸 수 없어요')
  if (auto && (risk !== 'read' || terminal)) auto = false // 앱 계산이 읽기가 아니거나 터미널 입력이면 자동 실행 안 함
  if (auto && ++ctx.autoCount.n > LIMITS.auto) {
    auto = false
    warnings.push(`${id}: auto는 팩당 ${LIMITS.auto}개까지라 꺼요`)
  }
  // 설치·정리·삭제 성격은 미리보기가 있어야 실행됨 (exec 모드)
  if (!terminal && risk !== 'read' && !preview && (/\b(autoremove|upgrade|dist-upgrade|purge|remove|clean|rm|rmdir|shred|truncate|dd|mkfs)\b|--vacuum-\w+/.test(cmd) || reasons.includes('delete') || reasons.includes('package') || reasons.includes('disk'))) return bad('설치·정리·삭제 항목은 preview가 필요해요')

  let display: Display | undefined
  if (a.display !== undefined && !terminal) {
    const d = a.display
    if (!isObj(d) || typeof d.type !== 'string') return bad('display가 올바르지 않아요')
    if (d.type === 'text') display = { type: 'text' }
    else if (d.type === 'table') {
      if (!Array.isArray(d.columns) || !d.columns.length || d.columns.length > LIMITS.columns) return bad('table의 columns는 {ko, en} 배열이에요')
      const columns = d.columns.map((c) => loc(c, S, LIMITS.name))
      if (columns.some((c) => !c)) return bad('table의 columns는 {ko, en} 배열이에요')
      if ((d.match === undefined) === (d.split === undefined)) return bad('table은 match 또는 split 중 하나만 써요')
      let empty: L10n | undefined
      if (d.empty !== undefined && !(empty = loc(d.empty, S, LIMITS.desc) ?? undefined)) return bad('table의 empty가 올바르지 않아요')
      let labels: Record<string, L10n> | undefined
      if (d.labels !== undefined) {
        if (!isObj(d.labels)) return bad('table의 labels는 {값: {ko, en}} 모양이에요')
        labels = Object.create(null) as Record<string, L10n>
        for (const [k, v] of Object.entries(d.labels)) {
          if (k === '__proto__') continue
          const l = loc(v, S, LIMITS.name)
          if (!l) return bad('table의 labels는 {값: {ko, en}} 모양이에요')
          labels[k] = l
        }
      }
      if (d.skip !== undefined && !(Number.isInteger(d.skip) && (d.skip as number) >= 0 && (d.skip as number) <= 100)) return bad('table의 skip은 0 이상의 정수예요')
      if (d.split !== undefined && d.split !== 'ws' && d.split !== 'tab') return bad("split은 'ws' 또는 'tab'만 돼요")
      if (d.match !== undefined) {
        if (typeof d.match !== 'string') return bad('match는 문자열이에요')
        let re: RegExp
        try {
          re = new RegExp(d.match)
        } catch {
          return bad('match 정규식이 올바르지 않아요')
        }
        if (!S) {
          const p = regexProblem(d.match)
          if (p) return bad(p)
        }
        if (new RegExp(re.source + '|').exec('')!.length - 1 !== columns.length) return bad('match의 묶음 개수와 columns 개수가 달라요')
      }
      display = { type: 'table', columns: columns as L10n[], match: d.match as string | undefined, split: d.split as 'ws' | 'tab' | undefined, skip: d.skip as number | undefined, empty, labels }
    } else hidden ??= 'display' // 모르는 표시 방식 (5.1 이후 추가될 값) → 숨김
  }
  let timeout: number | undefined
  if (a.timeout !== undefined) {
    const cap = S ? LIMITS.timeoutOfficial : LIMITS.timeoutExternal
    if (!(typeof a.timeout === 'number' && a.timeout >= 1 && a.timeout <= cap)) return bad(`timeout은 1~${cap}초예요`)
    timeout = a.timeout
  }
  ctx.seen.add(id)
  return {
    action: {
      id, label, desc, cmd, risk, declared, computed, reasons, understated,
      sudo: sudo || undefined,
      confirm, preview,
      params: params.length ? params : undefined,
      auto: auto || undefined,
      display,
      timeout,
      disconnects: a.disconnects === true || undefined,
      mode,
      enter: terminal ? a.enter !== false : undefined,
      shell: a.shell === 'bash-i' ? 'bash-i' : 'sh',
      when: a.when === 'jetson' ? 'jetson' : undefined,
      hidden
    }
  }
}

// 팩을 검사해서 올바른 항목만 남김 (잘못된 항목은 빼고 errors에 사유를 모음). 팩 형식 자체가 틀리면 pack: null
export function validatePack(raw: unknown, opts: ValidateOptions = {}): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fail = (m: string): ValidateResult => ({ pack: null, errors: [m, ...errors], warnings })
  const S = !!opts.official
  if (!isObj(raw) || raw.format !== 1) return fail('팩 형식이 올바르지 않아요 (format: 1이 필요해요)')
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return fail('팩 id가 올바르지 않아요 (소문자·숫자·- , 40자 이내)')
  if (!S && (RESERVED_IDS.includes(raw.id) || raw.id.startsWith('jetdeck-'))) return fail(`팩 id "${raw.id}"는 공식 팩 전용 이름이에요`)
  if (typeof raw.version !== 'string' || !SEMVER.test(raw.version)) return fail('version은 1.2.3 형식이어야 해요')
  const name = loc(raw.name, S, LIMITS.name)
  if (!name) return fail(S ? 'name은 {ko, en} 둘 다 있어야 해요' : `name은 글자(또는 {ko, en})이고 ${LIMITS.name}자 이내예요`)
  if (raw.minApp !== undefined && (typeof raw.minApp !== 'string' || !SEMVER.test(raw.minApp))) return fail('minApp은 1.2.3 형식이어야 해요')
  if (typeof raw.minApp === 'string' && opts.appVersion && compareSemver(raw.minApp, opts.appVersion) > 0) return fail(`이 팩은 JetDeck ${raw.minApp} 이상이 필요해요 (지금 ${opts.appVersion})`)
  let desc: L10n | undefined
  if (raw.desc !== undefined && !(desc = loc(raw.desc, S, LIMITS.desc, true) ?? undefined)) return fail('desc가 올바르지 않아요')
  if (!Array.isArray(raw.plugins)) return fail('plugins 배열이 필요해요')
  const ctx: Ctx = { official: S, packId: raw.id, seen: new Set(), autoCount: { n: 0 } }
  const plugins: PackPlugin[] = []
  const pluginIds = new Set<string>()
  let total = 0
  for (const p of raw.plugins.slice(0, LIMITS.plugins)) {
    const title = isObj(p) ? loc(p.title, S, LIMITS.name) : null
    if (!isObj(p) || typeof p.id !== 'string' || !ID.test(p.id) || !title || !Array.isArray(p.actions)) {
      errors.push('플러그인 형식이 올바르지 않아요')
      continue
    }
    if (pluginIds.has(p.id)) {
      errors.push(`${p.id}: 플러그인 id가 겹쳐요`)
      continue
    }
    pluginIds.add(p.id)
    ctx.seen = new Set() // 항목 id는 플러그인 안에서만 유일
    const actions: PackAction[] = []
    for (const a of p.actions.slice(0, LIMITS.actionsPerPlugin)) {
      if (total >= LIMITS.actionsPerPack) {
        errors.push(`${p.id}: 팩 전체 항목은 ${LIMITS.actionsPerPack}개까지예요`)
        break
      }
      const r = checkAction(a, ctx, warnings)
      if (r.action) (actions.push(r.action), total++)
      else errors.push(`${p.id}/${r.error}`)
    }
    if (p.actions.length > LIMITS.actionsPerPlugin) errors.push(`${p.id}: 플러그인당 항목은 ${LIMITS.actionsPerPlugin}개까지예요`)
    if (!actions.length) continue
    const pdesc = p.desc !== undefined ? loc(p.desc, S, LIMITS.desc, true) ?? undefined : undefined
    const icon = typeof p.icon === 'string' && /^[a-z][a-z0-9-]{0,29}$/.test(p.icon) ? p.icon : undefined
    const group = S && (p.group === 'dev' || p.group === 'link' || p.group === 'manage' || p.group === 'media') ? p.group : undefined // 막대 묶음은 공식만
    plugins.push({ id: p.id, title, desc: pdesc, icon, group, actions })
  }
  if (raw.plugins.length > LIMITS.plugins) errors.push(`플러그인은 ${LIMITS.plugins}개까지예요`)
  if (!plugins.length) return fail('쓸 수 있는 플러그인이 없어요')
  return {
    pack: {
      id: raw.id, format: 1, version: raw.version, name, desc,
      author: str(raw.author, 100), license: str(raw.license, 60), homepage: str(raw.homepage, 200), minApp: raw.minApp as string | undefined,
      official: S, plugins
    },
    errors,
    warnings
  }
}

// 허용 창·관리 화면용 요약: 위험도별 개수, 적힌 위험도가 부정확한 항목, 숨겨진 항목
export function summarizePack(p: Pack): { total: number; read: number; change: number; danger: number; understated: number; hidden: number; terminal: number } {
  const s = { total: 0, read: 0, change: 0, danger: 0, understated: 0, hidden: 0, terminal: 0 }
  for (const pl of p.plugins) for (const a of pl.actions) {
    s.total++
    s[a.risk]++
    if (a.understated) s.understated++
    if (a.hidden) s.hidden++
    if (a.mode === 'terminal') s.terminal++
  }
  return s
}
