import assert from 'node:assert/strict'
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseBadge, UNSAFE_MARK } from './packbadgecore.mts'
import { splitExit } from './packpollcore.mts'
import { shq } from './shq.mts'
import { BADGE_GIT_GUARD, buildBadge, buildFrom, buildPoll, buildPreview, buildRun, buildStream } from './packrun.mts'
import { validatePack, type Badge, type PackAction } from './packschema.mts'

// 5.3.0 출시 차단 조건: 악성 .git 설정이 있는 폴더에서 Git 배지·팩 항목(실행·미리보기·실시간·그래프·목록)을 돌려도 코드가 실행되지 않아야 함.
// 진짜 sh·git으로 임시 폴더에 가짜 악성 저장소를 만들어 확인하고(표식 파일이 생기면 실패), 같은 저장소에 5.2.0의 옛 보호 함수를 쓰면 표식이 생기는 것으로 시험이 실제로 공격을 재현하는지 확인한다. sh·git·timeout이 없으면 건너뜀
const L = (s: string) => ({ ko: s, en: s })
const GIT = 'git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames'
const badge: Badge = { ...validatePack({
  id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: '5.3.0', plugins: [],
  badges: [{ id: 'git', label: L('Git'), cmd: GIT, separator: 'nul', root: 'line1', tag: { match: '^## (.+?)(?:\\.\\.\\.|$)' }, match: '^(.{2}) (.+)$', code: 1, path: 2, codes: { ' M': { show: 'M', text: L('수정됨'), tone: 'warn' }, '??': { show: 'U', text: L('새 파일'), tone: 'info' } } }]
}).pack!.badges![0], timeout: 60 } // 시험 PC가 바쁠 때(Windows git은 느림) 10초 제한에 걸려 흔들리지 않게 길게
const A = (o: Partial<PackAction>): PackAction => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', declared: 'read', computed: 'read', reasons: [], understated: false, mode: 'exec', shell: 'sh', ...o })
// 5.2.0까지 팩 항목에 쓰던 옛 보호 함수 (통제 시험 전용: 이것으로는 공격이 먹힌다는 것을 보임)
const LEGACY_GUARD = `git() { case "$1" in -C) _d=$2; shift 2; (cd "$_d" && git "$@");; --no-pager|--no-optional-locks) shift; git "$@";; diff|log|show) _s=$1; shift; command git -c core.fsmonitor=false "$_s" --no-ext-diff --no-textconv "$@";; *) command git -c core.fsmonitor=false "$@";; esac; }; unset GIT_EXTERNAL_DIFF\n`

