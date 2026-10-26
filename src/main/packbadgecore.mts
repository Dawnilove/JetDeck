// 탐색기 배지 실행 결과 읽기 (5.3.0)의 순수 부분: 폴더 검사, 출력 → (기준 폴더, 태그, 경로별 배지). Electron 없이 시험 (packbadgecore.test.mts)
// 출력은 Device가 정하므로 믿지 않음: 레코드 5000개·레코드당 4096자까지, 제어 문자 제거, 팩이 codes에 적은 코드만 표시, 경로는 기준 폴더 아래의 `..` 없는 상대 경로만
import { UNSAFE_MARK } from './packrun.mts'
import { cleanText } from './packsafe.mts'
import { LIMITS, type Badge, type BadgeTone, type L10n } from './packschema.mts'

export { UNSAFE_MARK }
export type BadgeItem = { show: string; tone: BadgeTone; text: L10n }
export type BadgeStatus = 'ok' | 'none' | 'skipped' | 'unsafe' | 'slow' | 'failed'
// ok: 기준 폴더(root)를 알아냄(items가 비어 있어도 깨끗한 저장소). none: 해당 없음(저장소가 아님 등). skipped: 이번 폴더로는 읽기가 아니라서 실행 안 함(조용히).
// unsafe: 저장소 설정이 위험해서 실행 안 함. slow: 연속 시간 초과로 이번 접속 동안 멈춤. failed: 이번 한 번 실패(곧 다시 시도 가능)
export type BadgeResult = { packId: string; badgeId: string; status: BadgeStatus; root?: string; exact?: boolean; tag?: string; items?: Record<string, BadgeItem>; truncated?: boolean }
export type BadgeParsed = { root: string; tag?: string; items: Record<string, BadgeItem>; truncated: boolean }

export const BODY_MAX = 1024 * 1024 // 이보다 긴 출력은 잘라서 읽음 (truncated)
const CTRL = /[\u0000-\u001f\u007f-\u009f]/

// 탐색기가 보낸 폴더: 절대 경로, 제어 문자(NUL·줄바꿈 포함) 없음, 1024자 이내. null이면 괜찮음
export function dirProblem(dir: unknown): string | null {
  if (typeof dir !== 'string' || !dir.startsWith('/')) return '절대 경로가 아니에요'
  if (dir.length > LIMITS.badgeDir || CTRL.test(dir)) return '올바르지 않은 폴더예요'
  return null
}

const cache = new WeakMap<Badge, { match: RegExp; tag?: RegExp }>()
const regexes = (b: Badge) => {
  let r = cache.get(b)
  if (!r) cache.set(b, (r = { match: new RegExp(b.match), tag: b.tag ? new RegExp(b.tag) : undefined }))
  return r
}

// 상대 경로를 기준 폴더 아래의 절대 경로로. 빈 조각·`.`·`..`·절대 경로·제어 문자·긴 경로는 버림(null). 끝의 `/`(추적 안 된 폴더)는 뗌
function join(root: string, rel: string): string | null {
  const r = rel.endsWith('/') ? rel.slice(0, -1) : rel
  if (!r || r.length > LIMITS.badgeLineChars || r.startsWith('/') || CTRL.test(r)) return null
  if (r.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  return (root === '/' ? '' : root) + '/' + r
}

// body: 종료 코드 표시를 뗀 출력. 읽을 수 없으면 null, 저장소 설정이 위험해 실행하지 않았으면 'unsafe'
export function parseBadge(b: Badge, body: string, dir: string): BadgeParsed | 'unsafe' | null {
  if (body === UNSAFE_MARK || body.startsWith(UNSAFE_MARK + '\n')) return 'unsafe'
  let truncated = body.length > BODY_MAX
  let text = truncated ? body.slice(0, BODY_MAX) : body
  let root = dir
  if (b.root === 'line1') {
    const nl = text.indexOf('\n')
    if (nl < 0) return null
    root = text.slice(0, nl).replace(/\r$/, '')
    if (dirProblem(root)) return null
    text = text.slice(nl + 1)
  }
  const { match, tag: tagRe } = regexes(b)
  let records = text.split(b.separator === 'nul' ? '\0' : '\n')
  if (records.length > LIMITS.badgeRecords) {
    records = records.slice(0, LIMITS.badgeRecords)
    truncated = true
  }
  const items: Record<string, BadgeItem> = {}
  let tag: string | undefined
  for (const raw of records) {
    if (raw.length > LIMITS.badgeLineChars) continue // 너무 긴 레코드는 잘라서 읽지 않고 버림 (잘린 경로가 다른 파일을 가리키지 않게)
    const rec = cleanText(raw).replace(/\n$/, '')
    if (!rec) continue
    if (tagRe) {
      const t = rec.match(tagRe)
      if (t) {
        tag ??= t[1]?.slice(0, LIMITS.badgeTag) || undefined // 맞는 첫 레코드만 쓰고, 맞는 레코드는 모두 배지 목록에서 뺌
        continue
      }
    }
    const m = rec.match(match)
    if (!m) continue
    const c = b.codes[m[b.code]]
    if (!c) continue // 팩이 적은 코드만 표시
    const abs = join(root, m[b.path] ?? '')
    if (abs && !(abs in items)) items[abs] = { show: c.show, tone: c.tone, text: c.text }
  }
  return { root, tag, items, truncated }
}
