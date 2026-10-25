import { useEffect, useMemo, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import { fuzzy } from '../screens/uifmt.mts'

export type PaletteItem = { id: string; title: string; detail?: string; shortcut?: string; run: () => void }
type Props = {
  mode: 'cmd' | 'file'
  items: PaletteItem[]
  loading?: boolean
  initialQuery?: string
  onClose: () => void
}


export default function Palette({ mode, items, loading, initialQuery = '', onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState(initialQuery)
  const [sel, setSel] = useState(0)
  // 네이티브 <dialog>: 포커스 가두기·Esc 처리를 브라우저가 해 줌
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const shown = useMemo(() => {
    if (!q.trim()) return items.slice(0, 200)
    // 파일 모드는 경로 전체로, 명령 모드는 제목+명령으로 검색
    return items
      .map((it) => ({ it, s: fuzzy(q, mode === 'file' ? (it.detail ?? it.title) : `${it.title} ${it.detail ?? ''}`) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .slice(0, 200)
      .map((x) => x.it)
  }, [items, q, mode])

  useEffect(() => setSel(0), [q])
  // 중괄호 필수: 최신 Chromium의 scrollIntoView는 Promise를 반환 → 그대로 반환하면 React가 정리 함수로 오인해 화면이 깨짐
  useEffect(() => {
    document.getElementById(`pal-${sel}`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (it: PaletteItem) => {
    onClose()
    it.run()
  }

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={mode === 'file' ? tr('파일 열기') : tr('명령 팔레트')}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()} // 바깥(배경) 클릭으로 닫기
    >
      <div className="pal-input">
        <span className="mono" aria-hidden="true">{mode === 'file' ? '⌕' : '>'}</span>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={shown[sel] ? `pal-${sel}` : undefined}
          aria-label={mode === 'file' ? tr('파일 이름 검색') : tr('명령 검색')}
          placeholder={mode === 'file' ? tr('파일 이름으로 찾기 (홈 폴더 기준)') : tr('명령 검색 · 파일은 Ctrl+P')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, shown.length - 1))
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
            else if (e.key === 'Enter' && shown[sel]) choose(shown[sel])
            else return
            e.preventDefault()
          }}
        />
      </div>
      <div id="pal-list" role="listbox" className="pal-list">
        {shown.map((it, i) => (
          <button
            key={it.id}
            id={`pal-${i}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={i === sel}
            className="pal-row"
            onMouseMove={() => i !== sel && setSel(i)}
            onClick={() => choose(it)}
          >
            <span className="pal-text">
              <span>{it.title}</span>
              {it.detail && <span className="mono dim">{it.detail}</span>}
            </span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ))}
        {shown.length === 0 && <p className="dim pal-empty">{loading ? tr('파일 목록을 불러오는 중…') : tr('일치하는 항목이 없어요')}</p>}
      </div>
    </dialog>
  )
}
