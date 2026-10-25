import type { InputHTMLAttributes } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  mono?: boolean // IP·포트·경로처럼 코드성 값은 고정폭 글꼴
}

export default function Input({ label, mono, className = '', ...rest }: Props) {
  return (
    <label className="field">
      {label}
      <input className={`input ${mono ? 'mono' : ''} ${className}`} {...rest} />
    </label>
  )
}
