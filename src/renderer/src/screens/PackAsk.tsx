import { useEffect, useRef } from 'react'
import { tr } from '../../../main/i18n.mts'
import type { PackAction } from '../../../main/packschema.mts'
import Button from '../components/Button'
import { cmdOf, lt, Reasons, RiskTag } from './PackUi'

// 실행 전 확인창 (플러그인 화면·로그 카드가 같이 씀)
// prepared: 입력 폼·실시간 항목은 main(packPrepare)이 값을 채운 명령과 다시 분석한 위험도를 줌 → 그 명령 전문을 보여 주고, 확인하면 token을 실행 요청에 같이 보냄
export type Ask = {
  action: PackAction
  values: Record<string, string>
  preview?: string
  loading: boolean
  error?: string
  term?: { text: string; enter: boolean }
  prepared?: { cmd: string; token: string }
}

// 위 → 아래: ① 앱이 계산한 위험 이유(앱 글자) ② 팩이 쓴 설명(이름표 붙은 별도 상자) ③ 미리보기 ④ 실제로 실행(입력)할 명령 전문
export default function AskDialog({ ask, onCancel, onOk }: { ask: Ask; onCancel: () => void; onOk: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const a = ask.action
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const term = ask.term
  const cmd = term ? term.text : ask.prepared ? ask.prepared.cmd : cmdOf(a, ask.values)
  const minutes = Math.max(1, Math.round((a.timeout ?? 600) / 60))
  return (
    <dialog ref={ref} className="hk" aria-labelledby="pk-title" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h1 id="pk-title" style={{ fontSize: 20, fontWeight: 600 }}>{lt(a.label)}</h1>
      <div data-testid="pk-app-reasons" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{tr('앱이 확인한 내용')}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><RiskTag risk={a.risk} /> {a.risk === 'danger' ? tr('되돌리기 어려울 수 있는 작업이에요') : tr('Device의 상태를 바꿀 수 있는 작업이에요')}</div>
        <Reasons a={a} />
      </div>
      {a.confirm && (
        <div data-testid="pk-pack-text" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, border: '1px dashed var(--border)' }}>
          <span className="caption">{tr('팩이 쓴 설명')}</span>
          <p style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{lt(a.confirm)}</p>
        </div>
      )}
      {a.preview && !term && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="caption">{tr('미리보기 (아직 아무것도 바뀌지 않았어요)')}</span>
          {ask.loading ? <p className="dim">{tr('미리보기 불러오는 중…')}</p> : ask.error ? <p className="msg-err">{ask.error}</p> : <pre className="hk-code ros-out" style={{ minHeight: 0, maxHeight: '30vh' }}>{ask.preview || tr('(바뀌는 것이 없어요)')}</pre>}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{term ? tr('터미널에 입력할 글자') : tr('실행할 명령')}</span>
        <code className="hk-code" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '30vh', overflowY: 'auto' }}>{cmd}</code>
        {term && <span className="dim" style={{ fontSize: 12 }}>{term.enter ? tr('확인하면 입력하고 Enter까지 눌러요.') : tr('확인하면 입력만 하고 Enter는 누르지 않아요.')}</span>}
        {a.mode === 'stream' && <span className="dim" style={{ fontSize: 12 }}>{tr('멈춤을 누르거나 화면을 나가면 끝나요. 최대 {0}분 실행돼요', minutes)}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
        <Button style={{ padding: '0 18px' }} onClick={onCancel}>{tr('취소')}</Button>
        <Button variant={a.risk === 'danger' ? 'warn' : 'primary'} style={{ padding: '0 20px' }} disabled={ask.loading || !!ask.error} onClick={onOk}>{term ? tr('입력') : a.mode === 'stream' ? tr('시작') : tr('실행')}</Button>
      </div>
    </dialog>
  )
}
