import type { WebContents } from 'electron'
import { tr } from './i18n.mts'
import { onOwnerGone, watchOwner } from './packowner.mts'
import { BODY_MAX, dirProblem, parseBadge, UNSAFE_MARK, type BadgeResult } from './packbadgecore.mts'
import { buildBadge, fillDir } from './packrun.mts'
import { splitExit } from './packpollcore.mts'
import type { Badge } from './packschema.mts'
import { analyze } from './risk.mts'

// 탐색기 배지 실행기 (5.3.0). 탐색기가 폴더를 열 때 main이 켜진 팩의 배지 명령을 {dir}을 채워 실행하고 (기준 폴더, 경로별 배지)를 돌려줌. 폴더를 열면 저절로 도는 길이라 가장 조심함:
// ① 실행 직전에 실제 폴더를 채운 명령을 다시 분석해 읽기가 아니면 조용히 건너뜀(확인창 없음) ② 같은 기준 폴더는 ttl 안에 다시 실행하지 않음(저장소 안 하위 폴더도 같은 결과)
// ③ 연결당 한 번에 하나, 대기 중인 요청은 가장 새 것 하나만 ④ 연속 3번 시간 초과면 그 배지는 이번 접속 동안 멈춤 ⑤ 화면이 사라지면 대기 중인 요청을 버림 ⑥ 명령은 매번 끝나는 모양(timeout)이라 Device에 프로세스가 남지 않음
export const SLOW_LIMIT = 3 // 연속 시간 초과가 이만큼이면 그 연결에서 그 배지를 멈춤
const NEG_MAX = 200 // 연결당 기억하는 "해당 없음" 폴더 수
const ROOTS_MAX = 20 // 배지당 기억하는 기준 폴더 수
export type BadgeConn = { run: (command: string) => Promise<string> }
export type BadgeTarget = { packId: string; badge: Badge }
type Owner = Pick<WebContents, 'once' | 'on'>

type RootHit = { at: number; res: BadgeResult }
type ConnState = { roots: Map<string, RootHit[]>; neg: Map<string, number>; slow: Map<string, number>; off: Set<string> }
type Slot = { running: boolean; waiting?: { owner: object; job: () => Promise<BadgeResult[]>; resolve: (r: BadgeResult[] | null) => void } }
const states = new Map<string, ConnState>()
const slots = new Map<string, Slot>()
const gen = new WeakMap<object, number>() // 화면이 사라질 때마다 올림 (같은 webContents가 새로고침 뒤 다시 쓰이므로 영구 표시는 못 씀)
onOwnerGone((wc) => {
  gen.set(wc, (gen.get(wc) ?? 0) + 1)
  for (const s of slots.values()) {
    if (s.waiting?.owner !== wc) continue
    s.waiting.resolve(null)
    s.waiting = undefined
  }
})

export const dropConn = (connKey: string): void => {
  states.delete(connKey)
  const s = slots.get(connKey)
  s?.waiting?.resolve(null)
  slots.delete(connKey)
}
const stateOf = (k: string): ConnState => {
  let s = states.get(k)
  if (!s) states.set(k, (s = { roots: new Map(), neg: new Map(), slow: new Map(), off: new Set() }))
  return s
}
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root === '/' ? '/' : root + '/')

