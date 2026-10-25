import type * as monaco from 'monaco-editor'
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 편집기(Monaco, 약 5MB)는 파일을 처음 열 때 불러옴 → 앱 첫 화면이 빨리 뜨고, 편집기를 안 쓰면 메모리도 아낌
let loading: Promise<typeof import('../monaco')> | null = null
const loadMonaco = () => (loading ??= import('../monaco'))

export type EditorApi = {
  open: (path: string, line?: number) => void
  renamed: (from: string, to: string) => void
  deleted: (path: string) => void
  dirtyCount: () => number
}
export type EditorStatus = { ln: number; col: number; eol: 'LF' | 'CRLF' } | null

type File = { path: string; mtime: number | null; saved: number; dirty: boolean; model: monaco.editor.ITextModel }
type Props = {
  connId: string
  home: string
  onStatus: (s: EditorStatus) => void
  onOpened?: (path: string) => void // 파일을 열었음 (시작 화면의 최근 파일용)
  children: ReactNode // 열린 파일이 없을 때 보여줄 안내
  ref?: Ref<EditorApi>
}

const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
// 탭 앞 색 점: .py 파랑, .yaml 노랑, 나머지 강조색 (design/Workspace.dc.html)
const extColor = (p: string) => (/\.py$/.test(p) ? 'var(--chart-2)' : /\.ya?ml$/.test(p) ? 'var(--status-busy)' : 'var(--accent-text)')

