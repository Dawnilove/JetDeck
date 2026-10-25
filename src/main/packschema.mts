// 선언형 팩 (4.5.0): 명령·표시 방식·확인창을 JSON 데이터로 적고, 코드는 읽어서 실행만 함. 5.0.0 플러그인 팩과 같은 형식을 쓰려고 만듦 (Electron 없이 시험)
export type L10n = { ko: string; en: string }
export type Risk = 'read' | 'change' | 'danger'
export type Display =
  | { type: 'text' }
  | { type: 'table'; columns: L10n[]; match?: string; split?: 'ws'; skip?: number; empty?: L10n; labels?: Record<string, L10n> } // labels: 첫 열의 값을 사람이 읽는 이름으로 바꿈
export type Choice = { value: string; label: L10n }
export type Param = { name: string; label: L10n; choices: Choice[] }
export type PackAction = {
  id: string
  label: L10n
  desc?: L10n
  cmd: string // sudo는 쓰지 않음 (sudo: true면 앱이 붙임)
  risk: Risk
  sudo?: boolean
  confirm?: L10n
  preview?: string // 실행 전에 보여 줄 읽기 전용 명령 (정리·설치 성격은 필수)
  params?: Param[]
  auto?: boolean // 화면을 열 때 바로 실행 (읽기만)
  display?: Display
  timeout?: number // 초
  disconnects?: boolean // 실행하면 연결이 끊김 (재부팅·종료)
}
export type PackPage = { id: string; title: L10n; desc?: L10n; actions: PackAction[] }
export type Pack = { id: string; format: 1; name: L10n; pages: PackPage[] }

const ID = /^[a-z][a-z0-9-]*$/
const VALUE = /^[A-Za-z0-9_.@:~/+-]+$/ // 선택지 값: 셸 특수문자 없음 → 따옴표 없이 명령에 끼워도 안전
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isL10n = (v: unknown): v is L10n => isObj(v) && typeof v.ko === 'string' && !!v.ko && typeof v.en === 'string' && !!v.en

