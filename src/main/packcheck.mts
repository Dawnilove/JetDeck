// 커뮤니티 팩 제출 검사 (5.6.0): Pull Request가 바꾼 파일을 보고 모음에 올려도 되는지 자동으로 가림.
// 팩 내용을 실행하지 않고 JSON을 읽어 앱과 같은 검증기(validatePack)로 검사만 한다. 순수 로직 (파일 읽기·git은 scripts/packs-check.mjs). 설계안 §8-9
import { RESERVED_IDS, summarizePack, validatePack, type Pack } from './packschema.mts'

export type Changed = { status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X'; path: string }
export type CheckInput = {
  changed: Changed[]
  read: (path: string) => Uint8Array | null // 저장소 안 파일 내용 (없으면 null)
  existingIds: string[] // 이미 모음에 있는 팩 id (비슷한 id 사칭 방지)
  prBody: string
}
export type PackReport = { path: string; id: string; version: string; total: number; read: number; change: number; danger: number; auto: number; commands: { id: string; risk: string; cmd: string }[] }
export type CheckResult = { ok: boolean; problems: string[]; notes: string[]; reports: PackReport[] }

const DIR = 'docs/packs/files/'
const ID = /^[a-z][a-z0-9-]{2,39}$/
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const MAX_BYTES = 128 * 1024
const BAD_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/ // 제어 문자·BiDi·보이지 않는 글자 (줄바꿈·탭은 허용)
const DANGER_NOTE_MIN = 20

// 글자 차이 (바꾸기·넣기·빼기 한 번 = 1)
export function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

// PR 설명의 "Danger" 절 글자 수 (HTML 주석 제외). 절이 없으면 0
export function dangerNote(body: string): number {
  const text = body.replace(/<!--[\s\S]*?-->/g, '')
  const m = /^#{1,6}[ \t]*[^\n]*danger[^\n]*\n([\s\S]*?)(?=^#{1,6}[ \t]|$(?![\s\S]))/im.exec(text)
  return m ? m[1].replace(/\s+/g, ' ').trim().length : 0
}

function badStrings(v: unknown, at: string, out: string[], depth = 0): void {
  if (depth > 20 || out.length >= 5) return
  if (typeof v === 'string') {
    if (BAD_CHAR.test(v)) out.push(at)
  } else if (Array.isArray(v)) v.forEach((x, i) => badStrings(x, `${at}[${i}]`, out, depth + 1))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (BAD_CHAR.test(k)) out.push(`${at}.<key>`)
    badStrings(x, `${at}.${k}`, out, depth + 1)
  }
}

