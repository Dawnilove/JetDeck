import { useEffect, useRef, useState, type ReactNode } from 'react'
import Button from './Button'
import { tr } from '../../../main/i18n.mts'
import { trNode } from '../util'

// 사용 가이드: 첫 실행 때 자동으로 뜨고, 도움말 버튼·명령 팔레트로 다시 열 수 있음
const KEY = 'guide-seen'
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false // 저장소를 못 읽으면 보여 주는 쪽으로
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* 저장 실패 → 다음 실행 때 한 번 더 뜰 뿐 */
  }
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const PAGES: { title: string; body: ReactNode }[] = [
  {
    title: tr('JetDeck에 오신 걸 환영해요'),
    body: (
      <>
        <p>{trNode('Device(Jetson 등)에 SSH로 접속해서 {0}을 한 화면에서 할 수 있는 앱이에요.', <b>{tr('터미널, 파일 편집, 시스템 모니터, 파일 전송')}</b>)}</p>
        <p>{tr('Device에는 아무것도 설치하지 않아도 돼요. SSH 서버만 켜져 있으면 바로 쓸 수 있어요.')}</p>
        <p className="dim">{tr('5단계로 핵심만 안내할게요. 1분이면 충분해요.')}</p>
      </>
    )
  },
  {
    title: tr('1. Device 연결하기'),
    body: (
      <ul>
        <li>{trNode('{0}에 이름, 호스트(IP 주소 또는 {1}), 사용자 이름을 넣고 {2}을 누르세요.', <b>{tr('새 연결')}</b>, <code>{tr('이름.local')}</code>, <b>{tr('저장 후 연결')}</b>)}</li>
        <li>{trNode('인증은 {0} 또는 {1}. 암호가 걸린 키는 Windows의 ssh-agent에 등록({2})해 두면 돼요.', <b>{tr('비밀번호')}</b>, <b>{tr('SSH 키')}</b>, <code>ssh-add</code>)}</li>
        <li>{trNode('처음 접속하면 {0} 창이 떠요. 지문이 Device 것과 같으면 {1}을 누르세요.', <b>{tr('호스트 키 확인')}</b>, <b>{tr('신뢰하고 연결')}</b>)}</li>
        <li>{trNode('Micro-USB 케이블로 직접 연결했다면 호스트에 {0}을 넣으면 돼요.', <code>192.168.55.1</code>)}</li>
        <li>{tr('저장한 호스트는 왼쪽 목록에서 한 번 클릭하면 바로 접속돼요.')}</li>
      </ul>
    )
  },
  {
    title: tr('2. 작업 공간'),
    body: (
      <>
        <ul>
          <li>{trNode('{0}: 파일을 클릭하면 편집기로 열려요. 우클릭하면 새 파일, 이름 바꾸기, 삭제, 터미널에서 열기.', <b>{tr('왼쪽 탐색기')}</b>)}</li>
          <li>{trNode('{0}: {1}로 Device에 바로 저장. 그사이 Device에서 파일이 바뀌었으면 덮어쓰기 전에 물어봐요.', <b>{tr('가운데 편집기')}</b>, <K>Ctrl+S</K>)}</li>
          <li>{trNode('{0}: {1}로 탭 추가, 옆 버튼으로 좌우 분할, {2}로 넓게 보기.', <b>{tr('아래 터미널')}</b>, <b>+</b>, <b>{tr('터미널만 크게')}</b>)}</li>
        </ul>
        <div className="guide-keys">
          <K>Ctrl+Shift+P</K><span>{tr('명령 팔레트 (모든 기능 검색)')}</span>
          <K>Ctrl+P</K><span>{tr('파일 이름으로 찾아 열기')}</span>
          <K>Ctrl+Shift+F</K><span>{tr('파일 안의 글자 찾기·바꾸기')}</span>
          <K>Ctrl+`</K><span>{tr('터미널 패널 접기/펴기')}</span>
          <K>Ctrl+Shift+`</K><span>{tr('새 터미널')}</span>
        </div>
      </>
    )
  },
  {
    title: tr('3. 시스템 모니터와 전원'),
    body: (
      <ul>
        <li>{trNode('{0}에서 CPU, GPU, 메모리, 저장공간, 온도, 소비 전력을 0.5초마다 보여 줘요. (액티비티 바의 맥박 아이콘으로 접기/펴기)', <b>{tr('오른쪽 패널')}</b>)}</li>
        <li>{trNode('{0}를 고르면 터미널에 {1} 명령이 입력돼요. 비밀번호는 터미널에 직접 입력하세요.', <b>{tr('전원 모드')}</b>, <code>sudo nvpmodel</code>)}</li>
        <li>{trNode('{0}시킨 Device는 연결 관리 화면의 호스트 옆 {1}(전원 아이콘)로 다시 켤 수 있어요. 같은 유선망에서만 되고, 한 번 접속하면 자동으로 준비돼요.', <b>{tr('절전')}</b>, <b>{tr('깨우기')}</b>)}</li>
        <li>{trNode('{0}는 확인 창을 거친 뒤 실행돼요. 완전히 끈 Device는 전원 버튼을 직접 눌러야 켜져요.', <b>{tr('재부팅·종료')}</b>)}</li>
      </ul>
    )
  },
  {
    title: tr('4. 파일 전송과 꾸미기'),
    body: (
      <ul>
        <li>{trNode('액티비티 바의 {0}(다운로드 아이콘): 왼쪽은 내 컴퓨터, 오른쪽은 Device예요.', <b>{tr('파일 전송')}</b>)}</li>
        <li>{trNode('파일을 고르고 {0} / {1}를 누르거나, 반대편으로 {2}. 윈도우 탐색기에서 Device 쪽으로 끌어와도 돼요.', <b>{tr('업로드 →')}</b>, <b>{tr('← 다운로드')}</b>, <b>{tr('끌어다 놓으세요')}</b>)}</li>
        <li>{tr('같은 이름이 있으면 덮어쓰기 전에 물어보고, 전송 중에 끊겨도 원래 파일은 깨지지 않아요.')}</li>
        <li>{trNode('{0}는 연결 관리 화면 오른쪽 위나 명령 팔레트에서 바꿀 수 있어요.', <b>{tr('테마')}</b>)}</li>
        <li>{trNode('이 가이드는 {0} 버튼이나 명령 팔레트의 {1}로 언제든 다시 볼 수 있어요.', <b>{tr('도움말')}</b>, <b>{tr('사용 가이드')}</b>)}</li>
      </ul>
    )
  },
  {
    title: tr('5. 더 있는 기능'),
    body: (
      <ul>
        <li><b>{tr('스니펫')}</b>{tr(': 자주 쓰는 명령을 저장해 두고 터미널에서 한 번에 실행해요.')}</li>
        <li><b>ROS2</b>{tr(': 토픽·노드·launch·서비스·파라미터·bag을 화면에서 다뤄요.')}</li>
        <li><b>Docker</b>{tr(': 컨테이너와 이미지를 보고 시작·정지해요.')}</li>
        <li><b>{tr('Device 화면')}</b>{tr(': Device 데스크톱을 앱 안에서 봐요 (VNC).')}</li>
        <li><b>{tr('영상 입력')}</b>{tr(': Device에 연결한 카메라 등의 영상을 미리 봐요.')}</li>
        <li><b>{tr('대시보드')}</b>{tr(': 연결 관리 화면에서 여러 Device 상태를 한눈에 봐요.')}</li>
        <li><b>X11</b>{tr(': 호스트 설정에서 켜면 rviz·rqt 같은 창을 이 PC에 띄워요 (X 서버 필요).')}</li>
        <li><b>{tr('활동')}</b>{tr(': 모니터 기록 그래프, 프로세스, AI 활동을 봐요.')}</li>
        <li><b>{tr('언어')}</b>{tr(': 연결 관리 화면의 English / 한국어 버튼으로 바꿔요.')}</li>
        <li><b>MCP</b>{tr(': 작업 공간 위쪽 MCP 버튼으로 Claude 같은 AI와 연결해요.')}</li>
      </ul>
    )
  }
]