// shortcut: 단어 목록 검사라 의도적인 우회는 못 막음 — 팩 작성 실수를 막는 용도. 5.0.0에서 외부 팩을 받기 전에 파서 기반으로 바꿀 것
const WRITE_WORDS = /(^|[\s;&|(`$])(sudo|su|doas|rm|rmdir|shred|unlink|truncate|mv|dd|mkfs|fdisk|parted|wipefs|mount|umount|chmod|chown|chgrp|reboot|shutdown|poweroff|halt|init|kill|pkill|killall|crontab|passwd|useradd|userdel|usermod)(?=$|[\s;&|)`])/
const OVERWRITE = /(^|[^0-9&>])>(?![>&])\s*(?!\/dev\/null\b)\S/
const SYSTEMCTL_WRITE = /systemctl\s+(?!get-default|is-|status|show|list-|cat)/
const JOURNAL_WRITE = /journalctl\b.*--(vacuum|rotate|flush|sync)/
const APT_WRITE = /(^|[\s;&|(`$])apt(-get)?(?=\s)(?![^|;&]*(\blist\b|\s-s\b|--simulate|--dry-run))/
// 정리·설치·삭제 성격: 미리보기가 있어야 실행됨
const DESTRUCTIVE = /\b(autoremove|upgrade|dist-upgrade|purge|remove|clean|rm|rmdir|shred|truncate|dd|mkfs)\b|--vacuum-\w+/
const SHELL_META = /[;&|<>`$()\\\n]/
// 지우기·덮어쓰기 명령이 가리키면 안 되는 경로
const BLOCKED = ['/', '/boot', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/dev', '/proc', '/sys', '/var', '/home', '/root', '/opt/nvidia', '/usr/local/cuda']
const FILE_DESTROYERS = /\b(rm|rmdir|shred|truncate|dd|mkfs)\b/

// 읽기 전용이어야 하는 명령(읽기 항목·미리보기)의 위반 사유, 괜찮으면 null
export function readOnlyProblem(cmd: string): string | null {
  if (WRITE_WORDS.test(cmd)) return '쓰기·삭제·전원 명령이 들어 있어요'
  if (OVERWRITE.test(cmd)) return '파일을 덮어써요'
  if (SYSTEMCTL_WRITE.test(cmd)) return 'systemctl로 상태를 바꿔요'
  if (JOURNAL_WRITE.test(cmd)) return 'journalctl로 로그를 지워요'
  if (APT_WRITE.test(cmd)) return 'apt가 시뮬레이션·list가 아니에요'
  return null
}

// 지우는 명령이 막힌 경로를 가리키는지
function blockedPath(cmd: string): string | null {
  if (!FILE_DESTROYERS.test(cmd)) return null
  for (const m of cmd.matchAll(/(^|[\s=])(\/[^\s'"]*|~[^\s'"]*)/g)) {
    const p = m[2].replace(/\/+$/, '') || '/'
    if (p === '~' || BLOCKED.some((b) => p === b || (b !== '/' && b !== '/var' && b !== '/home' && p.startsWith(b + '/')))) return p
  }
  return null
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

function checkAction(a: unknown, seen: Set<string>): { action?: PackAction; error?: string } {
  if (!isObj(a)) return { error: '항목이 객체가 아니에요' }
  const id = a.id
  if (typeof id !== 'string' || !ID.test(id)) return { error: `id가 올바르지 않아요: ${String(id)}` }
  const bad = (m: string) => ({ error: `${id}: ${m}` })
  if (seen.has(id)) return bad('id가 겹쳐요')
  if (!isL10n(a.label)) return bad('label은 {ko, en}이어야 해요')
  if (typeof a.cmd !== 'string' || !a.cmd.trim()) return bad('cmd가 비었어요')
  if (a.risk !== 'read' && a.risk !== 'change' && a.risk !== 'danger') return bad('risk는 read·change·danger 중 하나예요')
  if (a.desc !== undefined && !isL10n(a.desc)) return bad('desc는 {ko, en}이어야 해요')
  if (a.confirm !== undefined && !isL10n(a.confirm)) return bad('confirm은 {ko, en}이어야 해요')
  const sudo = a.sudo === true
  const cmd = a.cmd
  if (/^\s*sudo\b/.test(cmd)) return bad('cmd에 sudo를 쓰지 마세요 (sudo: true로)')
  if (a.risk === 'read') {
    if (sudo) return bad('읽기 항목은 sudo를 쓸 수 없어요')
    const p = readOnlyProblem(cmd)
    if (p) return bad(`읽기 항목인데 ${p}`)
    if (a.auto !== undefined && typeof a.auto !== 'boolean') return bad('auto는 true/false예요')
  } else {
    if (!isL10n(a.confirm)) return bad('change·danger 항목은 confirm 문구가 필요해요')
    if (a.auto) return bad('바꾸는 항목은 auto를 쓸 수 없어요')
  }
  if (sudo && SHELL_META.test(cmd)) return bad('sudo 명령은 파이프·리다이렉트 없는 단일 명령이어야 해요')
  let preview: string | undefined
  if (a.preview !== undefined) {
    if (typeof a.preview !== 'string' || !a.preview.trim()) return bad('preview가 비었어요')
    const p = readOnlyProblem(a.preview)
    if (p) return bad(`preview는 읽기 전용이어야 해요 — ${p}`)
    preview = a.preview
  }
  if (a.risk !== 'read' && DESTRUCTIVE.test(cmd) && !preview) return bad('설치·정리·삭제 항목은 preview가 필요해요')
  const blocked = blockedPath(cmd)
  if (blocked) return bad(`막힌 경로를 지워요: ${blocked}`)

  // 선택지(params): 값은 팩에 적힌 것만, 셸 특수문자 없음
  const params: Param[] = []
  if (a.params !== undefined) {
    if (!Array.isArray(a.params)) return bad('params는 배열이에요')
    for (const p of a.params) {
      if (!isObj(p) || typeof p.name !== 'string' || !/^\w+$/.test(p.name) || !isL10n(p.label) || !Array.isArray(p.choices) || !p.choices.length) return bad('params 항목이 올바르지 않아요')
      const choices: Choice[] = []
      for (const c of p.choices) {
        if (!isObj(c) || typeof c.value !== 'string' || !VALUE.test(c.value) || !isL10n(c.label)) return bad(`선택지가 올바르지 않아요: ${JSON.stringify(c)}`)
        choices.push({ value: c.value, label: c.label })
      }
      params.push({ name: p.name, label: p.label, choices })
    }
  }
  const names = new Set(params.map((p) => p.name))
  for (const n of [...placeholders(cmd), ...(preview ? placeholders(preview) : [])]) if (!names.has(n)) return bad(`{${n}}에 맞는 params가 없어요`)

  let display: Display | undefined
  if (a.display !== undefined) {
    const d = a.display
    if (!isObj(d)) return bad('display가 올바르지 않아요')
    if (d.type === 'text') display = { type: 'text' }
    else if (d.type === 'table') {
      if (!Array.isArray(d.columns) || !d.columns.length || !d.columns.every(isL10n)) return bad('table의 columns는 {ko, en} 배열이에요')
      if ((d.match === undefined) === (d.split === undefined)) return bad('table은 match 또는 split 중 하나만 써요')
      if (d.empty !== undefined && !isL10n(d.empty)) return bad('table의 empty는 {ko, en}이어야 해요')
      if (d.labels !== undefined && !(isObj(d.labels) && Object.values(d.labels).every(isL10n))) return bad('table의 labels는 {값: {ko, en}} 모양이에요')
      if (d.skip !== undefined && !(Number.isInteger(d.skip) && (d.skip as number) >= 0)) return bad('table의 skip은 0 이상의 정수예요')
      if (d.split !== undefined && d.split !== 'ws') return bad("split은 'ws'만 돼요")
      if (typeof d.match === 'string') {
        let re: RegExp
        try {
          re = new RegExp(d.match)
        } catch {
          return bad('match 정규식이 올바르지 않아요')
        }
        if (new RegExp(re.source + '|').exec('')!.length - 1 !== d.columns.length) return bad('match의 묶음 개수와 columns 개수가 달라요')
      } else if (d.match !== undefined) return bad('match는 문자열이에요')
      display = { type: 'table', columns: d.columns as L10n[], match: d.match as string | undefined, split: d.split as 'ws' | undefined, skip: d.skip as number | undefined, empty: d.empty as L10n | undefined, labels: d.labels as Record<string, L10n> | undefined }
    } else return bad('display.type은 text·table 중 하나예요')
  }
  let timeout: number | undefined
  if (a.timeout !== undefined) {
    if (!(typeof a.timeout === 'number' && a.timeout >= 1 && a.timeout <= 1800)) return bad('timeout은 1~1800초예요')
    timeout = a.timeout
  }
  seen.add(id)
  return {
    action: {
      id,
      label: a.label,
      desc: a.desc as L10n | undefined,
      cmd,
      risk: a.risk,
      sudo: sudo || undefined,
      confirm: a.confirm as L10n | undefined,
      preview,
      params: params.length ? params : undefined,
      auto: a.auto === true || undefined,
      display,
      timeout,
      disconnects: a.disconnects === true || undefined
    }
  }
}

// 팩을 검사해서 올바른 항목만 남김 (잘못된 항목은 빼고 errors에 사유를 모음)
export function validatePack(raw: unknown): { pack: Pack | null; errors: string[] } {
  const errors: string[] = []
  if (!isObj(raw) || raw.format !== 1 || typeof raw.id !== 'string' || !ID.test(raw.id) || !isL10n(raw.name) || !Array.isArray(raw.pages)) return { pack: null, errors: ['팩 형식이 올바르지 않아요'] }
  const seen = new Set<string>() // 항목 id는 팩 전체에서 하나 (화면이 id만 보내므로)
  const pages: PackPage[] = []
  for (const p of raw.pages) {
    if (!isObj(p) || typeof p.id !== 'string' || !ID.test(p.id) || !isL10n(p.title) || !Array.isArray(p.actions)) {
      errors.push('페이지 형식이 올바르지 않아요')
      continue
    }
    const actions: PackAction[] = []
    for (const a of p.actions) {
      const r = checkAction(a, seen)
      if (r.action) actions.push(r.action)
      else errors.push(`${p.id}/${r.error}`)
    }
    if (actions.length) pages.push({ id: p.id, title: p.title, desc: isL10n(p.desc) ? p.desc : undefined, actions })
  }
  return { pack: pages.length ? { id: raw.id, format: 1, name: raw.name, pages } : null, errors }
}
