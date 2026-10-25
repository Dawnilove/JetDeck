// 설치 파일에 같이 넣을 제3자 라이선스 모음 만들기 → build/THIRD_PARTY_LICENSES.txt (npm run dist* 가 먼저 실행)
// 앱에 들어가는 패키지(dependencies + 화면에 번들되는 devDependencies)와 그 하위 의존성의 LICENSE 파일을 이어 붙임
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
// 화면(renderer)에 번들되는 개발 의존성: 접두사로 고름 (@fontsource/* 글꼴 포함)
const BUNDLED = ['react', 'react-dom', '@xterm/', 'monaco-editor', 'react-resizable-panels', '@novnc/novnc', '@fontsource/', 'pretendard']
const roots = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}).filter((n) => BUNDLED.some((b) => (b.endsWith('/') ? n.startsWith(b) : n === b)))
]

const seen = new Map()
const read = (name) => {
  try {
    const dir = path.join('node_modules', name)
    return { dir, json: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) }
  } catch {
    return null
  }
}
const walk = (name) => {
  if (seen.has(name)) return
  const p = read(name)
  if (!p) return // 이 OS용이 아닌 선택 의존성 등
  seen.set(name, p)
  Object.keys(p.json.dependencies || {}).forEach(walk)
}
roots.forEach(walk)

const out = ['JetDeck 제3자 구성요소 라이선스 (Third-party licenses)', '']
for (const [name, { dir, json }] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
  const lic = typeof json.license === 'string' ? json.license : json.license?.type || json.licenses?.map((l) => l.type).join(' / ') || '?'
  out.push('='.repeat(72), `${name}@${json.version} — ${lic}`, json.homepage || json.repository?.url || '', '='.repeat(72))
  const files = fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
  if (files.length === 0) out.push(`(패키지에 라이선스 파일이 없음 — package.json의 license: ${lic}, 전문: https://spdx.org/licenses/${lic}.html)`)
  for (const f of files) out.push(fs.readFileSync(path.join(dir, f), 'utf8').trim(), '')
  out.push('')
}
fs.mkdirSync('build', { recursive: true })
fs.writeFileSync('build/THIRD_PARTY_LICENSES.txt', out.join('\n'))
console.log(`THIRD_PARTY_LICENSES.txt: ${seen.size}개 패키지`)
