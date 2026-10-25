// 업데이트 내용: 버전마다 핵심만 (한·영). 새 버전을 낼 때 맨 위에 한 항목 추가
export type Release = { version: string; ko: string[]; en: string[] }

export const RELEASES: Release[] = [
  {
    version: '4.3.1',
    ko: [
      '안정화 점검: 설치판 업데이트(4.0.0 → 4.3.0)와 Git 표시·파일 검색·바꾸기·서비스·기기 점검·AI 터미널 읽기 승인, 영어 화면을 확인했어요 (동작 변경 없음)'
    ],
    en: [
      'Stability check: verified the installed-app update (4.0.0 → 4.3.0), Git markers, search & replace, services, Device check, the AI terminal-read approval and the English screens (no behavior changes)'
    ]
  },
  {
    version: '4.3.0',
    ko: [
      '설정 내보내기·가져오기: 호스트 목록·스니펫·테마를 파일 하나로 옮겨요 (비밀번호는 들어가지 않고, 스니펫의 비밀처럼 보이는 값은 가려요)',
      'AI가 열려 있는 터미널의 최근 출력을 읽을 수 있어요 (read_terminal) — 처음 읽을 때 허용을 묻고, 비밀번호·토큰처럼 보이는 값은 가려서 보내요',
      '비밀 가리기 규칙을 보강했어요 (API_TOKEN=… 처럼 이름 앞에 글자가 붙은 값도 가려요)'
    ],
    en: [
      'Export/import settings: move your hosts, snippets and theme with a single file (passwords are never included, and secret-looking values in snippets are masked)',
      'AI tools can read the recent output of an open terminal (read_terminal) — you are asked to allow it the first time, and password/token-like values are masked',
      'Improved secret masking (values with a prefix before the name, such as API_TOKEN=…, are masked too)'
    ]
  },
  {
    version: '4.2.0',
    ko: [
      '서비스 화면: Device의 systemd 서비스를 보고 시작·정지·재시작, journalctl 로그를 실시간으로 확인 (sudo 비밀번호가 필요하면 새 터미널에서 입력)',
      '기기 점검 화면: 온도·Wi-Fi 신호·디스크 SMART·실패한 서비스를 확인',
      '온도 80℃ 이상·실패한 서비스·디스크 이상이 생기면 알림 (연결된 동안 1분마다 확인)'
    ],
    en: [
      "Services screen: view and start/stop/restart the Device's systemd services and follow journalctl logs live (a new terminal asks for the sudo password when needed)",
      'Device check screen: temperature, Wi-Fi signal, disk SMART and failed services',
      'Notifications for temperatures of 80°C or more, failed services and disk problems (checked every minute while connected)'
    ]
  },
  {
    version: '4.1.0',
    ko: [
      '빈 편집기 화면이 시작 화면으로 바뀌었어요 — 최근 파일과 자주 쓰는 도구 버튼',
      '빌드 도구: colcon·catkin_make를 앱에서 실행하고, 오류 줄을 누르면 그 파일·줄로 이동 (rosdep은 새 터미널에서)',
      '파일 검색·바꾸기 (Ctrl+Shift+F): Device 폴더 안 글자를 찾고 한 번에 바꿔요',
      '탐색기에 Git 브랜치와 바뀐 파일 표시'
    ],
    en: [
      'The empty editor area is now a start screen with recent files and quick tool buttons',
      'Build tools: run colcon or catkin_make in the app and click an error line to jump to that file and line (rosdep runs in a new terminal)',
      'Search & replace in files (Ctrl+Shift+F): find text in a device folder and replace it in one go',
      'The explorer shows the Git branch and changed files'
    ]
  },
  {
    version: '4.0.1',
    ko: [
      '업데이트하면 바뀐 점을 앱에서 바로 볼 수 있어요 (도움말 옆 "업데이트 내용", 명령 팔레트)',
      'Device 화면 탭은 VNC로 설정한 연결에서만 보여요',
      '영어 화면 문구를 더 자연스럽게 다듬고, 테마 이름도 영어로 보여요'
    ],
    en: [
      'You can now see what changed after an update, right in the app ("What\'s new" next to Help, and the command palette)',
      'The Device screen tab only appears for connections set up with VNC',
      'Smoother wording on the English screens, and theme names now show in English'
    ]
  },
  {
    version: '4.0.0',
    ko: [
      '영어 화면 추가 — 연결 관리 화면의 English / 한국어 버튼으로 전환',
      '카메라 미리보기, Docker 패널, 여러 기기 대시보드, 모니터 기록·프로세스 목록',
      'ROS2 서비스·파라미터·bag, Device 화면(VNC 내장 뷰어·외부 실행), X11(rviz·rqt)'
    ],
    en: [
      'English screens — switch with the English / 한국어 button on the Connections screen',
      'Camera preview, Docker panel, multi-device dashboard, monitor history and process list',
      'ROS2 services, parameters and bags; Device screen (built-in VNC viewer, external launch); X11 (rviz, rqt)'
    ]
  }
]

const parts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// from(지난번 실행 버전)보다 새롭고 to(지금 버전) 이하인 항목, 최신순. from이 없으면(기록 전 버전에서 올라옴) 지금 버전 항목만
export function releasesSince(from: string | null, to: string): Release[] {
  return RELEASES.filter((r) => (from ? newer(r.version, from) : r.version === to) && !newer(r.version, to))
}
