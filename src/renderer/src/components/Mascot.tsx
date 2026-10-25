import { useEffect, useRef, useState, type ReactNode } from 'react'
import { currentMascot, mascotSrc, useThemeTick } from '../themes'
import { tr } from '../../../main/i18n.mts'
import { STATUS_TEXT, type ConnStatus } from '../util'

type Status = ConnStatus

// 캐릭터별 대사 (design/Limited*.dc.html 문구). shortcut: 테마 JSON에 대사 칸이 없어 이름으로 찾음, JSON에 넣게 되면 옮기기
const LINES: Record<string, { tip: string } & Record<Status, string>> = {
  momo: { online: tr('준비 완료! 오늘도 잘 부탁해요'), connecting: tr('젯슨을 깨우는 중이에요…'), offline: tr('연결이 끊겼어요. 다시 시도할게요'), tip: tr('저장은 Ctrl+S, 모모가 바로 젯슨에 올려줘요') },
  volt: { online: tr('링크 확보. 작업 시작'), connecting: tr('신호 탐색 중…'), offline: tr('신호 두절. 재접속 대기'), tip: tr('Ctrl+Shift+P로 볼트에게 명령을 내리세요') },
  dudu: { online: tr('터널 개통! 젯슨까지 뚫렸어요'), connecting: tr('헤드램프 켜고 길 찾는 중…'), offline: tr('앗, 무너졌다! 다시 팔게요'), tip: tr('포트 포워딩 = 두두가 판 지름길') }
}

// 마스코트 그림 하나 (장식이라 alt 비움). 캐릭터 테마가 아니거나 숨겼으면 아무것도 안 그림
export default function Mascot({ status, size }: { status: Status; size: number }) {
  useThemeTick()
  const src = mascotSrc(status, size)
  return src ? <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ flexShrink: 0, display: 'block' }} /> : null
}

// 마스코트가 있으면 마스코트, 없으면 children (타이틀바 로고 자리)
export function MascotOr({ status, size, children }: { status: Status; size: number; children: ReactNode }) {
  useThemeTick()
  return mascotSrc(status, size) ? <Mascot status={status} size={size} /> : <>{children}</>
}

// 탐색기 하단 팁 카드
export function MascotTip({ status }: { status: Status }) {
  useThemeTick()
  const m = currentMascot()
  if (!m || !mascotSrc(status, 56)) return null
  return (
    <div className="mascot-tip">
      <Mascot status={status} size={56} />
      <span>{LINES[m.name]?.tip}</span>
    </div>
  )
}

// 연결 상태가 바뀔 때 3.5초 뜨는 알림: 오른쪽 위(모니터 패널 자리), 클릭은 통과(pointer-events: none)
// shortcut: 모니터 패널을 접어 두면 편집기 오른쪽 위에 잠깐 겹침, 문제되면 패널 안으로 옮기기
export function MascotToast({ status }: { status: Status }) {
  useThemeTick()
  const [shown, setShown] = useState<Status | null>(null)
  const prev = useRef(status)
  const lastAt = useRef<Partial<Record<Status, number>>>({})
  useEffect(() => {
    if (prev.current === status) return
    prev.current = status
    // '연결 중'은 잠깐이라 생략, 같은 상태는 1분에 한 번만 (자동 재연결이 반복돼도 알림이 계속 뜨지 않게)
    if (status === 'connecting' || Date.now() - (lastAt.current[status] ?? 0) < 60_000) return
    lastAt.current[status] = Date.now()
    setShown(status)
    const t = setTimeout(() => setShown(null), 3500)
    return () => clearTimeout(t)
  }, [status])
  const m = currentMascot()
  if (!shown || !m || !mascotSrc(shown, 110)) return null
  return (
    <div className="mascot-toast" role="status">
      <Mascot status={shown} size={110} />
      <div>
        <b>
          <span className={`dot ${shown}`} style={{ width: 8, height: 8, display: 'inline-block', marginRight: 6 }} />
          {STATUS_TEXT[shown]}
        </b>
        <p>{LINES[m.name]?.[shown]}</p>
      </div>
    </div>
  )
}
