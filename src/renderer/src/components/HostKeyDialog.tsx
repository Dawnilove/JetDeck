import { useEffect, useRef } from 'react'
import type { HostKeyInfo } from '../../../main/ssh'
import Button from './Button'
import { tr } from '../../../main/i18n.mts'

type Props = {
  info: HostKeyInfo
  onAnswer: (answer: 'cancel' | 'once' | 'trust' | 'replace') => void
}

export default function HostKeyDialog({ info, onAnswer }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const changed = info.variant === 'changed'
  // 네이티브 <dialog>.showModal(): 뒤 화면 클릭 막기, 포커스 가두기, Esc(=취소)를 브라우저가 처리
  // showModal()은 첫 포커스 가능 요소(접힘 메뉴)로 포커스를 옮기므로, 열고 나서 지정한 버튼으로 다시 옮김
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  return (
    <dialog
      ref={ref}
      className="hk"
      aria-labelledby="hk-title"
      onCancel={(e) => {
        e.preventDefault()
        onAnswer('cancel')
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div className={`hk-icon ${changed ? 'warn' : ''}`}>
          {changed ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 id="hk-title" style={{ fontSize: 20, fontWeight: 600, color: changed ? 'var(--warn)' : undefined }}>
            {changed ? tr('호스트 키가 바뀌었어요') : tr('처음 접속하는 기기예요')}
          </h1>
          <p style={{ lineHeight: 1.6, color: changed ? 'var(--text-soft)' : 'var(--text-dim)' }}>
            {changed
              ? tr('Device에 OS를 다시 설치했다면 정상이에요. 그런 적이 없다면 다른 기기가 이 주소를 사칭하고 있을 수 있으니 연결하지 마세요.')
              : tr('아래 지문이 Device의 실제 키와 같은지 확인한 뒤 연결하세요. 한 번 신뢰하면 다음부터는 묻지 않아요.')}
          </p>
        </div>
      </div>

      <dl>
        <dt>{tr('호스트')}</dt>
        <dd>{info.host}</dd>
        <dt>{tr('키 종류')}</dt>
        <dd>{info.keyType}</dd>
        {changed && (
          <>
            <dt>{tr('이전 지문')}</dt>
            <dd style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>{info.oldFingerprint}</dd>
          </>
        )}
        <dt>{tr('지문')}</dt>
        <dd>{info.fingerprint}</dd>
      </dl>

      <details>
        <summary>{tr('Device에서 지문 확인하는 방법')}</summary>
        <p style={{ margin: '8px 0', lineHeight: 1.6 }}>
          {tr('Device에 모니터를 연결하거나 USB 시리얼로 접속해 아래 명령을 실행하고, 출력된 값이 위 지문과 같은지 비교하세요.')}
        </p>
        <div className="hk-code">ssh-keygen -lf /etc/ssh/ssh_host_{info.keyType.toLowerCase()}_key.pub</div>
      </details>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 4 }}>
        {/* 키가 바뀐 경우 기본 포커스는 취소 */}
        <Button style={{ padding: '0 18px' }} data-autofocus={changed || undefined} onClick={() => onAnswer('cancel')}>{tr('취소')}</Button>
        {changed ? (
          <Button variant="warn" style={{ padding: '0 18px' }} onClick={() => onAnswer('replace')}>{tr('새 키로 교체하고 연결')}</Button>
        ) : (
          <>
            <Button style={{ padding: '0 18px' }} onClick={() => onAnswer('once')}>{tr('이번만 연결')}</Button>
            <Button variant="primary" style={{ padding: '0 20px' }} data-autofocus onClick={() => onAnswer('trust')}>{tr('신뢰하고 연결')}</Button>
          </>
        )}
      </div>
    </dialog>
  )
}
