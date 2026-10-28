import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fileOf, parseIndex } from './gallerycore.mts'
import { newKeyPair } from './gallerykit.mts'
import { buildIndex, signDir, summarize, verifyDir, writeBuild } from './gallerypublish.mts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const NOW = new Date('2026-11-01T00:00:00Z')
const L = (s: string) => ({ ko: s, en: s })
const pack = (id: string, over: Record<string, unknown> = {}, cmd = 'ls', risk = 'read') => ({ id, format: 1, version: '1.0.0', name: L(id), desc: L('d'), author: 'tester', license: 'MIT', plugins: [{ id: 'p', title: L('p'), actions: [{ id: 'a', label: L('a'), cmd, risk }] }], ...over })

function setup(packs: { id: string; version?: string; pack?: unknown; entry?: Record<string, unknown> }[] = [{ id: 'sensor-check' }], extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jdgal-'))
  const cat = packs.map((p) => ({ id: p.id, version: p.version ?? '1.0.0', submitter: 'someuser', reviewedAt: '2026-10-28', tags: ['t'], ...p.entry }))
  for (const p of packs) {
    const f = join(dir, fileOf(p.id, p.version ?? '1.0.0'))
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify(p.pack ?? pack(p.id, { version: p.version ?? '1.0.0' })))
  }
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify({ packs: cat, ...extra }))
  return dir
}
const cleanup = (d: string) => rmSync(d, { recursive: true, force: true })
const built = (dir: string, o = {}) => {
  const b = buildIndex(dir, { now: NOW, ...o })
  assert.ok(b.ok, b.ok ? '' : b.problems.join('; '))
  if (b.ok) writeBuild(dir, b)
  return b
}

