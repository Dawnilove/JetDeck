import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { GALLERY_BASES, checkUrl, fetchLimited, resolveSource } from './gallerynet.mts'
import { newKeyPair } from './gallerykit.mts'

let srv: Server
let base = ''
let seen: IncomingHttpHeaders = {}
before(async () => {
  srv = createServer((req, res) => {
    seen = req.headers
    const p = req.url ?? ''
    if (p === '/ok') return void res.end('hello')
    if (p === '/etag') return req.headers['if-none-match'] === '"v1"' ? void res.writeHead(304).end() : void res.writeHead(200, { ETag: '"v1"' }).end('body')
    if (p === '/redirect') return void res.writeHead(302, { Location: 'https://evil.example/x' }).end()
    if (p === '/moved') return void res.writeHead(301, { Location: '/ok' }).end()
    if (p === '/big-length') return void res.writeHead(200, { 'Content-Length': '5000' }).end('x'.repeat(5000))
    if (p === '/big-stream') {
      res.writeHead(200) // Content-Length 없음, 끝없이 보냄
      const t = setInterval(() => res.write('x'.repeat(1000)), 1)
      res.on('close', () => clearInterval(t))
      return
    }
    if (p === '/never') return // 응답 안 함
    if (p === '/boom') return void res.writeHead(500).end('err')
    res.writeHead(404).end('no')
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
})
after(() => srv.close())

const o = { max: 1000, userAgent: 'JetDeck/5.5.0', allowLoopbackHttp: true }

test('정상: 200 본문, 고정 User-Agent만 보내고 쿠키·인증·Referer는 없음', async () => {
  const r = await fetchLimited(`${base}/ok`, o)
  assert.ok(r.ok && r.status === 200 && r.bytes.toString() === 'hello')
  assert.equal(seen['user-agent'], 'JetDeck/5.5.0')
  for (const h of ['cookie', 'authorization', 'referer', 'if-none-match']) assert.equal(seen[h], undefined, h)
})
test('ETag: 같은 값을 If-None-Match로 보내면 304', async () => {
  const first = await fetchLimited(`${base}/etag`, o)
  assert.ok(first.ok && first.status === 200 && first.etag === '"v1"')
  const again = await fetchLimited(`${base}/etag`, { ...o, etag: '"v1"' })
  assert.ok(again.ok && again.status === 304)
  assert.equal(seen['if-none-match'], '"v1"')
})
test('리다이렉트(301·302)는 따라가지 않고 실패', async () => {
  for (const p of ['redirect', 'moved']) {
    const r = await fetchLimited(`${base}/${p}`, o)
    assert.ok(!r.ok && r.code === 'redirect', p)
  }
})
test('404·500은 http-status', async () => {
  for (const [p, s] of [['nope', 404], ['boom', 500]] as const) {
    const r = await fetchLimited(`${base}/${p}`, o)
    assert.ok(!r.ok && r.code === 'http-status' && r.status === s, p)
  }
})
test('크기 한도: Content-Length가 크거나, 없이 끝없이 와도 중간에 끊음', async () => {
  const a = await fetchLimited(`${base}/big-length`, o)
  assert.ok(!a.ok && a.code === 'too-big')
  const b = await fetchLimited(`${base}/big-stream`, o)
  assert.ok(!b.ok && b.code === 'too-big')
})
test('시간 한도와 취소', async () => {
  const t = Date.now()
  const a = await fetchLimited(`${base}/never`, { ...o, timeoutMs: 150 })
  assert.ok(!a.ok && a.code === 'timeout' && Date.now() - t < 3000)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 50)
  const b = await fetchLimited(`${base}/never`, { ...o, signal: ac.signal })
  assert.ok(!b.ok && b.code === 'aborted')
  const pre = new AbortController()
  pre.abort()
  const c = await fetchLimited(`${base}/ok`, { ...o, signal: pre.signal })
  assert.ok(!c.ok && c.code === 'aborted')
})
test('연결 실패는 network', async () => {
  const r = await fetchLimited('http://127.0.0.1:1/x', o)
  assert.ok(!r.ok && r.code === 'network')
})
test('주소 규칙: HTTP·쿼리·사용자 정보·조각·이상한 글자는 거부, 로컬 HTTP는 개발 허용일 때만', async () => {
  assert.ok(checkUrl('https://dawnilove.github.io/JetDeck/packs/index.json'))
  for (const bad of ['http://dawnilove.github.io/x', 'ftp://x/y', 'https://a/b?x=1', 'https://u:p@a/b', 'https://a/b#c', 'file:///etc/passwd', 'javascript:1', '', 'not a url', 'http://127.0.0.1.evil.example/x']) assert.equal(checkUrl(bad, true), null, bad)
  assert.equal(checkUrl('http://127.0.0.1:8080/x', false), null)
  assert.ok(checkUrl('http://127.0.0.1:8080/x', true))
  const r = await fetchLimited('http://example.com/x', { ...o, allowLoopbackHttp: false })
  assert.ok(!r.ok && r.code === 'bad-url')
})
test('주소 정하기: 배포 앱은 환경 변수를 무시, 개발 빌드만 시험 서버·시험 열쇠를 받음', () => {
  const pub = newKeyPair().publicB64
  const env = { JETDECK_GALLERY_URL: 'http://127.0.0.1:9/x', JETDECK_GALLERY_PUBKEY: pub }
  const packaged = resolveSource(env, true)
  assert.deepEqual(packaged.bases, GALLERY_BASES)
  assert.equal(packaged.dev, false)
  assert.equal(packaged.allowLoopbackHttp, false)
  assert.ok(!packaged.keys.includes(pub))
  const dev = resolveSource(env, false)
  assert.deepEqual(dev.bases, ['http://127.0.0.1:9/x/'])
  assert.deepEqual(dev.keys, [pub])
  assert.ok(dev.dev && dev.allowLoopbackHttp)
  assert.deepEqual(resolveSource({}, false).bases, GALLERY_BASES)
  for (const bad of ['http://evil.example/p/', 'ftp://x/', 'https://u:p@a/', 'https://a/?q=1', 'garbage']) assert.deepEqual(resolveSource({ JETDECK_GALLERY_URL: bad }, false).bases, GALLERY_BASES, bad)
  assert.ok(GALLERY_BASES.every((b) => b.startsWith('https://') && b.endsWith('/')))
})
