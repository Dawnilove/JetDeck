// 모음 내려받기 규칙(5.5.0, 설계안 §8-5): 주소는 앱 상수, HTTPS만, 리다이렉트 거부, 크기·시간 한도, 쿠키·식별값 없음. Electron 없이 시험 (gallerynet.test.mts)
// fetch 구현은 바꿔 끼울 수 있다: 앱에서는 Electron net.fetch(시스템 프록시 사용), 시험에서는 Node fetch
import { GALLERY_KEYS } from './gallerykeys.mts'
import { publicKeyOf } from './gallerycore.mts'

export const GALLERY_BASES = ['https://dawnilove.github.io/JetDeck/packs/', 'https://raw.githubusercontent.com/Dawnilove/JetDeck/main/docs/packs/'] // 우선, 대체
export const FETCH_TIMEOUT_MS = 15_000
export const REFRESH_GAP_MS = 10_000 // 새로고침은 10초에 1번

export type Source = { bases: string[]; keys: string[]; allowLoopbackHttp: boolean; dev: boolean }
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

// 주소·열쇠 정하기. 배포(포장된) 앱은 환경 변수를 전혀 보지 않음 → 사용자가 속아 주소를 바꾸는 길이 없음.
// 개발 빌드만 JETDECK_GALLERY_URL(시험 서버)·JETDECK_GALLERY_PUBKEY(시험 공개 열쇠)를 받음
export function resolveSource(env: Record<string, string | undefined>, isPackaged: boolean): Source {
  const fixed: Source = { bases: GALLERY_BASES, keys: GALLERY_KEYS, allowLoopbackHttp: false, dev: false }
  if (isPackaged) return fixed
  const raw = env.JETDECK_GALLERY_URL
  if (!raw) return fixed
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return fixed
  }
  if (u.username || u.password || u.search || u.hash) return fixed
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return fixed
  const key = env.JETDECK_GALLERY_PUBKEY
  return { bases: [u.href.endsWith('/') ? u.href : u.href + '/'], keys: key && publicKeyOf(key) ? [key] : GALLERY_KEYS, allowLoopbackHttp: true, dev: true }
}

export type NetError = 'bad-url' | 'redirect' | 'http-status' | 'too-big' | 'timeout' | 'network' | 'aborted'
export type FetchResult = { ok: true; status: 200; bytes: Buffer; etag?: string } | { ok: true; status: 304 } | { ok: false; code: NetError; status?: number }
export type FetchOpts = {
  max: number // 바이트 한도 (넘으면 중간에 끊음)
  userAgent: string
  etag?: string
  timeoutMs?: number
  allowLoopbackHttp?: boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

// 주소 검사: HTTPS만(개발용 로컬 시험 서버만 예외), 사용자 정보·쿼리·조각 없음
export function checkUrl(url: string, allowLoopbackHttp = false): URL | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.username || u.password || u.search || u.hash) return null
  if (u.protocol === 'https:') return u
  return u.protocol === 'http:' && allowLoopbackHttp && LOOPBACK.has(u.hostname) ? u : null
}

export async function fetchLimited(url: string, o: FetchOpts): Promise<FetchResult> {
  const u = checkUrl(url, o.allowLoopbackHttp)
  if (!u) return { ok: false, code: 'bad-url' }
  const ac = new AbortController()
  let why: 'timeout' | 'aborted' | 'too-big' | null = null
  const stop = (w: typeof why) => {
    why ??= w
    ac.abort()
  }
  const timer = setTimeout(() => stop('timeout'), o.timeoutMs ?? FETCH_TIMEOUT_MS)
  const onAbort = () => stop('aborted')
  if (o.signal?.aborted) onAbort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const headers: Record<string, string> = { 'User-Agent': o.userAgent }
    if (o.etag) headers['If-None-Match'] = o.etag
    // 쿠키·인증 없음, 리다이렉트는 따르지 않고 직접 판정
    const res = await (o.fetchImpl ?? fetch)(u.href, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: ac.signal })
    if (res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400 && res.status !== 304)) return { ok: false, code: 'redirect', status: res.status }
    if (res.status === 304) return o.etag ? { ok: true, status: 304 } : { ok: false, code: 'http-status', status: 304 }
    if (res.status !== 200) return { ok: false, code: 'http-status', status: res.status }
    const len = Number(res.headers.get('content-length'))
    if (Number.isFinite(len) && len > o.max) return (stop('too-big'), { ok: false, code: 'too-big' })
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, code: 'network' }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > o.max) return (stop('too-big'), { ok: false, code: 'too-big' }) // 거짓 Content-Length·끝없는 본문도 여기서 끊김
      chunks.push(value)
    }
    return { ok: true, status: 200, bytes: Buffer.concat(chunks), etag: res.headers.get('etag') ?? undefined }
  } catch {
    return { ok: false, code: why === 'timeout' ? 'timeout' : why === 'aborted' ? 'aborted' : why === 'too-big' ? 'too-big' : 'network' }
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
  }
}
