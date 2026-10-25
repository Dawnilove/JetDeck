// 사용: node scripts/i18n-check.mjs [파일/폴더...]  — 사전에 없는 tr()·trNode() 키, tr()로 안 감싼 한글 문구(주석 제외),
// 사전 파일 여러 곳에 겹친 키, 코드에서 안 쓰는 사전 키를 찾는다 (사전 없음·겹침이 있으면 실패)
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const roots = process.argv.length > 2 ? process.argv.slice(2) : ['src']
const files = []
const walk = (p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach((f) => walk(path.join(p, f))) : /\.(tsx?|mts)$/.test(p) && !/\.test\.mts$|[\\/]en[\\/]|i18n\.mts$/.test(p) && files.push(p))
roots.forEach(walk)
const { EN } = await import(pathToFileURL(path.resolve('src/main/en/index.mts')).href)
const KO = /[가-힣]/
const TR = /\btr(?:Node)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
let missing = 0
let raw = 0
const used = new Set()
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(TR)) {
    const key = m[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
    used.add(key)
    if (KO.test(key) && !(key in EN)) (missing++, console.log(`사전 없음 ${f}: ${key}`))
  }
  src.split('\n').forEach((line, i) => {
    const code = line.replace(TR, '').replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '')
    if (KO.test(code) && !/^\s*(\*|\/\*)/.test(line)) (raw++, console.log(`한글 남음 ${f}:${i + 1}: ${line.trim().slice(0, 100)}`))
  })
}

// 같은 한글 키가 사전 파일 두 곳 이상에 있으면 뒤의 것만 쓰여 번역이 엇갈림 → 한 곳에만
const dir = path.resolve('src/main/en')
const seen = new Map()
let dup = 0
for (const f of fs.readdirSync(dir).filter((x) => /^[a-z]\.mts$/.test(x)).sort()) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href)
  for (const k of Object.keys(Object.values(mod)[0])) {
    if (seen.has(k)) (dup++, console.log(`사전 겹침 ${seen.get(k)}·${f}: ${k}`))
    else seen.set(k, f)
  }
}
// 전체 검사(src)일 때만: 코드에서 안 쓰는 사전 키 (알림만, 실패로 치지 않음)
const unused = roots.length === 1 && roots[0] === 'src' ? Object.keys(EN).filter((k) => !used.has(k)) : []
unused.forEach((k) => console.log(`안 쓰는 사전 키: ${k.replace(/\n/g, '\\n').slice(0, 100)}`))

console.log(`사전 없음 ${missing}건, 사전 겹침 ${dup}건, 안 쓰는 사전 키 ${unused.length}개, 한글 남음 ${raw}줄`)
process.exit(missing || dup ? 1 : 0)
