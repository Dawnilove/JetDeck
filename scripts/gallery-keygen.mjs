// 모음 서명 열쇠 쌍 만들기 (사용자가 자기 PC에서 직접 실행). 사용: npm run gallery:keygen -- --out <비밀 열쇠를 저장할 파일 경로>
// 비밀 열쇠(PEM)는 --out 파일에만 쓰고 화면에 찍지 않는다. 저장소 폴더 안에는 쓰지 않는다 (실수로 커밋하지 않게).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newKeyPair } from '../src/main/gallerykit.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--out')
const out = i > 0 ? process.argv[i + 1] : undefined
const die = (m) => (console.error('✖ ' + m), process.exit(1))
if (!out) die('사용법: npm run gallery:keygen -- --out <비밀 열쇠 파일 경로>   (예: D:\보관\jetdeck-gallery.key — 저장소 폴더 밖, USB·암호 관리자 쪽)')
const file = resolve(out)
const rel = relative(root, file)
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) die('저장소 폴더 안에는 비밀 열쇠를 둘 수 없어요. 저장소 밖 경로를 쓰세요')
if (existsSync(file)) die('이미 파일이 있어요. 덮어쓰지 않아요. 다른 경로를 쓰세요')
const k = newKeyPair()
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, k.secretPem, { mode: 0o600, flag: 'wx' })
console.log('✔ 비밀 열쇠를 저장했어요: ' + file)
console.log('')
console.log('공개 열쇠 (비밀이 아니에요. 이 한 줄을 Claude 세션에 알려 주면 앱의 src/main/gallerykeys.mts 에 넣어요):')
console.log(k.publicB64)
console.log('')
console.log('꼭 하세요:')
console.log(' 1. 비밀 열쇠 파일을 저장소·클라우드 동기화 폴더·채팅·메일에 두지 마세요. 오프라인 보관(암호 관리자 또는 USB)하고 백업을 따로 하나 더 두세요.')
console.log(' 2. 잃어버리면: 새 열쇠 쌍을 만들고 앱을 업데이트해 "다음" 열쇠 자리를 쓰는 동안 게시가 멈춰요.')
console.log(' 3. 유출되면: 철회 목록과 앱 긴급 업데이트로 그 열쇠를 폐기해요 (docs/plugins/publish.md).')
