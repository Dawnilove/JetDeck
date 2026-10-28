import { useEffect, useState } from 'react'
import { galleryNotes } from '../../../main/gallerynote.mts'
import { getLang, tr } from '../../../main/i18n.mts'
import type { Catalog } from '../../../main/pack'
import type { GalleryInspect } from '../../../main/gallery'
import type { GalleryItem, GalleryView } from '../../../main/galleryflow.mts'
import { trErr } from '../../../main/packerr.mts'
import Button from '../components/Button'
import Input from '../components/Input'
import { errText } from '../util'
import Modal from './PackModal'
import { ExistingNote, lt, PackBody } from './PackUi'

// 플러그인 관리 [모음] 탭 (5.5.0). 목록은 main이 서명을 확인해서 줌. 이 화면은 네트워크를 쓰지 않음
// 색인이 준 글자(이름·설명·제출자·태그)는 모두 글자로만 표시 (링크·HTML 없음)

const capsLine = (c: GalleryItem['caps']) => tr('항목 {0}개: 읽기 {1} · 바꿈 {2} · 위험 {3}', c.read + c.change + c.danger, c.read, c.change, c.danger)

function CapTags({ c }: { c: GalleryItem['caps'] }) {
  return (
    <>
      {c.stream > 0 && <span className="tag">{tr('실시간')}</span>}
      {c.form > 0 && <span className="tag">{tr('입력')}</span>}
      {c.chart > 0 && <span className="tag">{tr('그래프')}</span>}
      {c.badge > 0 && <span className="tag">{tr('배지 {0}', c.badge)}</span>}
      {c.autoRun > 0 && <span className="tag" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>{tr('자동으로 돌아가는 것 {0}', c.autoRun)}</span>}
    </>
  )
}

// 항목을 설치할 수 없는 이유 (항목마다). 목록 전체 상태는 상단 안내
function blockNote(it: GalleryItem): string {
  if (it.block === 'revoked') return `⛔ ${tr('철회됨')}: ${it.revokedReason ? lt(it.revokedReason) : ''}`
  if (it.block === 'app-version') return `⛔ ${tr('JetDeck {0} 이상이 필요해요', it.minApp ?? '')}`
  return ''
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(getLang() === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })

