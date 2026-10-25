import Logo from '../components/Logo'
import { tr } from '../../../main/i18n.mts'
import { MascotOr } from '../components/Mascot'
import Terminal from '../components/Terminal'
import type { Sess } from './Workspace'
import { STATUS_TEXT } from '../util'


type Props = {
  sess: Sess
  active: boolean // 숨겨도 터미널 내용을 유지하려고 마운트된 채로 둠
  onHosts: () => void
  onGuide: () => void
  onDisconnect: () => void
  onReconnect: () => void
}

// 시리얼 콘솔: 터미널 하나만 (파일·모니터·포워딩은 SSH 전용이라 없음)
export default function SerialView({ sess, active, onHosts, onGuide, onDisconnect, onReconnect }: Props) {
  const { host } = sess
  return (
    <div className="ws" data-status={sess.status} style={{ display: active ? undefined : 'none' }}>
      <header className="ws-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MascotOr status={sess.status} size={28}>
            <div className="ws-logo">
              <Logo size={15} />
            </div>
          </MascotOr>
          <span className="display" style={{ fontWeight: 600 }}>JetDeck</span>
          <span className="dim">— {host.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ws-badge">
            <span className={`dot ${sess.status}`} style={{ width: 7, height: 7 }} />
            {STATUS_TEXT[sess.status]} · <span className="mono" style={{ fontSize: 12 }}>{host.serialPath} · {host.baud}</span>
          </span>
          {/* 테마 변경은 '연결 관리' 화면에서 (시리얼 화면엔 명령 팔레트가 없음) */}
          <button type="button" className="ws-mini" onClick={onGuide}>{tr('도움말')}</button>
          <button type="button" className="ws-mini" onClick={onHosts}>{tr('연결 관리')}</button>
          {sess.status === 'offline' && <button type="button" className="ws-mini" onClick={onReconnect}>{tr('다시 연결')}</button>}
          <button type="button" className="ws-mini" onClick={onDisconnect}>{sess.status === 'offline' ? tr('닫기') : tr('연결 해제')}</button>
        </div>
      </header>
      <div className="ws-term-body">
        <Terminal id={sess.id} active={active} className="term-panel" onResize={() => {}} />
        {sess.status === 'connecting' && <div className="ws-connecting" role="status">{tr('{0}을(를) 여는 중…', host.serialPath)}</div>}
      </div>
    </div>
  )
}
