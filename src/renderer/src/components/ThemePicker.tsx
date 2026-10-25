import { useRef } from 'react'
import { themeGroups, themeLabel, themeList, type ThemeJson } from '../themes'
import { tr } from '../../../main/i18n.mts'

// 테마 메뉴: 묶음은 모두 접힌 상태로 시작 (열 때마다 다시 접힘)
// 브라우저 기본 popover = 바깥 클릭·Esc로 닫힘, 위치는 버튼 아래 (CSS anchor)
export default function ThemePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const popRef = useRef<HTMLDivElement>(null)
  const current = themeList().find((t) => t.id === value)
  const pick = (id: string) => {
    onChange(id)
    popRef.current?.hidePopover()
  }
  const item = (t: ThemeJson) => (
    <button key={t.id} type="button" className="theme-item" aria-current={t.id === value} onClick={() => pick(t.id)}>
      {themeLabel(t)}
    </button>
  )
  return (
    <>
      <button type="button" className="input theme-btn" popoverTarget="theme-pop" aria-haspopup="dialog" aria-label={tr('테마: {0}', current ? themeLabel(current) : '')}>
        <span>{current ? themeLabel(current) : tr('테마')}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <div
        id="theme-pop"
        ref={popRef}
        popover="auto"
        className="theme-pop"
        role="dialog"
        aria-label={tr('테마 고르기')}
        onToggle={(e) => (e.nativeEvent as ToggleEvent).newState === 'closed' && popRef.current?.querySelectorAll('details').forEach((d) => (d.open = false))}
      >
        {themeGroups().map((g) => (
          <details key={g.label} className="theme-group">
            <summary>
              {g.label} <span className="dim">{g.items.length}</span>
            </summary>
            {g.items.map(item)}
          </details>
        ))}
      </div>
    </>
  )
}
