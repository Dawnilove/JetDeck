import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { dropConn, runBadges, SLOW_LIMIT, type BadgeConn } from './packbadge.mts'
import { UNSAFE_MARK } from './packbadgecore.mts'
import { validatePack, type Badge } from './packschema.mts'

// 5.3.0 배지 실행기: 가짜 연결·가짜 화면으로 재분석·캐시·한 번에 하나·시간 초과 정지·소유자 정리·위험 표시를 시험 (실제 git 실행은 packgitguard.test.mts)
const L = (s: string) => ({ ko: s, en: s })
const GIT = 'git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames'
const mk = (o: Record<string, unknown> = {}): Badge => {
  const r = validatePack({
    id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: '5.3.0', plugins: [],
    badges: [{ id: 'git', label: L('Git'), cmd: GIT, separator: 'nul', root: 'line1', tag: { match: '^## (.+?)(?:\\.\\.\\.|$)' }, match: '^(.{2}) (.+)$', code: 1, path: 2, codes: { ' M': { show: 'M', text: L('수정됨'), tone: 'warn' } }, ...o }]
  })
  assert.ok(r.pack, r.errors.join('|'))
  return r.pack!.badges![0]
}
const target = (b = mk(), packId = 'p1') => ({ packId, badge: b })
class FakeWc extends EventEmitter {}
const asWc = (w: FakeWc) => w as never
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !cond(); t += 5) await wait(5)
}
const OK = (root: string, ...recs: string[]) => `${root}\n${recs.join('\0')}\0\n__EXIT__0\n`
let seq = 0
const key = () => `c${++seq}` // 시험마다 새 연결
const conn = (script: (n: number, cmd: string) => Promise<string> | string) => {
  const calls: string[] = []
  const c: BadgeConn = { run: async (cmd) => (calls.push(cmd), script(calls.length, cmd)) }
  return { c, calls }
}

test('실행: 결과를 모으고, 명령은 {dir}을 따옴표 처리한 매번 끝나는 모양', async () => {
  const { c, calls } = conn(() => OK('/r', '## main', ' M a'))
  const res = await runBadges(asWc(new FakeWc()), key(), c, "/r/it's", [target()])
  assert.deepEqual(res?.map((x) => [x.packId, x.badgeId, x.status, x.root, x.tag]), [['p1', 'git', 'ok', '/r', 'main']])
  assert.deepEqual(Object.keys(res![0].items!), ['/r/a'])
  assert.equal(calls.length, 1)
  assert.ok(calls[0].startsWith('timeout 10 sh -c '))
  assert.ok(calls[0].includes('__EXIT__$?'))
  assert.ok(calls[0].includes('/r/it'), calls[0]) // 실제 셸에서의 따옴표 처리는 packgitguard.test.mts
})

test('실행 직전 재분석: 민감 경로 폴더는 읽기가 아니라서 조용히 건너뜀 (명령을 보내지 않음)', async () => {
  const { c, calls } = conn(() => OK('/r'))
  const res = await runBadges(asWc(new FakeWc()), key(), c, '/home/u/.ssh', [target()])
  assert.equal(res![0].status, 'skipped')
  assert.equal(calls.length, 0)
})

test('폴더 검사: 절대 경로가 아니거나 제어 문자가 있으면 거부', async () => {
  const { c, calls } = conn(() => OK('/r'))
  for (const bad of ['rel', '/a\nb', '/a\0b', '']) await assert.rejects(runBadges(asWc(new FakeWc()), key(), c, bad, [target()]))
  assert.equal(calls.length, 0)
  assert.deepEqual(await runBadges(asWc(new FakeWc()), key(), c, '/ok', []), []) // 켜진 배지가 없으면 아무것도 안 함
})

test('캐시: 같은 기준 폴더 안의 하위 폴더는 ttl 안에 다시 실행하지 않음, ttl이 지나면 다시', async () => {
  let t = 1000
  const now = () => t
  const { c, calls } = conn(() => OK('/r', ' M a'))
  const k = key()
  const wc = asWc(new FakeWc())
  const b = target(mk({ ttl: 5 }))
  await runBadges(wc, k, c, '/r', [b], now)
  const sub = await runBadges(wc, k, c, '/r/src/deep', [b], now)
  assert.equal(calls.length, 1)
  assert.equal(sub![0].status, 'ok')
  assert.equal(sub![0].root, '/r')
  t += 4999
  await runBadges(wc, k, c, '/r/src', [b], now)
  assert.equal(calls.length, 1)
  t += 2
  await runBadges(wc, k, c, '/r/src', [b], now)
  assert.equal(calls.length, 2)
  await runBadges(wc, k, c, '/r2', [b], now) // 이름이 비슷한 다른 폴더는 같은 기준이 아님
  assert.equal(calls.length, 3)
  await runBadges(wc, k, c, '/rx/y', [b], now)
  assert.equal(calls.length, 4)
})

