import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'

export type Tab = { id: string; name: string; status: 'online' | 'connecting' | 'offline'; splittable: boolean }

// 탭을 작업 화면으로 끌어다 놓으면 분할에 추가됨 (App의 panes 영역이 이 값을 받음)
export const TAB_DRAG = 'application/x-jetdeck-tab'
export const MAX_PANES = 4

type Props = {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  splitIds: string[] // 지금 분할 화면에 들어 있는 연결 (분할이 없으면 빈 배열)
  grid: boolean
  onToggleSplit: (id: string) => void
  onGrid: (grid: boolean) => void
  onUnsplit: () => void
}

export default function Tabs({ tabs, activeId, onSelect, onClose, onAdd, splitIds, grid, onToggleSplit, onGrid, onUnsplit }: Props) {
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    addEventListener('mousedown', off)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('mousedown', off)
      removeEventListener('keydown', esc)
    }
  }, [menu])
  const splittable = tabs.filter((t) => t.splittable)

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId
        const inSplit = splitIds.includes(t.id)
        return (
          <div
            key={t.id}
            className={`tab ${active ? 'active' : ''} ${inSplit ? 'in-split' : ''}`}
            draggable={t.splittable}
            onDragStart={(e) => {
              e.dataTransfer.setData(TAB_DRAG, t.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            title={t.splittable ? tr('작업 화면으로 끌어다 놓으면 분할돼요') : undefined}
          >
            <button type="button" role="tab" aria-selected={active} className="tab-label" onClick={() => onSelect(t.id)}>
              <span className={`dot ${t.status}`} />
              {t.name}
              {inSplit && <span className="tab-split-mark" aria-label={tr('분할 중')} title={tr('분할 화면에 들어 있어요')}>▦</span>}
            </button>
            {/* 선택하지 않은 탭도 바로 닫을 수 있게 모든 탭에 표시 */}
            <button type="button" className="tab-close" aria-label={tr('{0} 닫기', t.name)} onClick={() => onClose(t.id)}>
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
        )
      })}
      <button type="button" className="tab-add" aria-label={tr('새 연결')} onClick={onAdd}>
        +
      </button>
      {splittable.length > 1 && (
        <div className="split-menu" ref={box}>
          <button type="button" className="ws-mini" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            ▦ {tr('분할')}{splitIds.length > 1 ? ` ${splitIds.length}` : ''} ▾
          </button>
          {menu && (
            <div className="split-pop" role="menu">
              <p className="dim" style={{ fontSize: 12 }}>{tr('한 화면에 같이 볼 연결 (최대 {0}개) · 탭을 끌어다 놓아도 돼요', MAX_PANES)}</p>
              {splittable.map((t) => {
                const on = splitIds.includes(t.id)
                const full = !on && splitIds.length >= MAX_PANES
                return (
                  <label key={t.id} className="check" style={full ? { opacity: 0.5 } : undefined}>
                    <input type="checkbox" checked={on} disabled={full} onChange={() => onToggleSplit(t.id)} />
                    <span className={`dot ${t.status}`} style={{ width: 7, height: 7 }} />
                    {t.name}
                  </label>
                )
              })}
              <div className="split-row" role="radiogroup" aria-label={tr('배열')}>
                <button type="button" role="radio" aria-checked={!grid} className={`ws-mini ${!grid ? 'on' : ''}`} onClick={() => onGrid(false)}>{tr('좌우로 나열')}</button>
                <button type="button" role="radio" aria-checked={grid} className={`ws-mini ${grid ? 'on' : ''}`} onClick={() => onGrid(true)}>{tr('바둑판')}</button>
              </div>
              {splitIds.length > 1 && (
                <button type="button" className="ws-mini" onClick={() => (onUnsplit(), setMenu(false))}>{tr('분할 해제')}</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
