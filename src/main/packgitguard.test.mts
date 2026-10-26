import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseBadge, UNSAFE_MARK } from './packbadgecore.mts'
import { splitExit } from './packpollcore.mts'
import { buildBadge, buildRun } from './packrun.mts'
import { validatePack, type Badge, type PackAction } from './packschema.mts'

// 5.3.0 출시 차단 조건: 악성 .git 설정이 있는 폴더에서 Git 배지를 돌려도 코드가 실행되지 않아야 함.
// 진짜 sh·git으로 임시 폴더에 가짜 악성 저장소를 만들어 확인하고(표식 파일이 생기면 실패), 같은 저장소에 옛 GIT_GUARD를 쓰면 표식이 생기는 것으로 시험이 실제로 공격을 재현하는지 확인한다. sh·git·timeout이 없으면 건너뜀
const L = (s: string) => ({ ko: s, en: s })
const GIT = 'git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames'
const badge: Badge = validatePack({
  id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: '5.3.0', plugins: [],
  badges: [{ id: 'git', label: L('Git'), cmd: GIT, separator: 'nul', root: 'line1', tag: { match: '^## (.+?)(?:\\.\\.\\.|$)' }, match: '^(.{2}) (.+)$', code: 1, path: 2, codes: { ' M': { show: 'M', text: L('수정됨'), tone: 'warn' }, '??': { show: 'U', text: L('새 파일'), tone: 'info' } } }]
}).pack!.badges![0]
const A = (o: Partial<PackAction>): PackAction => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', declared: 'read', computed: 'read', reasons: [], understated: false, mode: 'exec', shell: 'sh', ...o })

let usable = true
try {
  execSync('sh -c "command -v timeout >/dev/null && command -v git >/dev/null && touch -d 2001-01-01 /dev/null 2>/dev/null; command -v git"', { stdio: 'ignore' })
} catch {
  usable = false
}
const posix = (p: string) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_m, d: string) => '/' + d.toLowerCase()).replace(/\\/g, '/') : p)

