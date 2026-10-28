// 모음 색인 서명 (사용자만 실행. 자동화하지 않음). 사용: npm run gallery:sign -- --key <비밀 열쇠 파일> [--dir docs/packs]
// 비밀 열쇠는 이 명령이 파일에서 읽어 서명에만 쓰고, 어디에도 저장·출력하지 않는다.
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GALLERY_KEYS } from '../src/main/gallerykeys.mts'
import { signDir } from '../src/main/gallerypublish.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined)
const die = (m) => (console.error('✖ ' + m), process.exit(1))
const keyPath = arg('--key')
if (!keyPath) die('사용법: npm run gallery:sign -- --key <비밀 열쇠 파일>')
const rel = relative(root, resolve(keyPath))
if (!rel.startsWith('..') && !isAbsolute(rel)) die('비밀 열쇠가 저장소 폴더 안에 있어요. 저장소 밖으로 옮기세요 (커밋 사고 방지)')
const dir = resolve(arg('--dir') ?? resolve(root, 'docs/packs'))
let pem
try {
  pem = readFileSync(resolve(keyPath), 'utf8')
} catch {
  die('열쇠 파일을 읽을 수 없어요')
}
const r = signDir(dir, pem, { keys: GALLERY_KEYS, allowUnknown: process.argv.includes('--allow-unknown-key') })
if (!r.ok) die(r.problem)
console.log(`✔ 서명했어요 (앱 공개 열쇠 ${r.keyIndex < 0 ? '목록 밖(--allow-unknown-key)' : r.keyIndex + 1 + '번 자리'}). index.json.sig 를 만들었어요`)
console.log('다음: npm run gallery:verify')