let usable = true
try {
  execSync('sh -c "command -v timeout >/dev/null && command -v git >/dev/null && touch -d 2001-01-01 /dev/null 2>/dev/null; command -v git"', { stdio: 'ignore' })
} catch {
  usable = false
}
let hasBash = true
try {
  execSync('sh -c "command -v bash"', { stdio: 'ignore' })
} catch {
  hasBash = false
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

// ── 공격 저장소 목록. unsafe = 저장소 설정만 봐도 git을 안 돌려야 하는 것, 나머지는 돌되 코드가 실행되면 안 되는 것 ──
type Attack = { name: string; setup: (n: string) => string; cmd: string; unsafe: boolean }
const filterAttr = `printf '* diff=x\\n' > .gitattributes`
const ATTACKS: Attack[] = [
  { name: 'filter-clean', setup: (n) => `git config filter.x.clean "${touchCmd(n)}; cat"`, cmd: 'status --porcelain', unsafe: true },
  { name: 'filter-process', setup: (n) => `git config filter.x.process "${touchCmd(n)}"`, cmd: 'status --porcelain', unsafe: true },
  { name: 'filter-smudge', setup: (n) => `git config filter.x.smudge "${touchCmd(n)}; cat"`, cmd: 'cat-file --filters HEAD:a.txt', unsafe: true },
  { name: 'include', setup: (n) => `printf '[filter "x"]\\n\\tclean = ${touchCmd(n)}; cat\\n' > '${P}/evil_${n}.cfg' && git config include.path '${P}/evil_${n}.cfg'`, cmd: 'status --porcelain', unsafe: true },
  { name: 'worktree-config', setup: (n) => `git config extensions.worktreeConfig true && printf '[filter "x"]\\n\\tclean = ${touchCmd(n)}; cat\\n' > .git/config.worktree`, cmd: 'status --porcelain', unsafe: true },
  { name: 'textconv-blame', setup: (n) => `${filterAttr} && git add .gitattributes && git commit -qm attr && git config diff.x.textconv "${touchCmd(n)}; cat"`, cmd: 'blame a.txt', unsafe: true },
  { name: 'fsmonitor', setup: (n) => `git config core.fsmonitor "${touchCmd(n)}; echo"`, cmd: 'status --porcelain', unsafe: false },
  { name: 'hook-post-index-change', setup: (n) => `printf '#!/bin/sh\\n${touchCmd(n)}\\n' > .git/hooks/post-index-change && chmod +x .git/hooks/post-index-change`, cmd: '--no-optional-locks status --porcelain', unsafe: false },
  { name: 'pager', setup: (n) => `git config core.pager "${touchCmd(n)}; cat"`, cmd: '-p log -n 1', unsafe: false }, // -p 는 터미널이 아니어도 pager를 씀 (실시간 보기는 pty라 -p 없이도 씀)
  {
    name: 'gpg-program',
    setup: (n) => `printf '#!/bin/sh\\n${touchCmd(n)}\\n' > '${P}/evilgpg_${n}.sh' && chmod +x '${P}/evilgpg_${n}.sh' && git config gpg.program '${P}/evilgpg_${n}.sh' && git config log.showSignature true && T=$(git write-tree) && C=$(printf 'tree %s\\nauthor a <a@b.c> 1 +0000\\ncommitter a <a@b.c> 1 +0000\\ngpgsig -----BEGIN PGP SIGNATURE-----\\n \\n x\\n -----END PGP SIGNATURE-----\\n\\nsigned\\n' "$T" | git hash-object -t commit -w --stdin) && git update-ref HEAD "$C"`,
    cmd: 'log -n 1',
    unsafe: false
  }
]
const repoOf = (a: Attack) => `atk_${a.name}`
const mkAttack = (a: Attack) => mkRepo(repoOf(a), a.setup(a.name))
const gitLine = (a: Attack, dir: string) => `git -C '${dir}' ${a.cmd}`
const run = (cmd: string, e = env) => spawnSync('sh', ['-c', cmd], { env: e, cwd: W, encoding: 'utf8' })

// 팩 항목이 명령을 실행하는 모든 길 (packrun 빌더가 만든 문자열을 그대로 sh에서 실행)
const PATHS: Record<string, (c: string) => string> = {
  run: (c) => buildRun(A({ cmd: c }), {}).command,
  preview: (c) => buildPreview(A({ cmd: 'true', preview: c }), {}),
  poll: (c) => buildPoll(A({ cmd: c })),
  stream: (c) => buildStream(A({ mode: 'stream', cmd: c }), {}),
  from: (c) => buildFrom({ cmd: c, shell: 'sh', timeout: 10 })
}

test('악성 .git 설정(배지): filter.clean · include로 숨긴 필터 · worktree 설정은 git을 돌리기 전에 막고 unsafe', { skip: !usable }, () => {
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

test('악성 .git 설정(배지): fsmonitor · post-index-change 훅 · 서브모듈 안 필터는 실행되지 않고 배지는 정상', { skip: !usable }, () => {
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

test('통제: 같은 악성 저장소에 5.2.0의 옛 보호 함수를 쓰면 표식이 생김 → 아래 시험은 실제 공격을 재현함', { skip: !usable }, (t) => {
  mkRepo('sub')
  const cases: { n: string; repo: () => void; cmd: string }[] = [
    { n: 'c-filter', repo: () => mkRepo('c-filter', `git config filter.x.clean "${touchCmd('c-filter')}; cat"`), cmd: `git -C '${P}/c-filter' status --porcelain` },
    { n: 'c-hook', repo: () => mkRepo('c-hook', `printf '#!/bin/sh\\n${touchCmd('c-hook')}\\n' > .git/hooks/post-index-change && chmod +x .git/hooks/post-index-change`), cmd: `git --no-optional-locks -C '${P}/c-hook' status --porcelain` },
    { n: 'c-sub', repo: () => mkRepo('c-sub', `git -c protocol.file.allow=always submodule add -q '${P}/sub' sm 2>/dev/null; git commit -qm sm 2>/dev/null; git -C sm config filter.x.clean "${touchCmd('c-sub')}; cat"; touch -d 2001-01-01 sm/a.txt; touch sm/a.txt`), cmd: `git -C '${P}/c-sub' status --porcelain` },
    { n: 'c-blame', repo: () => mkRepo('c-blame', `${filterAttr} && git add .gitattributes && git commit -qm attr && git config diff.x.textconv "${touchCmd('c-blame')}; cat"`), cmd: `git -C '${P}/c-blame' blame a.txt` },
    { n: 'c-pager', repo: () => mkRepo('c-pager', `git config core.pager "${touchCmd('c-pager')}; cat"`), cmd: `git -C '${P}/c-pager' -p log -n 1` }
  ]
  for (const c of cases) {
    c.repo()
    run(LEGACY_GUARD + c.cmd)
    if (!existsSync(mark(c.n))) t.diagnostic(`이 환경에서는 옛 보호 함수로도 ${c.n} 공격이 재현되지 않음 (git 버전 차이)`)
  }
  // 적어도 가장 중요한 필터 공격은 재현돼야 아래 시험이 의미가 있음
  assert.equal(existsSync(mark('c-filter')), true, '이 환경에서 filter.clean이 실행되지 않으면 아래 시험은 아무것도 증명하지 못함')
  assert.equal(existsSync(mark('c-hook')), true, '옛 함수가 --no-optional-locks를 버려 인덱스를 쓰고 훅이 돌아야 함')
})

test('팩 항목의 모든 실행 길(실행·미리보기·실시간·그래프·목록)에서 악성 저장소는 코드를 실행하지 않음', { skip: !usable }, () => {
  for (const a of ATTACKS) mkAttack(a)
  for (const [path, build] of Object.entries(PATHS)) {
    for (const a of ATTACKS) {
      rmSync(mark(a.name), { force: true })
      const r = run(build(gitLine(a, `${P}/${repoOf(a)}`)))
      assert.equal(existsSync(mark(a.name)), false, `${path} / ${a.name}: 표식 파일이 생김 = 저장소의 설정이 코드를 실행했음`)
      if (a.unsafe) assert.ok(r.stdout.split(/\r?\n/).includes(UNSAFE_MARK), `${path} / ${a.name}: 위험 표시가 없음: ${r.stdout.slice(0, 80)}`)
      else assert.ok(!r.stdout.includes(UNSAFE_MARK), `${path} / ${a.name}: 정상 저장소를 거부했음`)
    }
  }
})

test('경로·별칭으로 우회해도 보호를 지남: cd 뒤 git · 파이프 · 서브셸 · bash -i의 alias', { skip: !usable }, (t) => {
  const a = ATTACKS[0]
  mkAttack(a)
  const dir = `${P}/${repoOf(a)}`
  const variants = [`cd '${dir}' && git status --porcelain`, `cd '${dir}'; git status 2>&1 | cat`,`echo $(cd '${dir}' && git status) | cat`, `(cd '${dir}'; git --no-pager status)`, `git --no-pager -C '${dir}' --no-optional-locks status`]
  for (const v of variants) {
    rmSync(mark(a.name), { force: true })
    run(PATHS.run(v))
    assert.equal(existsSync(mark(a.name)), false, v)
  }
  if (!hasBash) return
  // ~/.bashrc의 alias git='command git' 은 함수를 건너뛰게 만들 수 있음 → 보호 함수 앞의 unalias가 막아야 함
  writeFileSync(join(W, '.bashrc'), "alias git='command git'\n")
  for (const build of [(c: string) => buildRun(A({ cmd: c, shell: 'bash-i' }), {}).command, (c: string) => buildStream(A({ mode: 'stream', cmd: c, shell: 'bash-i' }), {})]) {
    rmSync(mark(a.name), { force: true })
    run(build(`git -C '${dir}' status --porcelain`))
    assert.equal(existsSync(mark(a.name)), false, 'bash -i alias')
  }
  // 통제: unalias 줄이 없으면 이 별칭이 보호를 건너뛰는지 (건너뛰지 않는 bash라면 unalias는 무해한 보험일 뿐)
  rmSync(mark(a.name), { force: true })
  run(`bash -ic ${shq(BADGE_GIT_GUARD.replace(/^\\unalias git 2>\/dev\/null\n/, '') + `git -C '${dir}' status --porcelain\n`)}`)
  t.diagnostic(`unalias 없이 bash -i 별칭 우회: ${existsSync(mark(a.name)) ? '재현됨' : '재현 안 됨'}`)
  rmSync(join(W, '.bashrc'), { force: true })
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

test('정상 저장소: 팩 항목의 git status·log·diff·branch가 그대로 읽힘 (저장소 아닌 폴더는 git의 오류)', { skip: !usable }, () => {
  mkRepo('ok2', `printf 'x\\n' > new.txt && printf 'changed\\n' > a.txt && git config --unset-all filter.x.clean; printf '' > .gitattributes`)
  const dir = `${P}/ok2`
  const out = (c: string) => run(PATHS.run(c)).stdout
  assert.match(out(`git -C '${dir}' status --porcelain`), / M a\.txt\r?\n\?\? new\.txt/)
  assert.match(out(`git -C '${dir}' log --oneline -n 1`), /init/)
  assert.match(out(`git -C '${dir}' diff --stat`), /a\.txt/)
  assert.match(out(`git -C '${dir}' branch --show-current`), /\w/)
  assert.ok(!out(`git -C '${dir}' status`).includes(UNSAFE_MARK))
  sh(`rm -rf '${P}/plain2' && mkdir '${P}/plain2'`)
  const np = out(`git -C '${P}/plain2' status`)
  assert.ok(!np.includes(UNSAFE_MARK))
  assert.match(np, /not a git repository|__EXIT__128/)
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
    writeFileSync(join(bin, 'git'), ['#!/bin/sh', `[ "$1" = config ] && exit ${configExit}`, 'echo "git $* OPTLOCKS=$GIT_OPTIONAL_LOCKS PAGER=$GIT_PAGER"', ''].join('\n'))
    chmodSync(join(bin, 'git'), 0o755)
    const PATH = bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
    return exec(P, badge, { ...env, PATH })
  }
  for (const code of [0, 2, 129]) assert.equal(fake(code).body.trim(), UNSAFE_MARK, `git config exit ${code}`) // 1(찾는 설정 없음)·128(저장소가 아니거나 설정을 못 읽음 — 이어서 도는 git도 같은 오류로 끝남) 말고는 모두 거부
  assert.ok(!fake(128).body.includes(UNSAFE_MARK))
  const okOut = fake(1).body
  assert.ok(!okOut.includes(UNSAFE_MARK))
  assert.match(okOut, /git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null -c gpg\.program=\/bin\/false .* rev-parse --show-toplevel OPTLOCKS=0 PAGER=cat/)
  assert.match(okOut, /git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null -c gpg\.program=\/bin\/false .* status --ignore-submodules=all --porcelain=v1 -b -z --no-renames OPTLOCKS=0 PAGER=cat/)
  rmSync(bin, { recursive: true, force: true })
})

test('팩 항목 보호: --no-optional-locks 가 없어도 항상 GIT_OPTIONAL_LOCKS=0 (5.2.0까지는 옵션이 사라지거나 없어서 인덱스를 썼음)', { skip: !usable }, () => {
  const bin = mkdtempSync(join(tmpdir(), 'fakegit-'))
  writeFileSync(join(bin, 'git'), ['#!/bin/sh', '[ "$1" = config ] && exit 1', 'echo "git $* OPTLOCKS=$GIT_OPTIONAL_LOCKS"', ''].join('\n'))
  chmodSync(join(bin, 'git'), 0o755)
  const PATH = bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH
  const out = (cmd: string) => execSync(buildRun(A({ cmd }), {}).command, { shell: 'sh', env: { ...env, PATH }, cwd: W, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  assert.match(out('git --no-optional-locks status -s'), /status --ignore-submodules=all -s OPTLOCKS=0/)
  assert.match(out('git status -s'), /status --ignore-submodules=all -s OPTLOCKS=0/)
  rmSync(bin, { recursive: true, force: true })
})

test('정리', { skip: !usable }, () => {
  rmSync(W, { recursive: true, force: true })
})
