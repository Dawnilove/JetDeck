import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import type { Entry } from '../../../main/sftp'
import { dirChanged, type GitCode, type GitInfo } from '../../../main/gitparse.mts'
import type { JobIn } from '../../../main/transfer'
import { errText } from '../util'
import { getLang, tr } from '../../../main/i18n.mts'
import type { Catalog } from '../../../main/pack'
import type { BadgeResult } from '../../../main/packbadgecore.mts'
import { PACKS_CHANGED } from '../screens/PluginManager'
import { activeBadges, applyResults, chipsFor, covered, dotFor, MAX_CHIPS, tagAt, type BadgeSet } from '../screens/badgeview.mts'

type Props = {
  connId: string
  online: boolean
  home: string
  title: string
  onOpen: (path: string) => void
  onCd: (dir: string) => void // 터미널에서 이 경로 열기
  onRenamed: (from: string, to: string) => void
  onDeleted: (path: string) => void
}

type Editing = { kind: 'newFile' | 'newFolder'; dir: string } | { kind: 'rename'; entry: Entry }
type Menu = { x: number; y: number; entry: Entry | null } // null = 빈 곳(홈 폴더)

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
const GIT_TIP: Record<GitCode, string> = { M: tr('수정됨'), A: tr('추가됨 (스테이지)'), D: tr('삭제됨'), U: tr('새 파일 (추적 안 됨)'), '!': tr('충돌') }

