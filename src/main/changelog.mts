// 업데이트 내용: 버전마다 핵심만 (한·영). 새 버전을 낼 때 맨 위에 한 항목 추가
export type Release = { version: string; ko: string[]; en: string[] }

export const RELEASES: Release[] = [
  {
    version: '4.5.0',
    ko: [
      '기기 관리 도구: apt 업데이트 확인·설치, 디스크 사용량·큰 폴더 보기와 정리, 전원·부팅 설정(부팅 방식, 재부팅·종료 예약)을 한 화면에서 해요. 설치·정리·재부팅은 항상 확인창을 거치고, 정리는 미리보기를 본 뒤에만 실행돼요',
      'sudo가 필요한 작업은 비밀번호 없이 먼저 시도하고, 비밀번호가 필요하면 새 터미널에서 직접 입력하게 해요 (앱은 비밀번호를 받지 않아요)',
      '왼쪽 막대를 7개로 줄였어요: 같은 종류는 묶고 화면 위쪽 탭으로 오가요 (개발·실행 환경 / 연결·전송 / 기기 관리 / 화면·영상). 연결 관리는 위쪽 버튼으로 옮겼어요',
      '맨 위의 언어·테마·설정 내보내기/가져오기·진단 정보 저장을 "환경 설정" 메뉴 하나로 모았어요'
    ],
    en: [
      'Device tools: check and install apt updates, see disk usage and the largest folders and clean up, and manage power and boot settings (boot mode, scheduled reboot/shutdown) in one screen. Installs, cleanups and reboots always ask first, and cleanups only run after you have seen a preview',
      'Tasks that need sudo are tried without a password first; if one is needed, it is typed in a new terminal by you (the app never takes your password)',
      'The left bar is down to 7 icons: related screens are grouped and switched with tabs at the top (Dev & runtime / Connect & transfer / Device management / Display & video). The connection manager moved to a button in the top bar',
      'Language, theme, export/import settings and save diagnostics at the top are now in a single "Settings" menu'
    ]
  },
  {
    version: '4.4.0',
    ko: [
      '터미널 출력 검색: 터미널 위쪽 돋보기로 스크롤백에서 글자를 찾고, 저장 버튼으로 터미널 내용을 로그 파일로 저장해요',
      '진단 정보 저장: 문제를 신고할 때 붙일 정보(버전·OS·호스트 개수·최근 오류)를 파일로 저장해요 (기기 이름·주소·비밀번호는 빼고 비밀처럼 보이는 값은 가려요)',
      '설정 가져오기에 "같은 것은 덮어쓰기" 옵션 추가 (같은 주소·사용자의 호스트와 이름이 같은 스니펫을 바꿔요, 저장된 비밀번호는 그대로)',
      '편집기 빈 화면에 단축키 바로가기 추가',
      '카메라 화면 이름을 "영상 입력 미리보기"로 바꾸고, 앱 소개 문구를 "Jetson에 특화된, 모든 리눅스 기기를 위한 SSH 클라이언트"로 다듬었어요'
    ],
    en: [
      'Terminal output search: the magnifier above the terminal finds text in the scrollback, and the save button writes the terminal contents to a log file',
      'Save diagnostics: writes info to attach to a bug report (version, OS, host count, recent errors) to a file — device names, addresses and passwords are left out and secret-looking values are masked',
      'New "Overwrite existing" option for importing settings (replaces hosts with the same address and user and snippets with the same name; saved passwords are kept)',
      'Shortcuts list on the empty editor screen',
      'The Camera screen is now "Video input preview", and the app tagline reads "An SSH client built for Jetson, for any Linux device"'
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