const W = usable ? mkdtempSync(join(tmpdir(), 'badgeguard-')) : ''
const P = posix(W)
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: P + '/gitconfig', HOME: W }
const sh = (script: string, cwd = W) => execFileSync('sh', ['-c', script], { env, cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
// 파일 하나(a.txt)가 stat만 달라 보이게 해 둔 저장소 + 모든 파일에 filter=x 속성. 설정은 extra에서
const mkRepo = (name: string, extra = '') => sh(`rm -rf '${P}/${name}' && mkdir '${P}/${name}' && cd '${P}/${name}' && git init -q . 2>/dev/null && git config user.email a@b.c && git config user.name t && printf 'hello\\n' > a.txt && printf '* filter=x\\n' > .gitattributes && git add . 2>/dev/null && git commit -qm init 2>/dev/null; cd '${P}/${name}' && ${extra ? extra + ' &&' : ''} touch -d 2001-01-01 a.txt && touch a.txt`)
const mark = (n: string) => join(W, 'MARK_' + n)
const fixRoot = (r: { body: string; code: number | null }) => ({ ...r, body: r.body.replace(/^([A-Za-z]):\//, (_m, d: string) => '/' + d.toLowerCase() + '/') }) // Windows의 git은 최상위를 C:/… 로 찍음 (Linux에서는 그대로)
const exec = (dir: string, b: Badge = badge, e = env) => fixRoot(splitExit(execSync(buildBadge(b, dir), { shell: 'sh', env: e, cwd: W, stdio: ['ignore', 'pipe', 'ignore'] }).toString()))
const runBadge = (name: string, b: Badge = badge) => exec(`${P}/${name}`, b)
const touchCmd = (n: string) => `touch '${P}/MARK_${n}'`

test('악성 .git 설정: filter.clean · include로 숨긴 필터 · worktree 설정은 git을 돌리기 전에 막고 unsafe', { skip: !usable }, () => {
  mkRepo('f1', `git config filter.x.clean "${touchCmd('f1')}; cat"`)
  const r1 = runBadge('f1')
  assert.equal(existsSync(mark('f1')), false)
  assert.equal(r1.body.trim(), UNSAFE_MARK)
  assert.equal(parseBadge(badge, r1.body, `${P}/f1`), 'unsafe')

  writeFileSync(join(W, 'evil.cfg'), `[filter "x"]\n\tclean = ${touchCmd('f2')}; cat\n`)
  mkRepo('f2', `git config include.path '${P}/evil.cfg'`)
  assert.equal(runBadge('f2').body.trim(), UNSAFE_MARK)
  assert.equal(existsSync(mark('f2')), false)

  mkRepo('f3', `git config filter.x.process "${touchCmd('f3')}"`)
  assert.equal(runBadge('f3').body.trim(), UNSAFE_MARK)
  assert.equal(existsSync(mark('f3')), false)

  mkRepo('f4', `git config extensions.worktreeConfig true && printf '[filter "x"]\\n\\tclean = ${touchCmd('f4')}; cat\\n' > .git/config.worktree`)
  assert.equal(runBadge('f4').body.trim(), UNSAFE_MARK)
  assert.equal(existsSync(mark('f4')), false)
})

test('악성 .git 설정: fsmonitor · post-index-change 훅 · 서브모듈 안 필터는 실행되지 않고 배지는 정상', { skip: !usable }, () => {
  mkRepo('m1', `git config core.fsmonitor "${touchCmd('m1')}; echo"`)
  const r1 = runBadge('m1')
  assert.equal(existsSync(mark('m1')), false)
  assert.equal(r1.code, 0)

  mkRepo('m2', `printf '#!/bin/sh\\n${touchCmd('m2')}\\n' > .git/hooks/post-index-change && chmod +x .git/hooks/post-index-change`)
  const r2 = runBadge('m2')
  assert.equal(existsSync(mark('m2')), false)
  assert.equal(r2.code, 0)

  mkRepo('sub')
  mkRepo('m3', `git -c protocol.file.allow=always submodule add -q '${P}/sub' sm 2>/dev/null; git commit -qm sm 2>/dev/null; git -C sm config filter.x.clean "${touchCmd('m3')}; cat"; touch -d 2001-01-01 sm/a.txt; touch sm/a.txt`)
  const r3 = runBadge('m3')
  assert.equal(existsSync(mark('m3')), false)
  assert.equal(r3.code, 0)
})

test('통제: 같은 악성 저장소에 옛 GIT_GUARD(git status)를 쓰면 표식이 생김 → 위 시험은 실제 공격을 재현함', { skip: !usable }, () => {
  mkRepo('c1', `git config filter.x.clean "${touchCmd('c1')}; cat"`)
  execSync(buildRun(A({ cmd: `git -C '${P}/c1' status --porcelain` }), {}).command, { shell: 'sh', env, cwd: W, stdio: 'ignore' })
  assert.equal(existsSync(mark('c1')), true, '이 환경에서 filter.clean이 실행되지 않으면 위 시험은 아무것도 증명하지 못함')
})

test('정상 저장소: 브랜치 태그와 변경·새 파일 배지가 읽힘 (옵션이 붙어도 출력 모양은 그대로)', { skip: !usable }, () => {
  mkRepo('ok1', `printf 'x\\n' > new.txt && printf 'changed\\n' > a.txt && git config --unset-all filter.x.clean; printf '' > .gitattributes`)
  const r = runBadge('ok1')
  assert.equal(r.code, 0)
  const p = parseBadge(badge, r.body, `${P}/ok1`)
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.root, `${P}/ok1`)
  assert.equal(typeof p.tag, 'string')
  assert.equal(p.items[`${P}/ok1/a.txt`]?.show, 'M')
  assert.equal(p.items[`${P}/ok1/new.txt`]?.show, 'U')
  assert.equal(runBadge('ok1', badge).body.includes(UNSAFE_MARK), false)
  // 저장소가 아닌 폴더: 종료 코드 0이 아니고 읽을 것이 없음
  sh(`rm -rf '${P}/plain' && mkdir '${P}/plain'`)
  const np = runBadge('plain')
  assert.notEqual(np.code, 0)
  assert.equal(parseBadge(badge, np.body, `${P}/plain`), null)
})

test('폴더 이름의 셸 글자는 명령이 되지 않음 ($( ), 작은따옴표, 공백)', { skip: !usable }, () => {
  const name = "we'ird $(touch MARK_d1) `touch MARK_d1` ; touch MARK_d1 dir" // 어느 폴더에서 실행되든 표식이 생기면 아래에서 잡힘
  const native = join(W, name)
  mkdirSync(native)
  execFileSync('git', ['init', '-q', '.'], { cwd: native, env, stdio: 'ignore' })
  writeFileSync(join(native, 'n.txt'), 'x')
  const dir = `${P}/${name}`
  const out = exec(dir)
  assert.equal(existsSync(mark('d1')), false)
  assert.equal(existsSync(join(native, 'MARK_d1')), false)
  assert.equal(out.code, 0)
  const p = parseBadge(badge, out.body, dir)
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.items[`${dir}/n.txt`]?.show, 'U')
})

test('git config가 실패하면(옛 git·알 수 없는 오류) 닫힘: git을 돌리지 않고 unsafe. 정상이면 안전 옵션이 붙고 GIT_OPTIONAL_LOCKS=0', { skip: !usable }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'fakegit-'))
  const fake = (configExit: number) => {
    writeFileSync(join(bin, 'git'), ['#!/bin/sh', `[ "$1" = config ] && exit ${configExit}`, 'echo "git $* OPTLOCKS=$GIT_OPTIONAL_LOCKS"', ''].join('\n'))
    chmodSync(join(bin, 'git'), 0o755)
    const PATH = bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
    return exec(P, badge, { ...env, PATH })
  }
  for (const code of [0, 2, 129]) assert.equal(fake(code).body.trim(), UNSAFE_MARK, `git config exit ${code}`) // 1(찾는 설정 없음)·128(저장소가 아니거나 설정을 못 읽음 — 이어서 도는 git도 같은 오류로 끝남) 말고는 모두 거부
  assert.ok(!fake(128).body.includes(UNSAFE_MARK))
  const okOut = fake(1).body
  assert.ok(!okOut.includes(UNSAFE_MARK))
  assert.match(okOut, /git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null rev-parse --show-toplevel OPTLOCKS=0/)
  assert.match(okOut, /git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null status --ignore-submodules=all --porcelain=v1 -b -z --no-renames OPTLOCKS=0/)
  rmSync(bin, { recursive: true, force: true })
})

test('일반 GIT_GUARD: --no-optional-locks 옵션은 버려지지 않고 GIT_OPTIONAL_LOCKS=0 으로 넘어감 (5.2.0까지는 옵션이 사라졌음)', { skip: !usable }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'fakegit-'))
  writeFileSync(join(bin, 'git'), ['#!/bin/sh', 'echo "git $* OPTLOCKS=$GIT_OPTIONAL_LOCKS"', ''].join('\n'))
  chmodSync(join(bin, 'git'), 0o755)
  const PATH = bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
  const out = (cmd: string) => execSync(buildRun(A({ cmd }), {}).command, { shell: 'sh', env: { ...env, PATH }, cwd: W, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  assert.match(out('git --no-optional-locks status -s'), /git -c core\.fsmonitor=false status -s OPTLOCKS=0/)
  assert.match(out('git status -s'), /git -c core\.fsmonitor=false status -s OPTLOCKS=\s/)
  rmSync(bin, { recursive: true, force: true })
})

test('정리', { skip: !usable }, () => {
  rmSync(W, { recursive: true, force: true })
})