export default function Explorer({ connId, online, home, title, onOpen, onCd, onRenamed, onDeleted }: Props) {
  const [children, setChildren] = useState<Record<string, Entry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')

  // Git: 폴더를 읽을 때 저장소 안이면 브랜치·변경 파일을 같이 읽음 (저장소가 아닌 폴더는 새로고침 전까지 다시 묻지 않음)
  const [repos, setRepos] = useState<Record<string, GitInfo>>({})
  const reposRef = useRef(repos)
  reposRef.current = repos
  const noGit = useRef(new Set<string>())
  const gitAt = useRef<Record<string, number>>({})
  const gitOf = (p: string) => Object.values(repos).find((r) => p === r.top || p.startsWith(r.top === '/' ? '/' : r.top + '/'))
  const loadGit = async (dir: string) => {
    const known = Object.values(reposRef.current).find((r) => dir === r.top || dir.startsWith(r.top + '/'))
    const at = known ? known.top : dir
    if (!known && noGit.current.has(dir)) return
    if (Date.now() - (gitAt.current[at] ?? 0) < 1500) return // 새로고침이 펼친 폴더마다 같은 저장소를 여러 번 묻지 않게
    gitAt.current[at] = Date.now()
    try {
      const g = await window.api.gitStatus(connId, at)
      if (g) setRepos((r) => ({ ...r, [g.top]: g }))
      else noGit.current.add(dir)
    } catch {
      /* git 표시는 덤이라 실패해도 조용히 */
    }
  }

  // 팩 배지(5.3.0): 폴더를 읽을 때 켜진 팩의 배지도 물음. 연결당 한 번에 하나씩, 밀려서 null이 오면 한 번 더 물음
  const [cat, setCat] = useState<Catalog | null>(null)
  const metas = activeBadges(cat)
  const metasRef = useRef(metas)
  metasRef.current = metas
  const badgeSig = metas.map((m) => m.key).join(',')
  const [bset, setBset] = useState<BadgeSet>({})
  const [bnotice, setBnotice] = useState<Record<string, 'unsafe' | 'slow'>>({})
  const bsetRef = useRef(bset)
  bsetRef.current = bset
  const bnone = useRef(new Set<string>())
  const bqueue = useRef<string[]>([])
  const bbusy = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const loadCat = () => window.api.packCatalog().then(setCat, () => setCat(null))
  useEffect(() => {
    loadCat()
    window.addEventListener(PACKS_CHANGED, loadCat)
    return () => window.removeEventListener(PACKS_CHANGED, loadCat)
  }, [])
  const pumpBadges = async () => {
    if (bbusy.current) return
    bbusy.current = true
    try {
      for (let dir = bqueue.current.shift(), retried = false; dir && alive.current; dir = bqueue.current.shift(), retried = false) {
        const keys = metasRef.current.map((m) => m.key)
        if (keys.every((k) => covered(bsetRef.current, bnone.current, k, dir!))) continue
        let rs: BadgeResult[] | null = null
        try {
          rs = await window.api.packBadges(connId, dir)
          if (rs === null && !retried) { // 새 요청에 밀림: 앞 요청이 끝났으니 한 번 더 (엔진 캐시로 바로 답함)
            retried = true
            rs = await window.api.packBadges(connId, dir)
          }
        } catch {
          /* 배지는 덤이라 실패해도 조용히 */
        }
        if (!rs || !alive.current) continue
        const a = applyResults(bsetRef.current, bnone.current, dir, rs)
        bsetRef.current = a.set
        setBset(a.set)
        if (a.notice) setBnotice((n) => ({ ...n, ...a.notice }))
      }
    } finally {
      bbusy.current = false
    }
  }
  const loadBadges = (dir: string) => {
    if (!metasRef.current.length || bqueue.current.includes(dir)) return
    bqueue.current.push(dir)
    pumpBadges()
  }

  const load = async (dir: string) => {
    try {
      const list = await window.api.fsList(connId, dir)
      setChildren((c) => ({ ...c, [dir]: list }))
      setError('')
      loadGit(dir)
      loadBadges(dir)
    } catch (e) {
      setError(errText(e))
    }
  }
  const refresh = () => {
    noGit.current.clear()
    gitAt.current = {}
    bnone.current.clear()
    bsetRef.current = {}
    setBnotice({})
    ;[home, ...expanded].forEach(load)
  }

  useEffect(() => {
    if (online && home) load(home)
  }, [online, home])
  // 켜진 배지가 바뀌면(팩 켬·끔·배지 스위치) 배지 상태를 비우고 열린 폴더를 다시 읽음
  useEffect(() => {
    bnone.current.clear()
    bsetRef.current = {}
    setBset({})
    setBnotice({})
    if (online && home && badgeSig) [home, ...expanded].forEach(loadBadges)
  }, [badgeSig])

  // 메뉴 바깥 클릭·Esc로 닫기. 열리면 첫 항목에 포커스, Esc로 닫으면 원래 행으로 포커스 복귀
  const menuRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      prevFocus.current?.focus()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.delete(dir)) return setExpanded(next)
    next.add(dir)
    setExpanded(next)
    if (!children[dir]) load(dir)
  }

  const openMenu = (e: MouseEvent, entry: Entry | null) => {
    e.preventDefault()
    e.stopPropagation()
    // 키보드(메뉴 키)로 열면 좌표가 0 → 해당 행 위치에 표시
    prevFocus.current = document.activeElement as HTMLElement | null
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ x: e.clientX || r.left + 24, y: e.clientY || r.bottom, entry })
    if (entry) setSelected(entry.path)
  }

  // Enter 뒤에 blur가 또 불려도 한 번만 실행되도록 ref로 확인
  const editingRef = useRef(editing)
  editingRef.current = editing
  const commit = async (name: string) => {
    const ed = editingRef.current
    editingRef.current = null
    setEditing(null)
    if (!ed || !name.trim()) return
    try {
      if (ed.kind === 'rename') {
        const to = await window.api.fsRename(connId, ed.entry.path, name)
        await load(dirOf(ed.entry.path))
        onRenamed(ed.entry.path, to)
      } else {
        const path = ed.kind === 'newFile' ? await window.api.fsNewFile(connId, ed.dir, name) : await window.api.fsNewFolder(connId, ed.dir, name)
        await load(ed.dir)
        setSelected(path)
        if (ed.kind === 'newFile') onOpen(path)
      }
    } catch (e) {
      setError(errText(e))
    }
  }

  const remove = async (entry: Entry) => {
    if (!confirm(tr("'{0}'을(를) Device에서 삭제할까요? 되돌릴 수 없어요.", entry.name))) return
    try {
      await window.api.fsDelete(connId, entry.path, entry.dir)
      await load(dirOf(entry.path))
      onDeleted(entry.path)
    } catch (e) {
      setError(errText(e))
    }
  }

  // 우클릭 업로드·다운로드: 파일 전송 대기열에 넣음 (진행·취소는 '파일 전송' 화면)
  const [info, setInfo] = useState('')
  const send = async (jobs: JobIn[]) => {
    try {
      const dup = await window.api.xferConflicts(connId, jobs)
      if (dup.length && !confirm(tr('이미 있는 파일 {0}개를 덮어쓸까요?\n\n{1}', dup.length, dup.slice(0, 8).join('\n') + (dup.length > 8 ? '\n…' : '')))) return
      await window.api.xferAdd(connId, jobs)
      setError('')
      setInfo(tr("전송 대기열에 {0}개 넣었어요 · 진행은 '파일 전송' 화면에서", jobs.length))
    } catch (e) {
      setError(errText(e))
    }
  }
  const upload = async (dir: string, folder = false) => {
    const files = await window.api.pickUpload(folder)
    if (files.length) send(files.map((f) => ({ kind: 'up', src: f.path, dstDir: dir, name: f.name, size: f.size })))
  }
  const download = async (e: Entry) => {
    const dir = await window.api.pickDownloadDir()
    if (dir) send([{ kind: 'down', src: e.path, dstDir: dir, name: e.name, size: e.size }])
  }
  // 이 연결로 올린 파일이 끝나면 그 폴더 목록을 새로 읽음
  useEffect(
    () =>
      window.api.onXfer((ev) => {
        if (ev.connId !== connId || ev.status !== 'done' || ev.job.kind !== 'up') return
        load(ev.job.dstDir)
        setInfo('')
      }),
    [connId]
  )

  const startNew = (kind: 'newFile' | 'newFolder', dir: string) => {
    if (dir !== home && !expanded.has(dir)) toggle(dir)
    setEditing({ kind, dir })
  }

  const nameInput = (depth: number, initial = '') => (
    <input
      className="tree-input"
      style={{ marginLeft: 12 + depth * 14 + 18 }}
      autoFocus
      defaultValue={initial}
      aria-label={tr('이름')}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') setEditing(null)
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  )

  // 트리 키보드 이동: ↑↓ 행 이동, → 폴더 펼치기, ← 접기 (Enter는 버튼 클릭과 같음)
  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.tree-row')]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const { path = '', dir } = rows[i].dataset
      if (dir && expanded.has(path) !== (e.key === 'ArrowRight')) {
        e.preventDefault()
        toggle(path)
      }
    }
  }
  // 메뉴 안 ↑↓ 이동 (끝에서 반대쪽으로 돎)
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  const renderDir = (dir: string, depth: number) => (
    <>
      {editing && editing.kind !== 'rename' && editing.dir === dir && nameInput(depth)}
      {!children[dir] && <p className="dim ws-empty" style={{ paddingLeft: 12 + depth * 14 + 18 }}>{tr('불러오는 중…')}</p>}
      {children[dir]?.length === 0 && !(editing && editing.kind !== 'rename' && editing.dir === dir) && (
        <p className="dim ws-empty" style={{ paddingLeft: 12 + depth * 14 + 18 }}>{tr('(비어 있음)')}</p>
      )}
      {(children[dir] ?? []).map((e) => (
        <div key={e.path}>
          {editing?.kind === 'rename' && editing.entry.path === e.path ? (
            nameInput(depth, e.name)
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-expanded={e.dir ? expanded.has(e.path) : undefined}
              aria-selected={selected === e.path}
              className="tree-row"
              data-path={e.path}
              data-dir={e.dir ? '1' : undefined}
              style={{ paddingLeft: 12 + depth * 14 }}
              title={e.path}
              onClick={() => {
                setSelected(e.path)
                if (e.dir) toggle(e.path)
                else onOpen(e.path)
              }}
              onContextMenu={(ev) => openMenu(ev, e)}
            >
              <span className="tree-caret">{e.dir ? (expanded.has(e.path) ? '▾' : '▸') : ''}</span>
              <span className={`tree-icon ${e.dir ? 'dir' : ''}`} />
              {(() => {
                const g = gitOf(e.path)
                const code = g?.files[e.path]
                const mark = code ?? (e.dir && g && dirChanged(g, e.path) ? 'M' : undefined)
                const chips = chipsFor(bset, e.path, mark ? [code ?? '●'] : []).slice(0, MAX_CHIPS - (mark ? 1 : 0))
                const tg = tagAt(bset, e.path)
                const dot = e.dir && !mark && chips.length === 0 && dotFor(bset, metas, e.path)
                const note = e.dir ? bnotice[e.path] : undefined
                const label = (k: string) => { const m = metas.find((x) => x.key === k); return m ? m.label[getLang()] : k }
                return (
                  <>
                    <span className={`tree-name ${mark ? `git-${mark}` : ''}`}>{e.name}</span>
                    {g && e.path === g.top && (
                      <span className="tree-branch" title={tr('Git 브랜치: {0}', g.branch)}>
                        ⎇ {g.branch}{g.ahead > 0 && ` ↑${g.ahead}`}{g.behind > 0 && ` ↓${g.behind}`}
                      </span>
                    )}
                    {tg && <span className="tree-branch" title={`${label(tg.key)}: ${tg.tag}`}>{tg.tag}</span>}
                    {note && <span className="tree-git badge-dim" title={note === 'unsafe' ? tr('이 저장소의 설정이 위험해서 배지를 건너뛰었어요') : tr('느려서 멈췄어요')}>⚠</span>}
                    {chips.map((c, i) => <span key={c.key} className={`tree-git badge-${c.tone}`} title={`${label(c.key)}: ${c.text[getLang()]}`}>{c.show}</span>)}
                    {dot && <span className="tree-git badge-dim" title={tr('안에 배지가 있는 파일이 있어요')}>●</span>}
                    {mark && <span className={`tree-git git-${mark}`} title={code ? GIT_TIP[code] : tr('안에 바뀐 파일이 있어요')}>{code ?? '●'}</span>}
                  </>
                )
              })()}
            </button>
          )}
          {e.dir && expanded.has(e.path) && renderDir(e.path, depth + 1)}
        </div>
      ))}
    </>
  )

  const m = menu?.entry
  const items: [string, () => void][] = !menu
    ? []
    : m && !m.dir
      ? [
          [tr('내 PC로 다운로드…'), () => download(m)],
          [tr('이름 바꾸기'), () => setEditing({ kind: 'rename', entry: m })],
          [tr('삭제'), () => remove(m)],
          [tr('터미널에서 이 폴더 열기'), () => onCd(dirOf(m.path))]
        ]
      : [
          [tr('여기에 업로드…'), () => upload(m?.path ?? home)],
          [tr('여기에 폴더 업로드…'), () => upload(m?.path ?? home, true)],
          ...(m ? ([[tr('내 PC로 폴더 다운로드…'), () => download(m)]] as [string, () => void][]) : []),
          [tr('새 파일'), () => startNew('newFile', m?.path ?? home)],
          [tr('새 폴더'), () => startNew('newFolder', m?.path ?? home)],
          ...(m ? ([[tr('이름 바꾸기'), () => setEditing({ kind: 'rename', entry: m })], [tr('삭제'), () => remove(m)]] as [string, () => void][]) : []),
          [tr('터미널에서 이 폴더 열기'), () => onCd(m?.path ?? home)],
          [tr('새로고침'), refresh]
        ]

  return (
    <>
      <div className="ws-side-head">
        <span>{tr('탐색기 · {0}', title)}</span>
        <button type="button" className="tree-refresh" aria-label={tr('새로고침')} title={tr('새로고침')} disabled={!online} onClick={refresh}>↻</button>
      </div>
      <div role="tree" aria-label={tr('원격 파일')} className="tree" onKeyDown={onTreeKey} onContextMenu={(e) => online && home && openMenu(e, null)}>
        {!online && <p className="dim ws-empty">{tr('연결되면 파일 목록이 보여요.')}</p>}
        {online && home && renderDir(home, 0)}
        {error && <p className="msg-err ws-empty">{error}</p>}
        {info && !error && <p className="dim ws-empty" role="status">{info}</p>}
      </div>
      {menu && (
        <div ref={menuRef} role="menu" className="ctx-menu" style={{ left: menu.x, top: menu.y }} onKeyDown={onMenuKey}>
          {items.map(([label, fn]) => (
            <button key={label} type="button" role="menuitem" className={label === tr('삭제') ? 'danger' : ''} onClick={fn}>
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
