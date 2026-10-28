import { useEffect, useRef, type ReactNode } from 'react'

// 모달 하나: 닫기는 Esc·버튼. 안쪽 창이 위에 겹쳐 열림(네이티브 dialog 최상위 층). 플러그인 관리·모음이 같이 씀
export default function Modal({ title, wide, onClose, children, foot }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="hk" aria-label={title} style={wide ? { maxWidth: 720 } : undefined} onCancel={(ev) => { ev.preventDefault(); onClose() }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</h1>
      {children}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>{foot}</div>
    </dialog>
  )
}
