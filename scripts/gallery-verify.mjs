// 게시 전 확인: 앱에 박힌 공개 열쇠로 서명·형식·만료·모든 팩 파일의 지문을 확인한다. 사용: npm run gallery:verify [-- --dir docs/packs] [-- --pub <시험용 공개 열쇠>]
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GALLERY_KEYS } from '../src/main/gallerykeys.mts'
import { verifyDir } from '../src/main/gallerypublish.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined)
const dir = resolve(arg('--dir') ?? resolve(root, 'docs/packs'))
const pub = arg('--pub')
const r = verifyDir(dir, { keys: pub ? [pub] : GALLERY_KEYS })
for (const i of r.info) console.log('  ' + i)
for (const w of r.warnings) console.warn('! ' + w)
if (!r.ok) {
  console.error('✖ 게시하면 안 돼요:')
  for (const p of r.problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('✔ 게시해도 돼요 (앱이 이 색인을 받아들여요)')
