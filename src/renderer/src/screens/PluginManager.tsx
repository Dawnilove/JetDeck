import { useEffect, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { Catalog } from '../../../main/pack'
import { trErr } from '../../../main/packerr.mts'
import type { GalleryView } from '../../../main/galleryflow.mts'
import type { Inspect, PackEntry } from '../../../main/packstore.mts'
import { summarizePack } from '../../../main/packschema.mts'
import Button from '../components/Button'
import Segment from '../components/Segment'
import Switch from '../components/Switch'
import { errText } from '../util'
import Gallery from './Gallery'
import Modal from './PackModal'
import { ExistingNote, lt, PackBody } from './PackUi'

// 켜진 팩이 바뀌었음을 활동 막대·팔레트에 알림 (Workspace가 듣고 다시 읽음)
export const PACKS_CHANGED = 'jetdeck:packs-changed'

type Sub = { kind: 'view'; e: PackEntry } | { kind: 'allow'; e: PackEntry } | { kind: 'install'; ins: Inspect } | { kind: 'remove'; e: PackEntry }

const statusNote = (e: PackEntry): string => {
  if (e.status === 'conflict') return tr('같은 id의 팩 파일이 여러 개예요. 폴더에서 정리한 뒤 다시 시도하세요')
  if (e.status === 'unreadable' || e.status === 'too-big') return tr('파일을 읽을 수 없어요')
  if (e.status === 'invalid') return tr('문제가 있는 팩은 켤 수 없어요')
  if (e.approval === 'changed') return tr('파일이 바뀌었어요 → 다시 허용해야 켤 수 있어요')
  if (e.approval === 'new') return tr('허용 필요')
  return ''
}

export default function PluginManager({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<Catalog | null>(null)
  const [sub, setSub] = useState<Sub | null>(null)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [revoked, setRevoked] = useState<GalleryView['revokedInstalled']>([])
  const [tab, setTab] = useState<'mine' | 'gallery'>('mine')

  const apply = (c: Catalog) => {
    setCat(c)
    window.dispatchEvent(new Event(PACKS_CHANGED))
  }
  const act = async (f: () => Promise<Catalog | null>, ok?: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const c = await f()
      if (c) apply(c)
      if (ok) setMsg({ text: ok })
    } catch (e) {
      setMsg({ text: errText(e), err: true })
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    act(() => window.api.packRescan()) // 화면을 열 때 폴더를 한 번 훑음
    window.api.galleryCached().then((v) => setRevoked(v.revokedInstalled)).catch(() => {}) // 저장해 둔 목록만 봄 (네트워크 없음)
  }, [])

  const toggle = (e: PackEntry) => {
    if (e.enabled) return act(() => window.api.packEnable(e.id, false))
    if (e.source === 'user' && e.approval !== 'approved') return setSub({ kind: 'allow', e }) // 처음·바뀐 뒤: 허용 창
    return act(() => window.api.packEnable(e.id, true))
  }
  const pick = async () => {
    setMsg(null)
    try {
      const ins = await window.api.packPick()
      if (ins) setSub({ kind: 'install', ins })
    } catch (e) {
      setMsg({ text: errText(e), err: true })
    }
  }

  const official = (cat?.entries ?? []).filter((e) => e.source === 'official' && e.id !== 'examples')
  const examples = (cat?.entries ?? []).filter((e) => e.source === 'official' && e.id === 'examples')
  const mine = (cat?.entries ?? []).filter((e) => e.source === 'user')

  const row = (e: PackEntry) => {
    const note = statusNote(e)
    const name = e.pack ? lt(e.pack.name) : e.fileName
    const problems = [...e.errors, ...e.warnings]
    return (
      <div key={e.fileName + e.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{name}</strong>
          {e.pack && <span className="dim mono" style={{ fontSize: 12 }}>v{e.pack.version}</span>}
          {e.pack?.author && <span className="dim" style={{ fontSize: 12 }}>{tr('작성자')}: {e.pack.author}</span>}
          <span className="tag">{e.source === 'official' ? tr('공식') : e.origin ? tr('모음') : tr('직접 설치')}</span>
          {e.pack && summarizePack(e.pack).stream > 0 && <span className="tag">{tr('실시간')}</span>}
          {e.pack && summarizePack(e.pack).form > 0 && <span className="tag">{tr('입력')}</span>}
          {e.pack && summarizePack(e.pack).chart > 0 && <span className="tag">{tr('그래프')}</span>}
          {e.pack && summarizePack(e.pack).badge > 0 && <span className="tag">{tr('배지 {0}', summarizePack(e.pack).badge)}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {e.pack && <Button size={36} onClick={() => setSub({ kind: 'view', e })}>{tr('내용 보기')}</Button>}
            {e.source === 'user' && e.file && <Button size={36} onClick={() => setSub({ kind: 'remove', e })}>{tr('제거')}</Button>}
            <Button size={36} variant={e.enabled ? 'secondary' : 'primary'} disabled={busy || (!e.enabled && (e.status !== 'ok' || !e.pack))} onClick={() => toggle(e)}>
              {e.enabled ? tr('끄기') : tr('켜기')}
            </Button>
          </span>
        </div>
        <span style={{ fontSize: 12 }} className={e.enabled ? '' : 'dim'}>{e.enabled ? tr('켜짐') : tr('꺼짐')}{note && <> · <span className={e.approval === 'changed' || e.status !== 'ok' ? 'msg-err' : ''}>{e.approval === 'changed' ? '⚠ ' : ''}{note}</span></>}</span>
        {e.origin && e.pack && revoked.filter((r) => r.id === e.id && r.version === e.pack!.version).map((r) => (
          <p key={r.id} className="msg-err" role="alert" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>⛔ {tr('철회됨')} — {tr('관리자가 모음에서 내렸어요')}: "{lt(r.reason)}" {tr('아직 켜져 있을 수 있어요. 끄거나 제거해 주세요.')}</p>
        ))}
        {e.pack?.desc && <p className="dim" style={{ fontSize: 13 }}>{lt(e.pack.desc)}</p>}
        {e.pack?.badges && e.pack.badges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <Switch
              label={tr('탐색기 배지')}
              checked={e.pack.badges.some((b) => !e.badgesOff.includes(b.id))}
              onChange={(on) => { const ids = e.pack!.badges!.map((b) => b.id); act(() => window.api.packBadgesOff(e.id, on ? [] : ids)) }}
            />
            <span>{tr('탐색기 배지')}</span>
            <span className="dim" style={{ fontSize: 12 }}>{tr('폴더를 열 때 자동으로 실행해요. 끄면 팩은 켜 둔 채 배지만 멈춰요')}</span>
          </div>
        )}
        {problems.length > 0 && (
          <details>
            <summary className="dim" style={{ fontSize: 12, cursor: 'pointer' }}>{tr('문제 {0}개', problems.length)}</summary>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {problems.map((p, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{trErr(p)}</li>)}
            </ul>
          </details>
        )}
      </div>
    )
  }
  const section = (title: string, list: PackEntry[], empty?: string) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="caption">{title}</span>
      {list.length ? list.map(row) : empty && <p className="dim" style={{ fontSize: 13 }}>{empty}</p>}
    </section>
  )

  return (
    <>
      <Modal
        title={tr('플러그인 관리')}
        wide
        onClose={onClose}
        foot={
          tab === 'gallery' ? (
            <Button size={36} variant="primary" onClick={onClose}>{tr('닫기')}</Button>
          ) : (
          <>
            <Button size={36} onClick={pick} disabled={busy}>{tr('팩 설치…')}</Button>
            <Button size={36} onClick={() => act(() => window.api.packRescan())} disabled={busy}>{tr('다시 읽기')}</Button>
            <Button size={36} onClick={() => window.api.packOpenDir().catch((e) => setMsg({ text: errText(e), err: true }))}>{tr('폴더 열기')}</Button>
            <Button size={36} variant="primary" onClick={onClose}>{tr('닫기')}</Button>
          </>
          )
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '60vh' }}>
          <Segment label={tr('플러그인 관리')} value={tab} onChange={setTab} options={[{ value: 'mine', label: tr('내 팩') }, { value: 'gallery', label: tr('모음') }]} />
          {tab === 'gallery' ? <Gallery onCatalog={apply} onCancel={() => setTab('mine')} onRevoked={setRevoked} /> : <>
          <p className="dim" style={{ fontSize: 13 }}>{tr('플러그인은 JSON 파일에 적은 명령을 Device에서 실행해요. 이 PC에서 코드를 실행하지 않아요. 켜기 전에 명령 전문을 확인할 수 있어요.')}</p>
          {cat?.safeMode && <p className="msg-err" role="status" style={{ fontSize: 13 }}>{tr('안전 모드예요. 내가 설치한 팩은 읽지 않아요.')}</p>}
          {msg && <p className={msg.err ? 'msg-err' : 'dim'} role="status" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{msg.text}</p>}
          {section(tr('공식 (앱에 포함)'), official)}
          {section(tr('내가 설치한 팩'), mine, cat?.safeMode ? undefined : tr('설치한 팩이 없어요. "팩 설치…"를 누르거나 폴더에 파일을 넣고 "다시 읽기"를 눌러 주세요.'))}
          {examples.length > 0 && section(tr('예제'), examples)}
          </>}
        </div>
      </Modal>

      {sub?.kind === 'view' && sub.e.pack && (
        <Modal title={lt(sub.e.pack.name)} wide onClose={() => setSub(null)} foot={<Button size={36} variant="primary" onClick={() => setSub(null)}>{tr('닫기')}</Button>}>
          <PackBody pack={sub.e.pack} hash={sub.e.hash} size={sub.e.size} changes={sub.e.changes} />
        </Modal>
      )}
      {sub?.kind === 'allow' && sub.e.pack && (
        <Modal
          title={tr('"{0}" 팩을 켤까요?', lt(sub.e.pack.name))}
          wide
          onClose={() => setSub(null)}
          foot={
            <>
              <Button onClick={() => setSub(null)}>{tr('취소')}</Button>
              <Button variant="primary" disabled={busy} onClick={() => { const e = sub.e; setSub(null); act(() => window.api.packEnable(e.id, true, e.hash)) }}>{tr('허용하고 켜기')}</Button>
            </>
          }
        >
          {sub.e.approval === 'changed' && <p className="msg-err" style={{ fontSize: 13 }}>⚠ {tr('허용한 뒤 파일이 바뀌었어요. 아래에서 바뀐 명령을 확인해 주세요.')}</p>}
          <p style={{ fontSize: 13 }}>{tr('이 팩은 연결된 Device에서 아래 명령을 실행할 수 있어요.')}</p>
          <PackBody pack={sub.e.pack} hash={sub.e.hash} size={sub.e.size} changes={sub.e.changes} />
          <p className="dim" style={{ fontSize: 13 }}>{tr('바꾸는 항목은 실행할 때마다 다시 물어봐요. 켠 뒤에도 언제든 끌 수 있어요.')}</p>
        </Modal>
      )}
      {sub?.kind === 'install' && (
        <Modal
          title={sub.ins.pack ? tr('"{0}" 팩을 설치할까요?', lt(sub.ins.pack.name)) : tr('설치할 수 없는 팩이에요')}
          wide
          onClose={() => setSub(null)}
          foot={
            <>
              <Button onClick={() => setSub(null)}>{tr('취소')}</Button>
              {sub.ins.ok && <Button variant="primary" disabled={busy} onClick={() => { const h = sub.ins.hash; setSub(null); act(() => window.api.packInstall(h), tr('설치했어요. 꺼진 상태예요. 켜려면 허용이 필요해요.')) }}>{tr('설치')}</Button>}
            </>
          }
        >
          {sub.ins.existing && <ExistingNote existing={sub.ins.existing} />}
          {sub.ins.errors.length > 0 && (
            <ul className="msg-err" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {sub.ins.errors.map((p, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{trErr(p)}</li>)}
            </ul>
          )}
          {sub.ins.pack && <PackBody pack={sub.ins.pack} hash={sub.ins.hash} size={sub.ins.size} changes={sub.ins.existing?.diff} />}
          <p className="dim" style={{ fontSize: 13 }}>{tr('설치해도 꺼진 채로 들어와요. 켤 때 한 번 더 허용을 받아요.')}</p>
        </Modal>
      )}
      {sub?.kind === 'remove' && (
        <Modal
          title={tr('팩을 제거할까요?')}
          onClose={() => setSub(null)}
          foot={
            <>
              <Button onClick={() => setSub(null)}>{tr('취소')}</Button>
              <Button variant="warn" disabled={busy} onClick={() => { const id = sub.e.id; setSub(null); act(() => window.api.packRemove(id), tr('휴지통으로 옮겼어요.')) }}>{tr('제거')}</Button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>{tr('팩 파일을 휴지통으로 옮겨요. 영구 삭제가 아니에요.')}</p>
          <code className="hk-code" style={{ overflowWrap: 'anywhere' }}>{sub.e.fileName}</code>
        </Modal>
      )}
    </>
  )
}