test('해당 없음(저장소가 아님)도 같은 폴더는 ttl 안에 다시 묻지 않음, 연결이 다르면 따로', async () => {
  let t = 0
  const now = () => t
  const { c, calls } = conn(() => '__EXIT__128\n')
  const wc = asWc(new FakeWc())
  const k = key()
  const b = target(mk({ ttl: 5 }))
  assert.equal((await runBadges(wc, k, c, '/plain', [b], now))![0].status, 'none')
  assert.equal((await runBadges(wc, k, c, '/plain', [b], now))![0].status, 'none')
  assert.equal(calls.length, 1)
  await runBadges(wc, key(), c, '/plain', [b], now)
  assert.equal(calls.length, 2)
  t += 5001
  await runBadges(wc, k, c, '/plain', [b], now)
  assert.equal(calls.length, 3)
})

test('저장소 설정이 위험해서 git을 안 돌렸다는 표시는 unsafe', async () => {
  const { c } = conn(() => `${UNSAFE_MARK}\n__EXIT__1\n`)
  const res = await runBadges(asWc(new FakeWc()), key(), c, '/evil', [target()])
  assert.equal(res![0].status, 'unsafe')
  assert.equal(res![0].items, undefined)
})

test('연속 시간 초과 3번이면 그 배지는 이번 접속 동안 멈춤, 연결이 끊기면 초기화', async () => {
  let t = 0
  const now = () => (t += 10_000) // 매 호출마다 ttl이 지나도록
  const { c, calls } = conn(() => '') // 종료 코드 표시 없음 = 시간 초과
  const wc = asWc(new FakeWc())
  const k = key()
  const b = target()
  const st: string[] = []
  for (let i = 0; i < SLOW_LIMIT + 2; i++) st.push((await runBadges(wc, k, c, `/d${i}`, [b], now))![0].status)
  assert.deepEqual(st, ['failed', 'failed', 'slow', 'slow', 'slow'])
  assert.equal(calls.length, SLOW_LIMIT) // 멈춘 뒤에는 명령을 보내지 않음
  dropConn(k)
  assert.equal((await runBadges(wc, k, c, '/again', [b], now))![0].status, 'failed')
  assert.equal(calls.length, SLOW_LIMIT + 1)
})

test('시간 초과 사이에 정상 응답이 있으면 세기가 처음부터', async () => {
  let t = 0
  const now = () => (t += 10_000)
  let bad = true
  const { c } = conn(() => (bad ? '' : OK('/r')))
  const wc = asWc(new FakeWc())
  const k = key()
  const b = target()
  for (let i = 0; i < SLOW_LIMIT - 1; i++) await runBadges(wc, k, c, `/x${i}`, [b], now)
  bad = false
  assert.equal((await runBadges(wc, k, c, '/ok', [b], now))![0].status, 'ok')
  bad = true
  for (let i = 0; i < SLOW_LIMIT - 1; i++) assert.equal((await runBadges(wc, k, c, `/y${i}`, [b], now))![0].status, 'failed')
})

test('연결 오류(run이 거부)도 시간 초과처럼 실패로 세고 앱은 죽지 않음', async () => {
  const { c } = conn(() => Promise.reject(new Error('channel closed')))
  assert.equal((await runBadges(asWc(new FakeWc()), key(), c, '/x', [target()]))![0].status, 'failed')
})

test('한 번에 하나: 실행 중에 온 요청은 대기, 더 새 요청이 오면 옛 대기 요청은 null', async () => {
  const gates: (() => void)[] = []
  const order: string[] = []
  const { c } = conn((n, cmd) => new Promise((r) => (order.push(cmd), gates.push(() => r(OK('/r'))))))
  const wc = asWc(new FakeWc())
  const k = key()
  const p1 = runBadges(wc, k, c, '/a1', [target()])
  await until(() => order.length === 1)
  const p2 = runBadges(wc, k, c, '/b2', [target()])
  const p3 = runBadges(wc, k, c, '/c3', [target()])
  assert.equal(await p2, null) // p3에 밀림
  await wait(20)
  assert.equal(order.length, 1) // 아직 첫 요청만 실행 중
  gates[0]()
  assert.equal((await p1)![0].status, 'ok')
  await until(() => order.length === 2)
  assert.ok(order[1].includes('/c3'))
  gates[1]()
  assert.equal((await p3)![0].status, 'ok')
  // 다른 연결은 서로 기다리지 않음
  const p4 = runBadges(wc, key(), c, '/d4', [target()])
  await until(() => order.length === 3)
  gates[2]()
  assert.equal((await p4)![0].status, 'ok')
})

