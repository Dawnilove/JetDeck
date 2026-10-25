import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'filled' | 'warn' | 'dashed' | 'ghost'
  size?: 44 | 40 | 36 // 높이(px). 기본 44 = 최소 터치 영역
}

export default function Button({ variant = 'secondary', size = 44, className = '', ...rest }: Props) {
  return <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />
}
