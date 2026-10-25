import type { KeyboardEvent } from 'react'

type Props<T extends string> = {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string // 화면 낭독기용 그룹 이름
  height?: 36 | 40
}

export default function Segment<T extends string>({ options, value, onChange, label, height = 36 }: Props<T>) {
  // 라디오 그룹 표준 키보드: Tab으로 선택된 칸에 들어오고 ←→(↑↓)로 바꿈
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = (options.findIndex((o) => o.value === value) + d + options.length) % options.length
    onChange(options[i].value)
    ;(e.currentTarget.children[i] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="segment" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          style={{ height }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
