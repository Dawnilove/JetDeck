import type { ReactNode } from 'react'

type Props = {
  title?: string
  small?: boolean // 사이드 패널용: 모서리 10px, 여백 20px
  children: ReactNode
}

export default function Card({ title, small, children }: Props) {
  return (
    <section className={`card ${small ? 'card-sm' : ''}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  )
}