export default function Editor({ connId, home, onStatus, onOpened, children, ref }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const diffBox = useRef<HTMLDivElement>(null)
  const dd = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const diffOrig = useRef<monaco.editor.ITextModel | null>(null) // 비교 화면 왼쪽(Device의 저장된 내용)
  const views = useRef(new Map<monaco.editor.ITextModel, monaco.editor.ICodeEditorViewState | null>())
  const [files, setFiles] = useState<File[]>([])
  const [active, setActive] = useState('')
  const [diff, setDiff] = useState<{ path: string; conflict: boolean } | null>(null)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  // monaco 콜백(Ctrl+S 등)은 한 번만 등록되므로 최신 상태는 ref로 읽음
  const filesRef = useRef(files)
  filesRef.current = files
  const activeRef = useRef(active)
  const diffRef = useRef(diff)
  diffRef.current = diff
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus

  const fileOf = (path: string) => filesRef.current.find((f) => f.path === path)
  const report = () => {
    const e = ed.current
    const m = e?.getModel()
    const pos = e?.getPosition()
    statusRef.current(m && pos ? { ln: pos.lineNumber, col: pos.column, eol: m.getEOL() === '\r\n' ? 'CRLF' : 'LF' } : null)
  }

  const closeDiff = () => {
    if (!diffRef.current) return
    dd.current?.setModel(null)
    diffOrig.current?.dispose()
    diffOrig.current = null
    diffRef.current = null
    setDiff(null)
    setTimeout(() => ed.current?.layout(), 0) // 숨겼던 편집기를 다시 보이게 한 뒤 크기를 다시 잼
  }

  const activate = (path: string) => {
    closeDiff()
    const e = ed.current
    if (!e) return // 아직 편집기를 만들기 전 (열린 파일 없음)
    const cur = e.getModel()
    if (cur) views.current.set(cur, e.saveViewState())
    const f = fileOf(path)
    e.setModel(f?.model ?? null)
    if (f) e.restoreViewState(views.current.get(f.model) ?? null)
    activeRef.current = f ? path : ''
    setActive(activeRef.current)
    report()
  }

  const editorOptions = () => ({
    theme: 'nanoterm',
    automaticLayout: true, // 패널 크기 조절·탭 전환 시 자동으로 다시 그림
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
    fontSize: 13,
    lineHeight: 21,
    minimap: { enabled: false },
    scrollBeyondLastLine: false
  })

  // 처음 열 때 한 번만 편집기를 만듦
  const ensureEditor = async () => {
    const m = await loadMonaco()
    if (!ed.current && box.current) {
      const e = m.monaco.editor.create(box.current, { model: null, ...editorOptions() })
      ed.current = e
      e.addCommand(m.monaco.KeyMod.CtrlCmd | m.monaco.KeyCode.KeyS, () => activeRef.current && saveRef.current(activeRef.current))
      e.onDidChangeCursorPosition(report)
    }
    return m
  }

  // 검색 결과·빌드 오류에서 열 때: 그 줄로 이동 (편집기가 화면에 보인 뒤에 위치를 잡음)
  const goto = (line?: number) => {
    if (!line) return
    setTimeout(() => {
      ed.current?.setPosition({ lineNumber: line, column: 1 })
      ed.current?.revealLineInCenter(line)
    }, 60)
  }
  // restore=true: 탭 복원 중 — 최근 파일에 넣지 않고, 사라진 파일 오류도 조용히 건너뜀
  const open = async (path: string, line?: number, restore = false) => {
    if (fileOf(path)) return activate(path), goto(line), restore || onOpened?.(path)
    try {
      const [{ text, mtime }, m] = await Promise.all([window.api.fsRead(connId, path), ensureEditor()])
      if (fileOf(path)) return activate(path), goto(line), restore || onOpened?.(path) // 빠르게 두 번 클릭한 경우
      const model = m.monaco.editor.createModel(text, m.languageOf(path))
      const file: File = { path, mtime, saved: model.getAlternativeVersionId(), dirty: false, model }
      model.onDidChangeContent(() =>
        setFiles((fs) => fs.map((f) => (f.model === model ? { ...f, dirty: model.getAlternativeVersionId() !== f.saved } : f)))
      )
      filesRef.current = [...filesRef.current, file]
      setFiles(filesRef.current)
      activate(path)
      goto(line)
      if (!restore) onOpened?.(path)
    } catch (e) {
      if (!restore) setNotice({ text: `${baseOf(path)}: ${errText(e)}`, ok: false })
    }
  }

  // Device에 저장된 내용과 지금 편집 중인 내용을 나란히 비교 (왼쪽 = Device, 오른쪽 = 내 편집 내용, 오른쪽은 수정 가능)
  const openDiff = async (path: string, conflict = false) => {
    const f = fileOf(path)
    if (!f) return
    try {
      const [{ text }, m] = await Promise.all([window.api.fsRead(connId, path), ensureEditor()])
      if (fileOf(path) !== f || activeRef.current !== path) return // 읽는 사이 탭을 바꾼 경우
      const same = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
      if (same(text, f.model.getValue())) {
        if (conflict) return void saveRef.current(path, true) // 내용이 같으면 충돌이 아님 → 시간표만 맞춰 저장
        return setNotice({ text: tr('차이가 없어요: Device의 파일과 같아요'), ok: true })
      }
      if (!dd.current && diffBox.current) {
        const d = m.monaco.editor.createDiffEditor(diffBox.current, { ...editorOptions(), originalEditable: false, renderSideBySide: true })
        dd.current = d
        d.getModifiedEditor().addCommand(m.monaco.KeyMod.CtrlCmd | m.monaco.KeyCode.KeyS, () => activeRef.current && saveRef.current(activeRef.current))
      }
      if (!dd.current) return
      diffOrig.current?.dispose()
      diffOrig.current = m.monaco.editor.createModel(text, m.languageOf(path))
      dd.current.setModel({ original: diffOrig.current, modified: f.model })
      diffRef.current = { path, conflict }
      setDiff(diffRef.current)
      setTimeout(() => dd.current?.layout(), 0)
    } catch (e) {
      setNotice({ text: `${baseOf(path)}: ${errText(e)}`, ok: false })
    }
  }

  // Ctrl+S를 빠르게 두 번 누르면 두 요청이 같은 옛 mtime을 보내 가짜 '원격에서 바뀜' 충돌이 남 → 저장 중이면 무시
  const saving = useRef(new Set<string>())
  const save = async (path: string, force = false): Promise<void> => {
    const f = fileOf(path)
    if (!f || (!force && saving.current.has(path))) return
    saving.current.add(path)
    const version = f.model.getAlternativeVersionId()
    try {
      const r = await window.api.fsWrite(connId, path, f.model.getValue(), f.mtime, force)
      if ('conflict' in r) {
        // 바로 덮어쓰기를 묻지 않고, 달라진 부분을 보여 준 뒤 '덮어쓰기'를 고르게 함
        setNotice({ text: tr("'{0}'이(가) Device에서 열어둔 뒤에 바뀌었어요. 비교한 뒤 덮어쓰기를 눌러 주세요", baseOf(path)), ok: false })
        return void (await openDiff(path, true))
      }
      closeDiff()
      setFiles((fs) => fs.map((x) => (x.model === f.model ? { ...x, mtime: r.mtime, saved: version, dirty: f.model.getAlternativeVersionId() !== version } : x)))
      setNotice({ text: tr('저장했어요 · {0}', baseOf(path)), ok: true })
    } catch (e) {
      setNotice({ text: tr('저장 실패: {0}', errText(e)), ok: false })
    } finally {
      saving.current.delete(path)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const close = (path: string, ask = true) => {
    const f = fileOf(path)
    if (!f) return
    if (ask && f.dirty && !confirm(tr("'{0}'에 저장하지 않은 변경이 있어요. 닫을까요?", baseOf(path)))) return
    if (diffRef.current?.path === path) closeDiff() // 모델을 버리기 전에 비교 화면부터 풂
    filesRef.current = filesRef.current.filter((x) => x !== f)
    setFiles(filesRef.current)
    if (activeRef.current === path) activate(filesRef.current.at(-1)?.path ?? '')
    views.current.delete(f.model)
    f.model.dispose()
  }

  // 폴더 이름이 바뀌면 그 안의 열린 파일 경로도 함께 바꿈
  const moved = (p: string, from: string) => p === from || p.startsWith(from + '/')
  useImperativeHandle(ref, () => ({
    open,
    renamed: (from, to) => {
      filesRef.current = filesRef.current.map((f) => (moved(f.path, from) ? { ...f, path: to + f.path.slice(from.length) } : f))
      setFiles(filesRef.current)
      if (moved(activeRef.current, from)) {
        activeRef.current = to + activeRef.current.slice(from.length)
        setActive(activeRef.current)
      }
    },
    // 지워진 파일: 수정 안 한 탭은 닫고, 수정 중인 탭은 남김(저장하면 새로 만들어짐)
    deleted: (path) => {
      for (const f of filesRef.current.filter((x) => moved(x.path, path))) {
        if (f.dirty) f.mtime = null
        else close(f.path, false)
      }
    },
    dirtyCount: () => filesRef.current.filter((f) => f.dirty).length
  }))

  useEffect(
    () => () => {
      dd.current?.dispose() // 모델은 아래에서 따로 버림 (diff 편집기는 모델을 안 버림)
      diffOrig.current?.dispose()
      ed.current?.dispose()
      filesRef.current.forEach((f) => f.model.dispose())
    },
    []
  )

  // 편집기 영역이 화면에 보인 뒤에 포커스 (숨겨진 상태의 focus()는 무시됨)
  // 편집기는 숨겨진 상자 안에서 만들어지므로(첫 파일을 열 때) 보이게 된 뒤 크기를 다시 잼
  useEffect(() => {
    if (!active) return
    ed.current?.layout()
    ed.current?.focus()
  }, [active])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const crumb = (p: string) => (p.startsWith(home + '/') ? '~' + p.slice(home.length) : p).split('/').filter(Boolean).join(' › ')

  return (
    <>
      {/* 열린 파일이 없으면 빈 탭 줄은 숨김 */}
      {files.length > 0 && <div className="ws-tabs" role="tablist" aria-label={tr('열린 파일')}>
        {files.map((f) => (
          <div key={f.path} className={`ed-tab ${f.path === active ? 'active' : ''}`}>
            <button type="button" role="tab" aria-selected={f.path === active} title={f.path} onClick={() => activate(f.path)}>
              <span className="ed-ext" style={{ background: extColor(f.path) }} />
              {baseOf(f.path)}
              {f.dirty && <span className="ed-dirty" aria-label={tr('저장 안 됨')} />}
            </button>
            <button type="button" className="ed-x" aria-label={tr('{0} 닫기', baseOf(f.path))} onClick={() => close(f.path)}>×</button>
          </div>
        ))}
      </div>}
      {(active || notice) && (
        <div className="ed-crumb" role="status">
          <span className="ed-crumb-text">
            {active && crumb(active)}
            {notice && <span className={notice.ok ? 'msg-ok' : 'msg-err'}>{active ? ' · ' : ''}{notice.text}</span>}
          </span>
          {active && (
            <>
              {diff?.conflict && <button type="button" className="ed-act" onClick={() => void save(active, true)}>{tr('덮어쓰기')}</button>}
              <button type="button" className="ed-act" title={tr('Device에 저장된 파일과 지금 내용을 나란히 비교해요')} onClick={() => (diff ? closeDiff() : void openDiff(active))}>
                {diff ? tr('비교 닫기') : tr('Device와 비교')}
              </button>
            </>
          )}
        </div>
      )}
      <div ref={box} className="ed-box" style={{ display: active && !diff ? undefined : 'none' }} />
      <div ref={diffBox} className="ed-box" style={{ display: diff ? undefined : 'none' }} />
      {!active && children}
    </>
  )
}
