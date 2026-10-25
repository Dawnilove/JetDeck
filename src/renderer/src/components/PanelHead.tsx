import type { ReactNode } from 'react'

// 작업 공간 위에 덮는 화면(ROS2·Docker·카메라·Device 화면·활동)의 머리말: 제목 + 한 줄 설명 + 오른쪽 버튼들
// hist: 활동 화면(모니터 기록·프로세스·AI 활동)처럼 카드 사이에 놓이는 머리말 (테두리·안쪽 여백 없음)
export default function PanelHead({ title, desc, children, hist }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; hist?: boolean }) {
  return (
    <div className={hist ? 'hist-head' : 'fw-head'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h1>
        {desc}
      </div>
      {children && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>{children}</div>}
    </div>
  )
}

// 한 줄 설명 (머리말 제목 아래)
export const Desc = ({ children, max }: { children: ReactNode; max?: number }) => (
  <p className="dim" style={{ fontSize: 13, maxWidth: max }}>
    {children}
  </p>
)

// 목록 자리에 보이는 안내: 연결 전·읽는 중·빈 목록(dim) / 오류(err)
export const Note = ({ children, err }: { children: ReactNode; err?: boolean }) => <p className={`${err ? 'msg-err' : 'dim'} fw-empty`}>{children}</p>
