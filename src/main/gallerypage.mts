// 모음 목록 페이지(docs/packs/index.html) 만들기 (5.5.0, 설계안 §8-3). 색인에서 자동 생성. 서명 대상이 아니고 앱은 읽지 않음 (사람이 읽는 목록)
// 색인이 준 글자는 모두 이스케이프해서 글자로만 쓴다 (링크는 팩 파일 상대 경로뿐, homepage 없음). 영어 먼저, 한국어 병기
import type { GalleryIndex, GalleryPack } from './gallerycore.mts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const day = (iso: string) => iso.slice(0, 10)

function card(p: GalleryPack): string {
  const c = p.caps
  const extra = [c.stream && `live ${c.stream}`, c.form && `input ${c.form}`, c.chart && `chart ${c.chart}`, c.badge && `badge ${c.badge}`, c.autoRun && `auto-run ${c.autoRun}`].filter(Boolean).join(' · ')
  return `<article>
<h3>${esc(p.name.en)} <small>${esc(p.name.ko)}</small> <code>v${esc(p.version)}</code></h3>
<p>${esc(p.desc.en)}<br><span class="ko">${esc(p.desc.ko)}</span></p>
<p class="meta">id <code>${esc(p.id)}</code> · ${esc(p.license)}${p.submitter ? ` · submitted by ${esc(p.submitter)}` : ''}${p.author ? ` · author (self-declared) ${esc(p.author)}` : ''} · reviewed ${esc(day(p.reviewedAt))}${p.minApp ? ` · needs JetDeck ${esc(p.minApp)}+` : ''}</p>
<p class="meta">${c.read + c.change + c.danger} items: ${c.read} read · ${c.change} change · ${c.danger} danger${extra ? ` · ${esc(extra)}` : ''}${p.tags.length ? ` · ${p.tags.map(esc).join(', ')}` : ''}</p>
<p class="meta"><a href="${esc(p.file)}">${esc(p.file.split('/').pop() ?? p.file)}</a> · ${(p.size / 1024).toFixed(1)} KB · sha256 <code>${esc(p.sha256.slice(0, 16))}…</code></p>
</article>`
}

export function renderIndexHtml(idx: GalleryIndex): string {
  const packs = idx.packs.map(card).join('\n') || '<p>No packs yet. <span class="ko">아직 올라온 팩이 없어요.</span></p>'
  const revoked = idx.revoked.length
    ? `<h2>Withdrawn <small>철회됨</small></h2><ul>${idx.revoked.map((r) => `<li><code>${esc(r.id)}</code>${r.version ? ` ${esc(r.version)}` : ''} — ${esc(r.reason.en)} <span class="ko">${esc(r.reason.ko)}</span> (${esc(day(r.at))})</li>`).join('')}</ul>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JetDeck Gallery</title>
<meta name="description" content="Plugin packs reviewed by the JetDeck maintainer. 관리자가 읽어 본 JetDeck 플러그인 팩 목록.">
<style>
:root{--bg:#161a22;--panel:#232a36;--line:#2f3747;--text:#e9edf4;--sub:#9ba6b9;--accent:#a3e06b}
@media (prefers-color-scheme:light){:root{--bg:#f7f8f3;--panel:#fff;--line:#dde2d3;--text:#1c2230;--sub:#58627a;--accent:#4f8a10}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,"Segoe UI","Malgun Gothic",sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 20px 56px}
a{color:var(--accent)}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
article{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0}
h1{margin:.2em 0}h2{margin-top:1.6em}h3{margin:.2em 0}small,.ko,.meta{color:var(--sub)}.meta{font-size:.9em;margin:.3em 0}
.note{border-left:3px solid var(--accent);padding:.2em 14px}
</style>
</head>
<body>
<main>
<h1>JetDeck Gallery <small>모음</small></h1>
<p class="note">Reviewed means the maintainer read the commands. It is <strong>not</strong> a guarantee of safety.<br><span class="ko">검토됨은 관리자가 명령을 읽어 봤다는 뜻이에요. 안전을 보증하지는 않아요.</span></p>
<p>Open JetDeck → Settings → Manage plugins → <strong>Gallery</strong> to install. The app checks the signature of this list and the fingerprint of every file, and you still read and allow the commands before a pack turns on. The files below are the same files the app downloads.<br><span class="ko">설치는 JetDeck → 환경 설정 → 플러그인 관리 → 모음에서 해요. 앱이 목록의 서명과 파일 지문을 확인하고, 켜기 전에 명령을 읽고 허용해야 해요. 아래 파일은 앱이 받는 파일과 같아요.</span></p>
<p class="meta">List serial ${idx.serial} · generated ${esc(day(idx.generatedAt))} · expires ${esc(day(idx.expires))}</p>
<h2>Packs <small>팩</small></h2>
${packs}
${revoked}
<p class="meta">Signature: <a href="index.json.sig">index.json.sig</a> over <a href="index.json">index.json</a> (ed25519).</p>
</main>
</body>
</html>
`
}
