import { useEffect, useRef, useState } from 'react'
import type { Snippet } from '../screens/snippets.mts'
import Button from './Button'
import Input from './Input'
import { tr } from '../../../main/i18n.mts'

type Props = {
  initial: Snippet | null // null이면 새로 만들기
  onSave: (s: Snippet) => void
  onDelete?: () => void
  onCancel: () => void
}

// 스니펫 추가·편집 창 (HostKeyDialog와 같은 네이티브 <dialog>)
export default function SnippetDialog({ initial, onSave, onDelete, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [cmd, setCmd] = useState(initial?.cmd ?? '')
  const [enter, setEnter] = useState(initial?.enter ?? true)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])
  const ok = cmd.trim().length > 0

  return (
    <dialog
      ref={ref}
      className="hk"
      aria-labelledby="snip-title"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <h1 id="snip-title" style={{ fontSize: 20, fontWeight: 600 }}>{initial ? tr('스니펫 편집') : tr('스니펫 추가')}</h1>
      <Input label={tr('이름 (비우면 명령의 첫 줄)')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      <label className="field">
        {tr('명령 (여러 줄이면 한 줄씩 차례로 실행돼요)')}
        <textarea className="input mono" data-autofocus rows={5} style={{ height: 'auto', padding: 10, resize: 'vertical' }} value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} />
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
        <input type="checkbox" checked={enter} onChange={(e) => setEnter(e.target.checked)} />
        {tr('끝에서 Enter까지 눌러 바로 실행 (끄면 입력만 하고 기다려요)')}
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
        {onDelete && <Button variant="warn" style={{ padding: '0 18px', marginRight: 'auto' }} onClick={onDelete}>{tr('삭제')}</Button>}
        <Button style={{ padding: '0 18px' }} onClick={onCancel}>{tr('취소')}</Button>
        <Button variant="primary" style={{ padding: '0 20px' }} disabled={!ok} onClick={() => onSave({ name: name.trim() || cmd.trim().split('\n')[0], cmd, enter })}>{tr('저장')}</Button>
      </div>
    </dialog>
  )
}
