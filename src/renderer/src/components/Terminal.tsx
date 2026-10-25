import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { termTheme } from '../themes'

// 세션 id → 터미널. main에서 오는 데이터를 여기로 바로 씀
export const terms = new Map<string, XTerm>()

type Props = {
  id: string
  active: boolean
  focus?: boolean // 분할 화면에서 여러 칸이 동시에 보일 때, 지금 선택한 칸만 키보드 포커스를 가짐
  onResize: (cols: number, rows: number) => void
  className?: string
}

export default function Terminal({ id, active, focus = true, onResize, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const resizeCb = useRef(onResize)
  resizeCb.current = onResize
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const term = new XTerm({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'), // 테마 JSON의 font.mono를 따름
      fontSize: 13, // 편집기(Editor.tsx)와 같은 크기
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      minimumContrastRatio: 4.5, // ls의 tmp(초록 배경+검정 글자) 같은 저대비 조합을 xterm이 자동 보정
      theme: termTheme() // 테마를 바꾸면 themes.ts의 applyTheme이 열린 터미널에도 적용
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    terms.set(id, term) // open 전에 들어온 데이터도 버퍼에 쌓였다가 표시됨

    term.onData((d) => window.api.writeSession(id, d))
    term.onResize(({ cols, rows }) => {
      window.api.resizeSession(id, cols, rows)
      resizeCb.current(cols, rows)
    })
    // Windows 터미널 방식: 선택 영역이 있으면 Ctrl+C = 복사, 없으면 ^C(중단). Ctrl+V = 붙여넣기
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey) return true
      const k = e.key.toLowerCase()
      if (k === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      // v: false면 xterm이 무시 → 브라우저 기본 붙여넣기가 paste 이벤트로 들어감
      // `: 작업 공간 단축키(Ctrl+` 패널 접기, Ctrl+Shift+` 새 터미널)라 셸로 보내지 않음
      return k !== 'v' && e.code !== 'Backquote'
    })

    let disposed = false
    const ro = new ResizeObserver(() => {
      if (ref.current?.offsetWidth) fit.fit() // 숨겨진 탭(폭 0)은 건너뜀
    })
    // 글꼴이 로드된 뒤 열어야 글자 폭 계산이 맞음
    document.fonts.load("13.5px 'JetBrains Mono'").finally(() => {
      if (disposed || !ref.current) return
      term.open(ref.current)
      fit.fit()
      resizeCb.current(term.cols, term.rows)
      ro.observe(ref.current)
      if (activeRef.current) term.focus() // 열리기 전의 focus()는 무시되므로 연 뒤에 다시
    })

    return () => {
      disposed = true
      ro.disconnect()
      terms.delete(id)
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    const term = terms.get(id)
    if (!active || !term) return
    if (term.options.theme !== termTheme()) term.options.theme = termTheme() // 숨겨져 있는 동안 바뀐 테마
    if (focus) term.focus()
  }, [active, focus, id])

  return (
    <div className={`term ${className}`} style={{ display: active ? undefined : 'none' }}>
      <div ref={ref} style={{ height: '100%' }} />
    </div>
  )
}