async function one(conn: BadgeConn, st: ConnState, t: BadgeTarget, dir: string, now: () => number): Promise<BadgeResult> {
  const b = t.badge
  const id = `${t.packId}/${b.id}`
  const out = (status: BadgeResult['status'], more: Partial<BadgeResult> = {}): BadgeResult => ({ packId: t.packId, badgeId: b.id, status, ...more })
  if (st.off.has(id)) return out('slow')
  const ttl = b.ttl * 1000
  const hit = st.roots.get(id)?.find((h) => now() - h.at < ttl && (h.res.exact ? dir === h.res.root : inside(dir, h.res.root!)))
  if (hit) return hit.res
  const negKey = `${id}|${dir}`
  if (now() - (st.neg.get(negKey) ?? -Infinity) < ttl) return out('none')
  if (analyze(fillDir(b.cmd, dir)).risk !== 'read') return out('skipped') // 로드 때 증명한 것은 대표 폴더 기준 — 실제 폴더(민감 경로 등)로 다시 분석
  const remember = (r: BadgeResult) => {
    if (r.status === 'ok') {
      const list = [{ at: now(), res: r }, ...(st.roots.get(id) ?? []).filter((h) => h.res.root !== r.root)].slice(0, ROOTS_MAX)
      st.roots.set(id, list)
    } else {
      st.neg.delete(negKey)
      st.neg.set(negKey, now())
      if (st.neg.size > NEG_MAX) st.neg.delete(st.neg.keys().next().value!)
    }
    return r
  }
  let raw: string
  let guard: NodeJS.Timeout | undefined
  try {
    raw = await Promise.race([conn.run(buildBadge(b, dir)), new Promise<never>((_r, rej) => (guard = setTimeout(() => rej(new Error('timeout')), (b.timeout + 5) * 1000)))])
  } catch {
    raw = '' // 연결 오류·앱 쪽 기다림 초과: 아래에서 시간 초과로 셈
  } finally {
    clearTimeout(guard)
  }
  const { body, code } = splitExit(raw.length > BODY_MAX + 64 ? raw.slice(0, BODY_MAX) + raw.slice(-64) : raw) // 거대한 출력은 앞부분만 (뒤쪽 종료 코드 표시는 남김)
  if (code === null) {
    const n = (st.slow.get(id) ?? 0) + 1
    st.slow.set(id, n)
    if (n >= SLOW_LIMIT) {
      st.off.add(id)
      return out('slow')
    }
    return out('failed')
  }
  st.slow.delete(id)
  if (code !== 0 && !body.startsWith(UNSAFE_MARK)) return remember(out('none'))
  const p = parseBadge(b, body, dir)
  if (p === 'unsafe') return remember(out('unsafe'))
  if (!p) return remember(out('none'))
  return remember(out('ok', { root: p.root, exact: b.root === 'dir' || undefined, tag: p.tag, items: p.items, truncated: p.truncated || undefined }))
}

// 연결 하나에 한 번에 하나만 실행. 이미 하나가 돌고 있으면 대기열에는 가장 새 요청 하나만 남기고 옛 요청은 null(밀려남)로 끝냄
function schedule(connKey: string, owner: object, job: () => Promise<BadgeResult[]>): Promise<BadgeResult[] | null> {
  const slot = slots.get(connKey) ?? { running: false }
  slots.set(connKey, slot)
  const start = (j: () => Promise<BadgeResult[]>): Promise<BadgeResult[] | null> => {
    slot.running = true
    return j()
      .catch(() => null)
      .finally(() => {
        slot.running = false
        const w = slot.waiting
        slot.waiting = undefined
        if (w) void start(w.job).then(w.resolve)
      })
  }
  if (!slot.running) return start(job)
  slot.waiting?.resolve(null)
  return new Promise((resolve) => (slot.waiting = { owner, job, resolve }))
}

// dir: 탐색기에서 연 폴더(절대 경로). 결과는 targets 순서. null = 새 요청에 밀렸거나 화면이 사라짐 (필요하면 다시 물을 것)
export function runBadges(wc: Owner, connKey: string, conn: BadgeConn, dir: string, targets: BadgeTarget[], now: () => number = Date.now): Promise<BadgeResult[] | null> {
  if (dirProblem(dir)) return Promise.reject(new Error(tr('올바르지 않은 폴더예요')))
  if (!targets.length) return Promise.resolve([])
  watchOwner(wc)
  const g = gen.get(wc) ?? 0
  return schedule(connKey, wc, async () => {
    const st = stateOf(connKey)
    const res: BadgeResult[] = []
    for (const t of targets) {
      if ((gen.get(wc) ?? 0) !== g) throw new Error('owner gone') // 화면이 사라짐: 남은 배지는 실행하지 않음
      res.push(await one(conn, st, t, dir, now))
    }
    return res
  })
}
