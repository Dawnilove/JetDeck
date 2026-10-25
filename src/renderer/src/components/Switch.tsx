import { tr } from '../../../main/i18n.mts'
type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export default function Switch({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={`${label} ${checked ? tr('끄기') : tr('켜기')}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}