test('build → sign → verify 전체 흐름, serial은 이어서 올라감', () => {
  const dir = setup()
  try {
    const k = newKeyPair()
    const b1 = built(dir)
    assert.equal(b1.ok && b1.index.serial, 1)
    assert.ok(b1.ok && b1.index.packs[0].caps.read === 1 && b1.index.packs[0].sha256.length === 64)
    const s = signDir(dir, k.secretPem, { keys: [k.publicB64] })
    assert.ok(s.ok && s.keyIndex === 0)
    const v = verifyDir(dir, { keys: [k.publicB64], now: NOW })
    assert.ok(v.ok, v.problems.join('; '))
    const b2 = built(dir)
    assert.equal(b2.ok && b2.index.serial, 2)
    assert.equal(existsSync(join(dir, 'index.json.sig')), false) // 새 색인을 만들면 옛 서명은 지움
    assert.equal(verifyDir(dir, { keys: [k.publicB64], now: NOW }).ok, false) // 서명 없이는 게시 불가
    assert.equal(built(dir, { serial: 9 }).ok && JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).serial, 9)
  } finally {
    cleanup(dir)
  }
})
test('sign: 앱에 없는 열쇠는 거부(허용 옵션 없이), 이상한 열쇠 파일 거부, 서명은 앱 규칙으로 다시 확인', () => {
  const dir = setup()
  try {
    built(dir)
    const k = newKeyPair()
    const other = newKeyPair()
    const r = signDir(dir, k.secretPem, { keys: [other.publicB64] })
    assert.ok(!r.ok && /앱/.test(r.problem))
    assert.equal(existsSync(join(dir, 'index.json.sig')), false)
    assert.ok(signDir(dir, k.secretPem, { keys: [other.publicB64], allowUnknown: true }).ok)
    for (const bad of ['', 'not a pem', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----']) assert.equal(signDir(dir, bad, { keys: [k.publicB64] }).ok, false)
    const rsa = '-----BEGIN PRIVATE KEY-----\n' // ed25519가 아닌 열쇠 종류는 거부
    void rsa
    assert.deepEqual(signDir(dir + '-none', k.secretPem, { keys: [] }), { ok: false, problem: 'index.json 이 없어요. 먼저 gallery:build 를 실행하세요' })
  } finally {
    cleanup(dir)
  }
})
test('verify: 서명 뒤에 색인·팩 파일을 1바이트 바꾸면 실패, 다른 열쇠도 실패, 만료도 실패', () => {
  const dir = setup()
  try {
    const k = newKeyPair()
    built(dir)
    assert.ok(signDir(dir, k.secretPem, { keys: [k.publicB64] }).ok)
    assert.equal(verifyDir(dir, { keys: [newKeyPair().publicB64], now: NOW }).ok, false)
    assert.equal(verifyDir(dir, { keys: [k.publicB64], now: new Date('2027-03-01T00:00:00Z') }).ok, false)
    assert.equal(verifyDir(dir, { keys: [], now: NOW }).ok, false)
    const packFile = join(dir, fileOf('sensor-check', '1.0.0'))
    const orig = readFileSync(packFile)
    const tampered = Buffer.from(orig)
    tampered[tampered.length - 3] ^= 1
    writeFileSync(packFile, tampered)
    assert.ok(verifyDir(dir, { keys: [k.publicB64], now: NOW }).problems.some((p) => /달라요/.test(p)))
    writeFileSync(packFile, orig)
    assert.ok(verifyDir(dir, { keys: [k.publicB64], now: NOW }).ok)
    const idx = readFileSync(join(dir, 'index.json'))
    const t2 = Buffer.from(idx)
    t2[20] ^= 1
    writeFileSync(join(dir, 'index.json'), t2)
    assert.equal(verifyDir(dir, { keys: [k.publicB64], now: NOW }).ok, false)
  } finally {
    cleanup(dir)
  }
})
test('verify: 만료 임박은 경고, 능력 요약(caps)이 팩과 다르면 실패', () => {
  const dir = setup()
  try {
    const k = newKeyPair()
    built(dir)
    signDir(dir, k.secretPem, { keys: [k.publicB64] })
    const soon = verifyDir(dir, { keys: [k.publicB64], now: new Date('2027-01-20T00:00:00Z') })
    assert.ok(soon.ok && soon.warnings.length === 1)
    const j = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
    j.packs[0].caps.danger = 3
    writeFileSync(join(dir, 'index.json'), JSON.stringify(j, null, 2) + '\n')
    assert.ok(signDir(dir, k.secretPem, { keys: [k.publicB64] }).ok)
    assert.ok(verifyDir(dir, { keys: [k.publicB64], now: NOW }).problems.some((p) => /caps/.test(p)))
  } finally {
    cleanup(dir)
  }
})
test('build 실패: 파일 없음 · JSON 아님 · 예약 id · 위험도 낮게 적음 · 라이선스/설명 없음 · id 불일치', () => {
  const cases: [string, Parameters<typeof setup>[0], RegExp][] = [
    ['파일 없음', [{ id: 'sensor-check' }], /파일이 없어요/],
    ['예약 id', [{ id: 'perf', pack: pack('perf') }], /공식 팩 전용/],
    ['위험도 낮게', [{ id: 'sensor-check', pack: pack('sensor-check', {}, 'rm -rf /tmp/x', 'read') }], /낮게|플러그인이 없어요/],
    ['라이선스 없음', [{ id: 'sensor-check', pack: pack('sensor-check', { license: undefined }) }], /license/],
    ['설명 없음', [{ id: 'sensor-check', pack: pack('sensor-check', { desc: undefined }) }], /desc/],
    ['id 불일치', [{ id: 'sensor-check', pack: pack('other-pack') }], /달라요/],
    ['제출자 없음', [{ id: 'sensor-check', entry: { reviewedAt: 'x' } }], /reviewedAt/]
  ]
  for (const [name, packs, re] of cases) {
    const dir = setup(packs)
    try {
      if (name === '파일 없음') rmSync(join(dir, fileOf('sensor-check', '1.0.0')))
      const b = buildIndex(dir, { now: NOW })
      assert.ok(!b.ok && b.problems.some((p) => re.test(p)), `${name}: ${b.ok ? 'ok' : b.problems.join(' | ')}`)
    } finally {
      cleanup(dir)
    }
  }
})
test('build 실패: 128KB 초과, JSON 아님, 이미 올린 버전의 파일이 바뀜', () => {
  let dir = setup([{ id: 'sensor-check', pack: pack('sensor-check', { pad: 'x'.repeat(130 * 1024) }) }])
  try {
    const b = buildIndex(dir, { now: NOW })
    assert.ok(!b.ok && b.problems.some((p) => /128KB/.test(p)))
  } finally {
    cleanup(dir)
  }
  dir = setup()
  try {
    writeFileSync(join(dir, fileOf('sensor-check', '1.0.0')), '{ nope')
    assert.ok(!buildIndex(dir, { now: NOW }).ok)
  } finally {
    cleanup(dir)
  }
  dir = setup()
  try {
    built(dir)
    writeFileSync(join(dir, fileOf('sensor-check', '1.0.0')), JSON.stringify(pack('sensor-check', { author: 'someone else' })))
    const b = buildIndex(dir, { now: NOW })
    assert.ok(!b.ok && b.problems.some((p) => /이미 올린 버전/.test(p)))
  } finally {
    cleanup(dir)
  }
})
test('build: 철회 항목이 앱 규칙에 안 맞으면 실패, 맞으면 색인에 들어감', () => {
  let dir = setup([{ id: 'sensor-check' }], { revoked: [{ id: 'Bad Id', reason: L('r'), at: '2026-10-30' }] })
  try {
    const b = buildIndex(dir, { now: NOW })
    assert.ok(!b.ok && b.problems.some((p) => /거부/.test(p)))
  } finally {
    cleanup(dir)
  }
  dir = setup([{ id: 'sensor-check' }], { revoked: [{ id: 'old-pack', reason: L('r'), at: '2026-10-30' }] })
  try {
    const b = built(dir)
    assert.ok(b.ok && b.index.revoked.length === 1)
    assert.ok(b.ok && b.summary.some((s) => /새 철회 old-pack/.test(s)))
  } finally {
    cleanup(dir)
  }
})
test('summarize: 새 팩·바뀐 팩·뺀 팩·재서명', () => {
  const dir = setup([{ id: 'sensor-check' }, { id: 'net-diag' }])
  try {
    const a = built(dir)
    assert.ok(a.ok)
    if (!a.ok) return
    assert.ok(a.summary.filter((s) => s.startsWith('+')).length === 2)
    const next = { ...a.index, serial: 2, packs: [{ ...a.index.packs[0], version: '1.1.0', sha256: 'f'.repeat(64) }] }
    const s = summarize(a.index, next)
    assert.ok(s.some((x) => x.startsWith('~ ')) && s.some((x) => x.startsWith('- ')))
    assert.ok(summarize(a.index, { ...a.index, serial: 2 }).some((x) => /재서명/.test(x)))
  } finally {
    cleanup(dir)
  }
})

// 스크립트 끝까지 (프로세스로 실행): 비밀 열쇠가 화면에 나오지 않고, 저장소 안에는 안 쓰고, 서명 → 앱 규칙 확인
const run = (script: string, args: string[]) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', cwd: ROOT })
test('scripts: keygen은 비밀 열쇠를 출력하지 않고 저장소 안·기존 파일을 거부, build→sign→verify', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'jdkey-'))
  const dir = setup()
  try {
    const keyFile = join(tmp, 'k.key')
    const g = run('gallery-keygen.mjs', ['--out', keyFile])
    assert.equal(g.status, 0, g.stderr)
    const pem = readFileSync(keyFile, 'utf8')
    assert.match(pem, /BEGIN PRIVATE KEY/)
    const body = pem.replace(/-----[A-Z ]+-----|\s/g, '')
    assert.ok(!g.stdout.includes(body) && !g.stdout.includes('PRIVATE KEY'))
    const pub = g.stdout.split(/\r?\n/).find((l) => /^[A-Za-z0-9+/]{43}=$/.test(l))
    assert.ok(pub, '공개 열쇠가 출력됨')
    assert.notEqual(run('gallery-keygen.mjs', ['--out', keyFile]).status, 0) // 덮어쓰기 거부
    assert.notEqual(run('gallery-keygen.mjs', ['--out', join(ROOT, 'docs', 'oops.key')]).status, 0) // 저장소 안 거부
    assert.equal(existsSync(join(ROOT, 'docs', 'oops.key')), false)
    assert.notEqual(run('gallery-keygen.mjs', []).status, 0)
    assert.equal(run('gallery-build.mjs', ['--dir', dir]).status, 0)
    assert.notEqual(run('gallery-sign.mjs', ['--key', keyFile, '--dir', dir]).status, 0) // 앱에 공개 열쇠가 없으니 거부
    assert.notEqual(run('gallery-sign.mjs', ['--key', join(ROOT, 'package.json'), '--dir', dir]).status, 0) // 저장소 안 열쇠 거부
    const s = run('gallery-sign.mjs', ['--key', keyFile, '--dir', dir, '--allow-unknown-key'])
    assert.equal(s.status, 0, s.stderr)
    assert.ok(!s.stdout.includes(body))
    assert.notEqual(run('gallery-verify.mjs', ['--dir', dir]).status, 0) // 앱에 박힌 열쇠가 없으면 실패
    const v = run('gallery-verify.mjs', ['--dir', dir, '--pub', pub!])
    assert.equal(v.status, 0, v.stderr + v.stdout)
    const r = parseIndex(readFileSync(join(dir, 'index.json')), readFileSync(join(dir, 'index.json.sig'), 'utf8'), { keys: [pub!], lastSerial: 0, now: new Date() })
    assert.ok(r.ok)
  } finally {
    cleanup(dir)
    cleanup(tmp)
  }
})

