import { useMemo, useState } from 'react'
import type { Hit, SearchOpts } from '../../../main/searchparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 원격 파일 검색·전체 바꾸기: Device의 grep으로 찾고, 바꾸기는 편집기와 같은 길(충돌 확인·원자적 저장)로 저장
type Props = {
  connId: string
  online: boolean
  home: string
  onOpen: (path: string, line: number) => void
}
type Found = { hits: Hit[]; truncated: boolean; query: string; opts: SearchOpts } // 검색할 때의 값 (바꾸기는 화면에 지금 적힌 값이 아니라 이 값으로)

export default function Search({ connId, online, home, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [repl, setRepl] = useState('')
  const [dir, setDir] = useState('')
  const [opts, setOpts] = useState<SearchOpts>({ regex: false, matchCase: false })
  const [found, setFound] = useState<Found | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set()) // 바꾸기에서 뺀 파일
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const folder = dir.trim() || home

  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>()
    for (const h of found?.hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h])
    return [...m]
  }, [found])
  const show = (p: string) => (p.startsWith(home + '/') ? '~' + p.slice(home.length) : p)

  const search = async () => {
    setError('')
    setMsg('')
    if (!query) return
    if (opts.regex) {
      try {
        new RegExp(query)
      } catch {
        return setError(tr('정규식 형식이 올바르지 않아요'))
      }
    }
    setBusy(true)
    try {
      const r = await window.api.searchGrep(connId, folder, query, opts)
      setFound({ ...r, query, opts })
      setSkip(new Set())
    } catch (e) {
      setFound(null)
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const replaceAll = async () => {
    if (!found) return
    const paths = groups.map(([p]) => p).filter((p) => !skip.has(p))
    if (!paths.length) return
    const ask = tr('{0}개 파일에서 "{1}"을(를) "{2}"(으)로 바꿔 저장할까요?\n\n되돌릴 수 없어요. 편집기에 열려 있는 파일은 닫았다가 다시 열어야 바뀐 내용이 보여요.', paths.length, found.query, repl)
    if (!confirm(ask)) return
    setBusy(true)
    setError('')
    try {
      const r = await window.api.searchReplace(connId, paths, found.query, repl, found.opts)
      const fail = r.failed.map((f) => `${show(f.path)}: ${f.error}`).join('\n')
      await search()
      setMsg(tr('{0}개 파일에서 {1}곳을 바꿨어요', r.files, r.matches) + (fail ? '\n' + tr('못 바꾼 파일 {0}개', r.failed.length) + '\n' + fail : ''))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const canReplace = online && !busy && !!found && groups.length > skip.size && !!found.query
  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('검색 결과')}>
        <PanelHead title={tr('파일 검색·바꾸기')} desc={<Desc>{tr('Device의 폴더 안 글자를 찾아요. .git·build·install·log·node_modules 폴더는 건너뛰어요.')}</Desc>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <input
              className="input mono"
              style={{ flex: '2 1 220px', height: 40 }}
              placeholder={tr('찾을 글자')}
              aria-label={tr('찾을 글자')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && online && !busy && search()}
            />
            <input className="input mono" style={{ flex: '1 1 160px', height: 40 }} placeholder={home || tr('폴더')} aria-label={tr('찾을 폴더')} value={dir} onChange={(e) => setDir(e.target.value)} />
            <Button size={40} variant="primary" disabled={!online || busy || !query} onClick={search}>{busy ? tr('찾는 중…') : tr('찾기')}</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <input
              className="input mono"
              style={{ flex: '2 1 220px', height: 40 }}
              placeholder={tr('바꿀 글자 (비우면 지워요)')}
              aria-label={tr('바꿀 글자')}
              value={repl}
              onChange={(e) => setRepl(e.target.value)}
            />
            <Button size={40} variant="warn" disabled={!canReplace} onClick={replaceAll}>{tr('전체 바꾸기')}</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={opts.matchCase} onChange={(e) => setOpts({ ...opts, matchCase: e.target.checked })} />
              {tr('대소문자 구분')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={opts.regex} onChange={(e) => setOpts({ ...opts, regex: e.target.checked })} />
              {tr('정규식')}
            </label>
          </div>
        </div>
        <div className="ros-items" aria-label={tr('검색 결과')}>
          {!online && <Note>{tr('연결되면 검색할 수 있어요.')}</Note>}
          {error && <Note err>{error}</Note>}
          {msg && <p className="dim mono fw-empty" role="status" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{msg}</p>}
          {online && found && !groups.length && !busy && <Note>{tr('찾는 글자가 없어요.')}</Note>}
          {online && found && groups.length > 0 && (
            <p className="dim fw-empty" role="status">
              {tr('{0}개 파일 · {1}줄', groups.length, found.hits.length)}
              {found.truncated && ` · ${tr('결과가 많아 앞쪽만 보여요')}`}
            </p>
          )}
          {online && groups.map(([path, hits]) => (
            <div key={path}>
              <label className="ros-item mono" style={{ background: 'var(--panel-2)', cursor: 'pointer' }} title={tr('체크를 빼면 전체 바꾸기에서 제외돼요')}>
                <input
                  type="checkbox"
                  checked={!skip.has(path)}
                  onChange={(e) => setSkip((s) => (e.target.checked ? new Set([...s].filter((x) => x !== path)) : new Set(s).add(path)))}
                />
                <span style={{ overflowWrap: 'anywhere' }}>{show(path)}</span>
                <span className="dim ros-type">{tr('{0}줄', hits.length)}</span>
              </label>
              {hits.map((h) => (
                <button key={h.line} type="button" className="ros-item" onClick={() => onOpen(h.path, h.line)}>
                  <span className="dim mono" style={{ minWidth: 44, textAlign: 'right' }}>{h.line}</span>
                  <span className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{h.text.trim()}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