export default function Gallery({ onCatalog, onCancel, onRevoked }: { onCatalog: (c: Catalog) => void; onCancel: () => void; onRevoked: (r: GalleryView['revokedInstalled']) => void }) {
  const [view, setView] = useState<GalleryView | null>(null)
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null) // 팩 파일을 받는 중인 id
  const [rev, setRev] = useState<GalleryInspect | null>(null) // 설치 확인 창
  const [installing, setInstalling] = useState(false)

  const load = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const v0 = await window.api.galleryView()
      setView(v0)
      if (v0.consent) {
        const v = await window.api.galleryRefresh()
        setView(v)
        onRevoked(v.revokedInstalled)
      }
    } catch (e) {
      setMsg({ text: errText(e), err: true })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const agree = async () => {
    setLoading(true)
    try {
      setView(await window.api.galleryConsent(true))
    } catch (e) {
      setMsg({ text: errText(e), err: true })
    }
    await load()
  }

  const inspect = async (id: string) => {
    setReviewing(id)
    setMsg(null)
    try {
      setRev(await window.api.galleryInspect(id))
    } catch (e) {
      setMsg({ text: errText(e), err: true })
    } finally {
      setReviewing(null)
    }
  }
  const closeRev = () => {
    window.api.galleryCancel().catch(() => {})
    setRev(null)
  }
  const install = async (enable: boolean) => {
    if (!rev) return
    setInstalling(true)
    try {
      onCatalog(await window.api.galleryInstall(rev.entry.id, rev.inspect.hash, enable))
      setMsg({ text: enable ? tr('설치하고 켰어요.') : tr('설치했어요. 꺼진 상태예요. 켜려면 허용이 필요해요.') })
      setRev(null)
    } catch (e) {
      setMsg({ text: errText(e), err: true })
      setRev(null)
    } finally {
      setInstalling(false)
    }
  }

  if (!view) return <p className="dim" role="status" style={{ fontSize: 13 }}>{tr('불러오는 중…')}</p>

  if (!view.consent)
    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{tr('모음에서 팩을 받아 볼까요?')}</h2>
        <p style={{ fontSize: 13 }}>{tr('이 화면은 dawnilove.github.io 에서 팩 목록을 내려받아요.')}</p>
        <p style={{ fontSize: 13 }}>{tr('보내는 것: 요청 자체 (내 IP 주소, 시각, 앱 이름과 버전)')}</p>
        <p style={{ fontSize: 13 }}>{tr('보내지 않는 것: 기기 정보, 설치한 팩 목록, 검색어, 사용 기록')}</p>
        <p className="dim" style={{ fontSize: 13 }}>{tr('받은 팩도 허용 창에서 명령을 읽고 허용해야 켜져요.')}</p>
        {msg && <p className="msg-err" role="status" style={{ fontSize: 13 }}>{msg.text}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button size={36} onClick={onCancel}>{tr('취소')}</Button>
          <Button size={36} variant="primary" disabled={loading} onClick={agree}>{tr('계속')}</Button>
        </div>
      </div>
    )

  const needle = q.trim().toLowerCase()
  const shown = view.items.filter((it) => (!readOnly || (it.caps.change === 0 && it.caps.danger === 0)) && (!needle || [lt(it.name), lt(it.desc), it.id, it.submitter ?? '', it.author ?? '', ...it.tags].join(' ').toLowerCase().includes(needle)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <Input label={tr('검색')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('이름·설명·태그 (이 PC에서만 찾아요)')} />
        </div>
        <label className="check">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          {tr('읽기만')}
        </label>
        <Button size={36} onClick={load} disabled={loading}>{tr('새로고침')}</Button>
      </div>
      {loading && <p className="dim" role="status" style={{ fontSize: 13 }}>{tr('목록을 받는 중…')}</p>}
      {!loading && galleryNotes(view, fmtWhen).map((n) => <p key={n.text} className={n.kind === 'err' ? 'msg-err' : 'dim'} role="status" style={{ fontSize: 13, overflowWrap: 'anywhere', color: n.kind === 'warn' ? 'var(--warn)' : undefined }}>{n.kind === 'err' ? '⛔ ' : n.kind === 'warn' ? '⚠ ' : ''}{n.text}</p>)}
      {!loading && view.items.length > 0 && shown.length === 0 && <p className="dim" style={{ fontSize: 13 }}>{tr('찾는 팩이 없어요.')}</p>}
      {msg && <p className={msg.err ? 'msg-err' : 'dim'} role="status" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{msg.text}</p>}
      {shown.map((it) => {
        const note = blockNote(it)
        return (
          <div key={it.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{lt(it.name)}</strong>
              <span className="dim mono" style={{ fontSize: 12 }}>v{it.version}</span>
              <span className="tag">{tr('JetDeck 모음 · 검토됨')}</span>
              {it.submitter && <span className="dim" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{tr('제출')}: {it.submitter}</span>}
              {it.installedVersion && <span className="tag">{tr('설치됨 v{0}', it.installedVersion)}</span>}
              {it.update && <span className="tag" style={{ color: 'var(--accent-text)', borderColor: 'var(--accent-text)' }}>{tr('업데이트 있음')}</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {reviewing === it.id && <Button size={36} onClick={() => window.api.galleryCancel().catch(() => {})}>{tr('취소')}</Button>}
                <Button size={36} variant="primary" disabled={!!it.block || !!reviewing || installing} onClick={() => inspect(it.id)}>
                  {reviewing === it.id ? tr('받는 중…') : tr('내용 보기')}
                </Button>
              </span>
            </div>
            <p className="dim" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{lt(it.desc)}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <span className="dim">{capsLine(it.caps)}</span>
              <CapTags c={it.caps} />
              {it.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
            {note && <p className="msg-err" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{note}</p>}
          </div>
        )
      })}

      {rev && (
        <Modal
          title={tr('"{0}" 팩을 설치할까요?', lt(rev.entry.name))}
          wide
          onClose={closeRev}
          foot={
            <>
              <Button disabled={installing} onClick={closeRev}>{tr('취소')}</Button>
              {rev.inspect.ok && !view.safeMode && (
                <>
                  <Button disabled={installing} onClick={() => install(false)}>{tr('설치만 (꺼진 채)')}</Button>
                  <Button variant="primary" disabled={installing} onClick={() => install(true)}>{tr('허용하고 켜기')}</Button>
                </>
              )}
            </>
          }
        >
          <div className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, fontSize: 13 }}>
            <span>
              <strong>{tr('출처')}</strong> {tr('JetDeck 모음 · 검토됨')}
              {rev.entry.submitter && <> · {tr('제출')}: {rev.entry.submitter}</>}
              {rev.entry.author && <> · {tr('작성자(자칭)')}: {rev.entry.author}</>}
            </span>
            <span><strong>{tr('검토')}</strong> {rev.entry.reviewedAt.slice(0, 10)} {tr('관리자가 명령을 읽어 봤어요. 안전을 보증하지는 않아요.')}</span>
            <span className="mono" style={{ fontSize: 12 }}><strong>{tr('확인')}</strong> {tr('목록 서명 확인됨')} ✔ · {tr('파일 지문')} ✔ {rev.inspect.hash.slice(0, 8)} · v{rev.entry.version}</span>
            <span className="dim" style={{ fontSize: 12 }}>{tr('이름과 작성자는 팩이 직접 적은 글자예요.')}</span>
          </div>
          {rev.inspect.existing && <ExistingNote existing={rev.inspect.existing} />}
          {rev.inspect.errors.length > 0 && (
            <ul className="msg-err" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {rev.inspect.errors.map((p, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{trErr(p)}</li>)}
            </ul>
          )}
          {rev.inspect.pack && <PackBody pack={rev.inspect.pack} hash={rev.inspect.hash} size={rev.inspect.size} changes={rev.inspect.existing?.diff} />}
          <p className="dim" style={{ fontSize: 13 }}>{installing ? tr('설치하는 중…') : tr('"설치만"은 꺼진 채로 들어와요. "허용하고 켜기"는 위 명령을 읽고 허용한 것으로 봐요.')}</p>
        </Modal>
      )}
    </div>
  )
}