test('게시 목록 페이지: 색인에서 만들고 글자는 이스케이프한다', () => {
  const dir = setup([{ id: 'sensor-check', pack: pack('sensor-check', { name: { ko: '<b>이름</b>', en: 'A & "B"' } }) }], { revoked: [{ id: 'old-pack', reason: { ko: '문제', en: '<script>x</script>' }, at: '2026-10-30' }] })
  try {
    const b = buildIndex(dir, { now: NOW })
    assert.ok(b.ok)
    if (!b.ok) return
    writeBuild(dir, b)
    const html = readFileSync(join(dir, 'index.html'), 'utf8')
    assert.ok(html.includes('A &amp; &quot;B&quot;') && html.includes('&lt;b&gt;이름&lt;/b&gt;') && html.includes('&lt;script&gt;'))
    assert.ok(!html.includes('<script>') && !html.includes('<b>'))
    assert.ok(html.includes('files/sensor-check/1.0.0/sensor-check.jdpack.json') && html.includes('serial 1'))
  } finally {
    cleanup(dir)
  }
})

test('docs/packs: 올릴 팩 목록이 앱 검증기를 통과하고, 모음 파일은 줄 끝 변환을 막아 둔다', () => {
  const b = buildIndex(join(ROOT, 'docs/packs'), { now: NOW, serial: 1 })
  assert.ok(b.ok, b.ok ? '' : b.problems.join('\n'))
  if (b.ok) assert.ok(b.index.packs.length > 0)
  const attr = readFileSync(join(ROOT, '.gitattributes'), 'utf8')
  assert.match(attr, /^docs\/packs\/\*\* -text$/m) // 서명한 색인·지문 낸 팩이 CRLF로 바뀌면 앱이 거부함
})
