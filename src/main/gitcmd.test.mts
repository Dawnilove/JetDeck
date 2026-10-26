import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gitCommand } from './gitcmd.mts'
import { parseGit } from './gitparse.mts'
import { shq } from './shq.mts'

// 탐색기 Git 표시(폴더를 열면 저절로 실행)도 악성 .git 설정으로 코드를 실행하면 안 됨. packgitguard.test.mts와 같은 방식: 진짜 sh·git·timeout으로 가짜 악성 저장소를 만들어 표식 파일이 생기면 실패. 없으면 건너뜀
let usable = true
try {
  execSync('sh -c "command -v timeout >/dev/null && command -v git >/dev/null"', { stdio: 'ignore' })
} catch {
  usable = false
}
const posix = (p: string) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_m, d: string) => '/' + d.toLowerCase()).replace(/\\/g, '/') : p)
const W = usable ? mkdtempSync(join(tmpdir(), 'gitcmd-')) : ''
const P = posix(W)
const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: P + '/gitconfig', HOME: W }
const sh = (script: string) => execFileSync('sh', ['-c', script], { env, cwd: W, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
const mkRepo = (name: string, extra = '') => sh(`rm -rf '${P}/${name}' && mkdir '${P}/${name}' && cd '${P}/${name}' && git init -q . 2>/dev/null && git config user.email a@b.c && git config user.name t && printf 'hello\\n' > a.txt && printf '* filter=x\\n' > .gitattributes && git add . 2>/dev/null && git commit -qm init 2>/dev/null; cd '${P}/${name}' && ${extra ? extra + ' &&' : ''} touch -d 2001-01-01 a.txt && touch a.txt`)
const mark = (n: string) => join(W, 'MARK_' + n)
const touchCmd = (n: string) => `touch '${P}/MARK_${n}'`
// Windows의 git은 최상위를 C:/… 로 찍음 (Linux에서는 그대로)
const open = (name: string) => execSync(gitCommand(shq(`${P}/${name}`)), { shell: 'sh', env, cwd: W, stdio: ['ignore', 'pipe', 'ignore'] }).toString().replace(/^TOP=([A-Za-z]):\//, (_m, d: string) => 'TOP=/' + d.toLowerCase() + '/')
const openOrEmpty = (name: string) => {
  try {
    return open(name)
  } catch {
    return '' // 위험해서 git을 안 돌리면 명령이 0이 아닌 코드로 끝날 수 있음
  }
}

test('gitCommand: 악성 filter.clean · include · process · worktree 설정은 git을 돌리기 전에 막고 표시 없음(null)', { skip: !usable }, () => {
  mkRepo('f1', `git config filter.x.clean "${touchCmd('f1')}; cat"`)
  writeFileSync(join(W, 'evil.cfg'), `[filter "x"]\n\tclean = ${touchCmd('f2')}; cat\n`)
  mkRepo('f2', `git config include.path '${P}/evil.cfg'`)
  mkRepo('f3', `git config filter.x.process "${touchCmd('f3')}"`)
  mkRepo('f4', `git config extensions.worktreeConfig true && printf '[filter "x"]\\n\\tclean = ${touchCmd('f4')}; cat\\n' > .git/config.worktree`)
  for (const n of ['f1', 'f2', 'f3', 'f4']) {
    assert.equal(parseGit(openOrEmpty(n)), null, n)
    assert.equal(existsSync(mark(n)), false, n)
  }
})

test('gitCommand: fsmonitor · post-index-change 훅 · 서브모듈 안 필터는 실행되지 않고 표시는 정상', { skip: !usable }, () => {
  mkRepo('m1', `git config core.fsmonitor "${touchCmd('m1')}; echo"`)
  mkRepo('m2', `printf '#!/bin/sh\\n${touchCmd('m2')}\\n' > .git/hooks/post-index-change && chmod +x .git/hooks/post-index-change`)
  mkRepo('sub')
  mkRepo('m3', `git -c protocol.file.allow=always submodule add -q '${P}/sub' sm 2>/dev/null; git commit -qm sm 2>/dev/null; git -C sm config filter.x.clean "${touchCmd('m3')}; cat"; touch -d 2001-01-01 sm/a.txt; touch sm/a.txt`)
  for (const n of ['m1', 'm2', 'm3']) {
    assert.ok(parseGit(open(n)), n)
    assert.equal(existsSync(mark(n)), false, n)
  }
})

test('통제: 옛 명령(가드 없음)을 같은 악성 저장소에 쓰면 표식이 생김 → 위 시험은 실제 공격을 재현함', { skip: !usable }, () => {
  mkRepo('c1', `git config filter.x.clean "${touchCmd('c1')}; cat"`)
  execSync(`cd '${P}/c1' && git -c core.quotepath=off status --porcelain=v1 -b -z --no-renames`, { shell: 'sh', env, cwd: W, stdio: 'ignore' })
  assert.equal(existsSync(mark('c1')), true, '이 환경에서 filter.clean이 실행되지 않으면 위 시험은 아무것도 증명하지 못함')
})

test('gitCommand: 정상 저장소는 브랜치·변경·새 파일을 돌려주고, 저장소가 아니면 null', { skip: !usable }, () => {
  mkRepo('ok1', `printf 'x\\n' > new.txt && printf 'changed\\n' > a.txt && git config --unset-all filter.x.clean; printf '' > .gitattributes && git branch -M main`)
  const g = parseGit(open('ok1'))!
  assert.equal(g.top, `${P}/ok1`)
  assert.equal(g.branch, 'main')
  assert.deepEqual(g.files, { [`${P}/ok1/a.txt`]: 'M', [`${P}/ok1/new.txt`]: 'U', [`${P}/ok1/.gitattributes`]: 'M' })
  sh(`rm -rf '${P}/plain' && mkdir '${P}/plain'`)
  assert.equal(parseGit(openOrEmpty('plain')), null)
})

test('정리', { skip: !usable }, () => {
  rmSync(W, { recursive: true, force: true })
})