test('소유자 정리: 화면이 사라지면 대기 중인 요청은 null, 남은 배지는 실행하지 않고, 같은 화면은 새로고침 뒤 다시 쓸 수 있음', async () => {
  const gates: (() => void)[] = []
  const calls: string[] = []
  const c: BadgeConn = { run: (cmd) => new Promise((r) => (calls.push(cmd), gates.push(() => r(OK('/r'))))) }
  const wc = new FakeWc()
  const k = key()
  const two = [target(mk(), 'p1'), target(mk(), 'p2')]
  const p1 = runBadges(asWc(wc), k, c, '/a', two)
  await until(() => calls.length === 1)
  const p2 = runBadges(asWc(wc), k, c, '/b', two) // 대기 중
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }) // 화면이 새 문서로 이동 = 소유자 사라짐
  assert.equal(await p2, null)
  gates[0]()
  assert.equal(await p1, null) // 진행 중이던 요청도 첫 배지 뒤에 멈춤 (두 번째 배지는 실행 안 함)
  assert.equal(calls.length, 1)
  // 같은 webContents가 새 문서에서 다시 요청하면 정상 동작
  const { c: c2 } = conn(() => OK('/r2'))
  assert.equal((await runBadges(asWc(wc), k, c2, '/c', [target()]))![0].status, 'ok')
})

test('결과 순서는 targets 순서, 한 배지의 실패가 다른 배지를 막지 않음', async () => {
  const { c } = conn((_n, cmd) => (cmd.includes('ls -A') ? '' : OK('/r', ' M a')))
  const flaky = mk({ id: 'flaky', cmd: 'ls -A {dir}', separator: 'line', root: 'dir', tag: undefined, match: '^(.)\\s(.+)$' })
  const res = await runBadges(asWc(new FakeWc()), key(), c, '/r', [target(flaky, 'p1'), target(mk(), 'p2')])
  assert.deepEqual(res!.map((x) => [x.packId, x.badgeId, x.status]), [['p1', 'flaky', 'failed'], ['p2', 'git', 'ok']])
})

test('출력이 매우 커도 앞부분만 읽고 종료 코드는 놓치지 않음', async () => {
  const big = '/r\n ' + 'M a\0'.repeat(500_000) + '\n__EXIT__0\n'
  const { c } = conn(() => big)
  const res = await runBadges(asWc(new FakeWc()), key(), c, '/r', [target()])
  assert.equal(res![0].status, 'ok')
  assert.equal(res![0].truncated, true)
})

test('root:"dir" 배지는 연 폴더마다 따로 실행함 (하위 폴더를 캐시로 덮지 않음), root:"line1"은 기준 폴더 안을 캐시로 답함', async () => {
  const ls = mk({ id: 'ls', cmd: 'ls -1A {dir}', separator: 'line', root: 'dir', tag: undefined, match: '^(.+\.(py))$', code: 2, path: 1, codes: { py: { show: 'py', text: L('py'), tone: 'info' } } })
  const { c, calls } = conn((_n, cmd) => (cmd.includes('/r/sub') ? 'b.py\n__EXIT__0\n' : 'a.py\n__EXIT__0\n'))
  const k = key()
  const top = await runBadges(asWc(new FakeWc()), k, c, '/r', [target(ls)])
  assert.deepEqual(Object.keys(top![0].items!), ['/r/a.py'])
  assert.equal(top![0].exact, true)
  const sub = await runBadges(asWc(new FakeWc()), k, c, '/r/sub', [target(ls)])
  assert.deepEqual(Object.keys(sub![0].items!), ['/r/sub/b.py'])
  assert.equal(calls.length, 2)
  const again = await runBadges(asWc(new FakeWc()), k, c, '/r', [target(ls)]) // 같은 폴더는 ttl 안에 캐시
  assert.equal(again![0].items!['/r/a.py'].show, 'py')
  assert.equal(calls.length, 2)
})
