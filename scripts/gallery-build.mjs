// 모음 색인 만들기. 사용: npm run gallery:build [-- --dir docs/packs] [-- --serial N]
// docs/packs/catalog.json(올릴 팩 목록)과 files/ 아래 팩 파일을 앱과 같은 검증기로 검사해 index.json을 만든다. 서명은 따로(gallery:sign, 사용자만)
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, writeBuild } from '../src/main/gallerypublish.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined)
const dir = resolve(arg('--dir') ?? resolve(root, 'docs/packs'))
const serial = arg('--serial') ? Number(arg('--serial')) : undefined
const r = buildIndex(dir, { serial })
if (!r.ok) {
  console.error('✖ 색인을 만들 수 없어요:')
  for (const p of r.problems) console.error('  - ' + p)
  process.exit(1)
}
writeBuild(dir, r)
console.log('✔ index.json 을 만들었어요 (index.json.sig 는 지웠어요 — 다시 서명해야 해요)')
for (const s of r.summary) console.log('  ' + s)
console.log('\n다음: 위 요약을 읽고, 괜찮으면 직접 서명하세요:  npm run gallery:sign -- --key <비밀 열쇠 파일>')
