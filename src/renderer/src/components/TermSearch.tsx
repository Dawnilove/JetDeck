import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import { findAll, type Hit } from '../screens/termsearch.mts'
import { terms } from './Terminal'

// 터미널 출력 검색 (4.4.0): xterm 버퍼(스크롤백 포함)에서 찾아 선택 표시. 줄바꿈으로 이어진 줄에 걸친 일치는 못 찾음 (shortcut: 필요하면 isWrapped 줄을 합쳐 찾기)
export function bufferLines(id: string): string[] {
  const buf = terms.get(id)?.buffer.active
  if (!buf) return []
  return Array.from({ length: buf.length }, (_, i) => buf.getLine(i)?.translateToString(true) ?? '')
}

export default function TermSearch({ id, onClose }: { id: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const show = (hs: Hit[], i: number) => {
    const term = terms.get(id)
    const h = hs[i]
    if (!term || !h) return term?.clearSelection()
    term.select(h.col, h.row, h.len)
    term.scrollToLine(Math.max(0, h.row - Math.floor(term.rows / 2)))
  }
  const search = (text: string) => {
    setQ(text)
    const hs = findAll(bufferLines(id), text)
    setHits(hs)
    setAt(hs.length - 1) // 가장 최근 출력부터
    show(hs, hs.length - 1)
  }
  const step = (d: number) => {
    if (!hits.length) return
    const i = (at + d + hits.length) % hits.length
    setAt(i)
    show(hits, i)
  }
  const close = () => (terms.get(id)?.focus(), onClose())

  return (
    <div className="term-search" role="search">
      <input
        ref={input}
        className="input"
        value={q}
        placeholder={tr('터미널 출력에서 찾기')}
        aria-label={tr('터미널 출력에서 찾기')}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
        }}
      />
      <span className="dim" style={{ fontSize: 12, minWidth: 48, textAlign: 'center' }}>{q ? (hits.length ? `${at + 1}/${hits.length}` : tr('없음')) : ''}</span>
      <button type="button" className="ws-icon-btn" aria-label={tr('이전 일치')} title={tr('이전 (Shift+Enter)')} onClick={() => step(-1)}>↑</button>
      <button type="button" className="ws-icon-btn" aria-label={tr('다음 일치')} title={tr('다음 (Enter)')} onClick={() => step(1)}>↓</button>
      <button type="button" className="ws-icon-btn" aria-label={tr('닫기')} title={tr('닫기 (Esc)')} onClick={close}>×</button>
    </div>
  )
}
