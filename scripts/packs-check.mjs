// 커뮤니티 팩 제출 검사 (CI 전용, 비밀값 없음). 사용: node scripts/packs-check.mjs --base origin/main
// PR이 바꾼 파일을 git으로 구해 src/main/packcheck.mts 로 검사한다. 팩 내용은 실행하지 않고 읽기만 한다.
// PR 설명은 환경 변수 PR_BODY 로 받는다 (명령줄·셸에 끼워 넣지 않음). 요약은 GITHUB_STEP_SUMMARY 에 쓴다.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSubmission, renderSummary } from '../src/main/packcheck.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined)
const base = arg('--base')
if (!base || !/^[\w./-]+$/.test(base)) {
  console.error('사용: node scripts/packs-check.mjs --base origin/main')
  process.exit(2)
}
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

const changed = git('diff', '--name-status', '--no-renames', '-z', `${base}...HEAD`, '--', 'docs/packs')
  .split('\0')
  .reduce((acc, cur, i, all) => (i % 2 === 0 && cur ? [...acc, { status: cur[0], path: all[i + 1] }] : acc), [])
let existingIds = []
try {
  existingIds = git('ls-tree', '--name-only', `${base}`, 'docs/packs/files/').split('\n').filter(Boolean).map((p) => p.split('/').pop())
} catch {
  /* 기준 브랜치에 폴더가 없으면 빈 목록 */
}
const r = checkSubmission({
  changed,
  existingIds,
  prBody: process.env.PR_BODY ?? '',
  read: (p) => {
    try {
      return readFileSync(resolve(root, p))
    } catch {
      return null
    }
  }
})
const md = renderSummary(r)
console.log(md)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
for (const p of r.problems) console.log(`::error::${p.replace(/[\r\n%]/g, ' ')}`)
process.exit(r.ok ? 0 : 1)
