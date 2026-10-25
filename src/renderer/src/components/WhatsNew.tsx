import { useEffect, useRef } from 'react'
import Button from './Button'
import { getLang, tr } from '../../../main/i18n.mts'
import type { Release } from '../../../main/changelog.mts'

// 업데이트 내용: 업데이트 뒤 첫 실행에 자동으로 뜨고, 도움말 옆 버튼·명령 팔레트로 다시 볼 수 있음
export default function WhatsNew({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const ko = getLang() === 'ko'
  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby="news-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="guide-top">
        <span className="dim" style={{ fontSize: 12 }}>{tr('업데이트 내용')}</span>
        <button type="button" className="tab-close" aria-label={tr('닫기')} onClick={onClose}>×</button>
      </div>
      <h1 id="news-title">{tr('JetDeck {0}', releases[0]?.version ?? '')}</h1>
      <div className="guide-body">
        {releases.map((r) => (
          <section key={r.version}>
            {releases.length > 1 && <h3>v{r.version}</h3>}
            <ul>
              {(ko ? r.ko : r.en).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="guide-foot">
        <span />
        <Button variant="primary" size={40} autoFocus onClick={onClose}>{tr('확인')}</Button>
      </div>
    </dialog>
  )
}