export function checkSubmission(inp: CheckInput): CheckResult {
  const problems: string[] = []
  const notes: string[] = []
  const reports: PackReport[] = []
  const files = inp.changed.filter((c) => c.path.startsWith(DIR))
  const others = inp.changed.filter((c) => c.path.startsWith('docs/packs/') && !c.path.startsWith(DIR))
  if (others.length) notes.push(`목록(색인) 관련 파일은 관리자가 따로 고쳐요. 이 PR에서는 검사하지 않아요: ${others.map((o) => o.path).join(', ')}`)
  if (!files.length) return { ok: true, problems, notes: [...notes, '검사할 팩 파일이 없어요'], reports }

  for (const c of files) {
    if (c.status !== 'A') problems.push(`${c.path}: 이미 올린 파일은 고치거나 지울 수 없어요 (상태 ${c.status}). 새 버전 폴더를 쓰세요`)
  }
  const added = files.filter((c) => c.status === 'A')
  if (added.length > 1) problems.push(`PR 하나에 팩 하나만 올려 주세요 (지금 ${added.length}개)`)

  const official = new Set<string>(RESERVED_IDS)
  const others2 = new Set(inp.existingIds)
  let needDanger = false
  for (const c of added) {
    const tag = c.path
    const m = /^docs\/packs\/files\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(c.path)
    if (!m || m[3] !== `${m[1]}.jdpack.json` || !ID.test(m[1]) || !SEMVER.test(m[2])) {
      problems.push(`${tag}: 경로는 docs/packs/files/<id>/<버전>/<id>.jdpack.json 이어야 해요 (id는 소문자·숫자·-, 3~40자)`)
      continue
    }
    const [, id, version] = m
    if (official.has(id) || id.startsWith('jetdeck-')) problems.push(`${tag}: "${id}"는 공식 팩 전용 이름이에요`)
    for (const o of [...official, ...others2]) if (o !== id && distance(o, id) <= 1) problems.push(`${tag}: id "${id}"가 "${o}"와 한 글자 차이라 헷갈려요. 다른 이름을 쓰세요`)
    const bytes = inp.read(c.path)
    if (!bytes) {
      problems.push(`${tag}: 파일을 읽을 수 없어요`)
      continue
    }
    if (bytes.length > MAX_BYTES) {
      problems.push(`${tag}: 파일이 ${MAX_BYTES / 1024}KB보다 커요`)
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^﻿/, ''))
    } catch {
      problems.push(`${tag}: JSON이 아니에요`)
      continue
    }
    const bad: string[] = []
    badStrings(raw, '$', bad)
    if (bad.length) problems.push(`${tag}: 제어 문자·보이지 않는 글자가 들어 있어요 (${bad.join(', ')})`)
    const v = validatePack(raw, { official: false })
    for (const e of v.errors) problems.push(`${tag}: ${e}`)
    for (const w of v.warnings) problems.push(`${tag}: 경고 — ${w}`) // 위험도를 낮게 적은 항목 포함
    const pack: Pack | null = v.pack
    if (!pack) {
      if (!v.errors.length) problems.push(`${tag}: 팩이 올바르지 않아요`)
      continue
    }
    if (pack.id !== id) problems.push(`${tag}: 팩 안의 id "${pack.id}"가 폴더 이름과 달라요`)
    if (pack.version !== version) problems.push(`${tag}: 팩 안의 version "${pack.version}"이 폴더 이름과 달라요`)
    if (!pack.license) problems.push(`${tag}: license가 필요해요`)
    if (!pack.author) problems.push(`${tag}: author가 필요해요`)
    if (!pack.desc) problems.push(`${tag}: desc가 필요해요`)
    const s = summarizePack(pack)
    if (s.understated) problems.push(`${tag}: 앱이 계산한 위험도보다 낮게 적은 항목이 ${s.understated}개 있어요`)
    if (s.hidden) problems.push(`${tag}: 이 앱이 모르는 방식의 항목이 ${s.hidden}개 있어요`)
    if (s.danger > 0) needDanger = true
    reports.push({ path: tag, id: pack.id, version: pack.version, total: s.total, read: s.read, change: s.change, danger: s.danger, auto: s.autoRun, commands: pack.plugins.flatMap((pl) => pl.actions.map((a) => ({ id: `${pl.id}/${a.id}`, risk: a.risk, cmd: a.cmd }))).concat((pack.badges ?? []).map((b) => ({ id: `badge/${b.id}`, risk: 'read', cmd: b.cmd }))) })
  }
  if (needDanger && dangerNote(inp.prBody) < DANGER_NOTE_MIN) problems.push(`위험 항목이 있어요. PR 설명의 "Danger" 절에 이유를 ${DANGER_NOTE_MIN}자 이상 적어 주세요`)
  return { ok: problems.length === 0, problems, notes, reports }
}

// 결과를 GitHub Actions 요약(마크다운)으로. 명령은 코드 블록에 넣고 안의 백틱은 바꿔서 블록을 깨지 못하게 함
export function renderSummary(r: CheckResult): string {
  const L: string[] = [`## Pack check — ${r.ok ? '✅ passed' : '❌ failed'}`, '']
  for (const p of r.problems) L.push(`- ❌ ${p.replace(/[`<>]/g, "'")}`)
  for (const n of r.notes) L.push(`- ℹ️ ${n.replace(/[`<>]/g, "'")}`)
  for (const p of r.reports) {
    L.push('', `### ${p.id} v${p.version}`.replace(/[`<>]/g, "'"), `items ${p.total}: read ${p.read} · change ${p.change} · danger ${p.danger} · runs on its own ${p.auto}`, '', '~~~~text')
    for (const c of p.commands) L.push(`[${c.risk}] ${c.id}: ${c.cmd.replace(/~{4,}/g, '~~~')}`)
    L.push('~~~~')
  }
  L.push('', '_This check only reads the file. A maintainer still reads every command before it is published._')
  return L.join('\n')
}
