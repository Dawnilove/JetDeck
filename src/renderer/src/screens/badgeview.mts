// 탐색기 배지(5.3.0) 화면 쪽 순수 로직: 어떤 배지가 켜져 있는지, 어떤 폴더를 다시 물을지, 항목 옆에 무엇을 보일지. Electron·React 없이 시험 (badgeview.test.mts)
import type { BadgeItem, BadgeResult } from '../../../main/packbadgecore.mts'
import type { Catalog } from '../../../main/pack'
import type { L10n } from '../../../main/packschema.mts'

export const MAX_CHIPS = 2 // 항목 옆 칩 최대 개수 (내장 Git 표시 포함)
export const GIT_PACK = 'devtools' // 공식 Git 배지 팩: 이 팩의 git 배지가 켜져 있으면 내장 Git 표시를 건너뜀
export const GIT_BADGE = 'git'

export type BadgeMeta = { key: string; packId: string; badgeId: string; label: L10n; folderDot: boolean }
export type BadgeSet = Record<string, BadgeResult> // `${key}\0${root}` → 결과
export type Chip = BadgeItem & { key: string }

export const keyOf = (packId: string, badgeId: string) => `${packId}/${badgeId}`

// 켜진 팩의 (끄지 않은) 배지. 엔진이 실행하는 것과 같은 규칙
export function activeBadges(cat: Catalog | null): BadgeMeta[] {
  return (cat?.entries ?? []).flatMap((e) =>
    e.enabled && e.pack
      ? (e.pack.badges ?? []).filter((b) => !e.badgesOff.includes(b.id)).map((b) => ({ key: keyOf(e.id, b.id), packId: e.id, badgeId: b.id, label: b.label, folderDot: b.folderDot }))
      : []
  )
}

export const skipsBuiltinGit = (metas: BadgeMeta[]) => metas.some((m) => m.key === keyOf(GIT_PACK, GIT_BADGE))

const under = (root: string, p: string) => p === root || p.startsWith(root === '/' ? '/' : root + '/')

// 이 배지를 이 폴더에 대해 다시 물을 필요가 없는가: 이미 받은 기준 폴더 안이거나, 해당 없음으로 답받은 폴더
export function covered(set: BadgeSet, none: Set<string>, key: string, dir: string): boolean {
  if (none.has(`${key}\0${dir}`)) return true
  return Object.values(set).some((r) => r.status === 'ok' && r.root && `${r.packId}/${r.badgeId}` === key && under(r.root, dir))
}

export type Applied = { set: BadgeSet; none: Set<string>; notice?: Record<string, 'unsafe' | 'slow'> }

// 엔진 답 한 번을 상태에 반영 (set은 새 객체를 돌려줌, none은 그대로 고침)
export function applyResults(set: BadgeSet, none: Set<string>, dir: string, rs: BadgeResult[]): Applied {
  const next = { ...set }
  const notice: Record<string, 'unsafe' | 'slow'> = {}
  for (const r of rs) {
    const key = `${r.packId}/${r.badgeId}`
    if (r.status === 'ok' && r.root) next[`${key}\0${r.root}`] = r
    else if (r.status === 'none' || r.status === 'skipped') none.add(`${key}\0${dir}`)
    else if (r.status === 'unsafe' || r.status === 'slow') {
      none.add(`${key}\0${dir}`)
      notice[dir] = r.status === 'slow' || notice[dir] !== 'slow' ? r.status : 'slow'
    }
  }
  return { set: next, none, notice }
}

// 항목 하나 옆의 칩 (파일·폴더 자신의 배지). exclude: 이미 보이는 글자(내장 Git 표시)와 같은 글자는 겹쳐 보이지 않게 뺌
export function chipsFor(set: BadgeSet, path: string, exclude: string[] = []): Chip[] {
  const out: Chip[] = []
  for (const r of Object.values(set)) {
    const it = r.items?.[path]
    const key = `${r.packId}/${r.badgeId}`
    if (it && !exclude.includes(it.show) && !out.some((c) => c.show === it.show)) out.push({ ...it, key })
  }
  return out
}

// 폴더 안(하위)에 배지 항목이 있는가 (folderDot이 켜진 배지만)
export function dotFor(set: BadgeSet, metas: BadgeMeta[], dir: string): boolean {
  const prefix = dir === '/' ? '/' : dir + '/'
  return Object.values(set).some((r) => metas.find((m) => m.key === `${r.packId}/${r.badgeId}`)?.folderDot && Object.keys(r.items ?? {}).some((p) => p.startsWith(prefix)))
}

// 기준 폴더 이름 옆에 보일 tag
export function tagAt(set: BadgeSet, path: string): { tag: string; key: string } | undefined {
  for (const r of Object.values(set)) if (r.root === path && r.tag) return { tag: r.tag, key: `${r.packId}/${r.badgeId}` }
  return undefined
}
