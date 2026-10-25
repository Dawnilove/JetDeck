import { useEffect, useRef, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { Terminal as XTerm } from '@xterm/xterm'
import { buildRow, findAll, toCells, type Cell, type Hit, type Row } from '../screens/termsearch.mts'
import { terms } from './Terminal'

// 터미널 출력 검색 (4.4.0): xterm 버퍼(스크롤백 포함)에서 찾아 선택 표시. 줄바꿈으로 이어진 줄에 걸친 일치는 못 찾음 (shortcut: 필요하면 isWrapped 줄을 합쳐 찾기)
// 전체 화면 프로그램(vim 등) 중에도 스크롤백이 있는 normal 버퍼를 읽음
export function bufferRows(term: XTerm | undefined): Row[] {
  const buf = term?.buffer.normal
  if (!buf) return []
  const cell = buf.getNullCell()
  return Array.from({ length: buf.length }, (_, i) => {
    const l = buf.getLine(i)
    const cells: Cell[] = []
    for (let x = 0; l && x < l.length; x++) {
      const c = l.getCell(x, cell)
      cells.push({ chars: c?.getChars() ?? '', width: c?.getWidth() ?? 1 })
    }
    return buildRow(cells, !!l?.isWrapped)
  })
}

export default function TermSearch({ id, onClose }: { id: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  // 출력이 계속 늘거나 스크롤백이 잘리면 줄 번호가 달라져서, 이동할 때마다 지금 버퍼로 다시 찾음
  const scan = (text: string) => {
    const rows = bufferRows(terms.get(id))
    return findAll(rows.map((r) => r.text), text).map((h) => toCells(rows[h.row], h))
  }
  const show = (hs: Hit[], i: number) => {
    const term = terms.get(id)
    const h = hs[i]
    if (!term || !h) return term?.clearSelection()
    if (term.buffer.active.type !== 'normal') return // 전체 화면 프로그램 중에는 선택할 위치가 없음
    term.select(h.col, h.row, h.len)
    term.scrollToLine(Math.max(0, h.row - Math.floor(term.rows / 2)))
  }
  const search = (text: string) => {
    setQ(text)
    const hs = scan(text)
    setHits(hs)
    setAt(hs.length - 1) // 가장 최근 출력부터
    show(hs, hs.length - 1)
  }
  const step = (d: number) => {
    const hs = scan(q)
    setHits(hs)
    if (!hs.length) return show(hs, 0)
    const i = (Math.min(at, hs.length - 1) + d + hs.length) % hs.length
    setAt(i)
    show(hs, i)
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