export default function Guide({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [page, setPage] = useState(0)
  const last = page === PAGES.length - 1
  const close = () => {
    markSeen() // 한 번 닫으면 다음 실행부터 자동으로 안 뜸
    onClose()
  }
  // showModal()은 첫 버튼(닫기 ×)에 포커스를 주므로, 열린 뒤 '다음'으로 옮겨 Enter로 바로 넘길 수 있게
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLElement>('.guide-foot .btn-primary')?.focus()
  }, [])

  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby="guide-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' && !last) setPage(page + 1)
        if (e.key === 'ArrowLeft' && page > 0) setPage(page - 1)
      }}
    >
      <div className="guide-top">
        <span className="dim" style={{ fontSize: 12 }}>{tr('사용 가이드 · {0} / {1}', page + 1, PAGES.length)}</span>
        <button type="button" className="tab-close" aria-label={tr('가이드 닫기')} onClick={close}>×</button>
      </div>
      <h1 id="guide-title">{PAGES[page].title}</h1>
      <div className="guide-body">{PAGES[page].body}</div>
      <div className="guide-foot">
        <div className="guide-dots" aria-hidden="true">
          {PAGES.map((_, i) => (
            <span key={i} className={i === page ? 'on' : ''} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {page > 0 && <Button size={40} onClick={() => setPage(page - 1)}>{tr('이전')}</Button>}
          {last ? (
            <Button variant="primary" size={40} autoFocus onClick={close}>{tr('시작하기')}</Button>
          ) : (
            <Button variant="primary" size={40} autoFocus onClick={() => setPage(page + 1)}>{tr('다음')}</Button>
          )}
        </div>
      </div>
    </dialog>
  )
}
