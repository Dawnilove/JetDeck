// 업데이트 내용: 버전마다 핵심만 (한·영). 새 버전을 낼 때 맨 위에 한 항목 추가
export type Release = { version: string; ko: string[]; en: string[] }

// 릴리스 노트 주소: 버전 문자열이 숫자.숫자.숫자일 때만 (앱이 임의 주소를 열지 않게)
export const releaseUrl = (version: string): string | null => (/^\d+\.\d+\.\d+$/.test(version) ? `https://github.com/Dawnilove/JetDeck/releases/tag/v${version}` : null)

export const RELEASES: Release[] = [
  {
    version: '5.5.1',
    ko: [
      'MCP 오토파일럿: 승인 창 없이 명령 실행 (기본 꺼짐)',
      '승인 요청이 오면 데스크톱 알림과 창 깜빡임',
      '시스템 모니터에 GPU·메모리 클럭(MHz) 표시',
      '오토파일럿을 켜도 터미널 읽기는 직접 허용해야 해요'
    ],
    en: [
      'MCP autopilot: run commands without the approval dialog (off by default)',
      'Desktop notification and window flash when an approval is needed',
      'System monitor shows GPU and memory clocks (MHz)',
      'Terminal reads still need your approval when autopilot is on'
    ]
  },
  {
    version: '5.5.0',
    ko: [
      '모음 탭: 서명된 목록에서 팩을 보고 설치해요',
      '목록의 서명과 팩 파일 지문을 앱이 확인해요',
      '설치할 때 명령을 읽고 허용해야 켜져요',
      '처음 열 때 어떤 정보를 보내는지 안내해요',
      '오프라인·철회·만료 상태를 모음 탭 안에서 알려요'
    ],
    en: [
      'Gallery tab: browse and install packs from a signed list',
      'The app checks the list signature and each file fingerprint',
      'Read the commands and allow them before a pack turns on',
      'A first-use notice says what is sent',
      'Offline, withdrawn and expired states show inside the tab'
    ]
  },
  {
    version: '5.4.0',
    ko: [
      '공식 팩 "ROS2 실시간·launch·bag"(베타, 기본 꺼짐)에 항목 추가',
      'launch 실행·bag 재생·녹화는 실행할 때마다 확인창이 떠요',
      '팩 항목에 정지 유예(stopGrace) 설정 추가',
      '멈춘 뒤 기기에 프로세스가 남지 않는 것을 실기기로 확인'
    ],
    en: [
      'Official pack "ROS2 live, launch and bag" (beta, off by default) has new items',
      'Launch, bag play and bag record ask for confirmation every time',
      'Pack items can set a stop grace time (stopGrace)',
      'Checked on a real device: no process is left behind after stopping'
    ]
  },
  {
    version: '5.3.0',
    ko: [
      '보안 수정: 낯선 Git 저장소의 설정이 실행될 수 있던 문제',
      '탐색기 배지: 파일·폴더 옆에 M·U 같은 표시',
      '새 공식 팩 "개발 도구"(베타): Git 상태 배지',
      '허용 창·플러그인 관리에 배지 표시 추가'
    ],
    en: [
      'Security fix: settings of an untrusted Git repository could run programs',
      'Explorer badges: small marks such as M and U next to files and folders',
      'New official pack "Developer tools" (beta): Git status badge',
      'The allow dialog and plugin manager now show badges'
    ]
  },
  {
    version: '5.2.0',
    ko: [
      '플러그인 시계열 그래프: 읽기 명령을 되풀이해 선 그래프로 그려요',
      '새 공식 플러그인 "센서 그래프": 온도·메모리·부하·GPU·팬',
      '읽기로 증명된 명령만 쓰고, 연속 실패하면 멈춰요',
      '모니터 기록과 그래프 코드를 함께 쓰도록 정리했어요'
    ],
    en: [
      'Plugin time-series charts: a read-only command runs repeatedly and draws a line chart',
      'New official plugin "Sensor charts": temperature, memory, load, GPU, fan',
      'Only commands proven read-only run, and it stops after repeated failures',
      'The monitor history and charts now share the same chart code'
    ]
  },
  {
    version: '5.1.0',
    ko: [
      '플러그인 실시간 출력 카드: 시작·멈춤·찾기·따라가기',
      '팩 입력 칸(선택·글자·숫자·경로·체크), 위험하면 확인창',
      '새 항목 "서비스 로그 따라 보기", 공식 팩 "ROS2 실시간 보기"(베타)',
      '허용 창·관리 창에 자동 실행 구역과 실시간·입력 표시'
    ],
    en: [
      'Plugin live output card: start, stop, search, follow',
      'Pack input fields (choice, text, number, path, checkbox); risky values ask first',
      'New item "Follow service log" and official pack "ROS2 live view" (beta)',
      'The allow dialog and manager show auto-run items and live/input tags'
    ]
  },
  {
    version: '5.0.0',
    ko: [
      '플러그인: JSON 팩 파일로 명령과 버튼을 화면에 추가해요',
      '읽기로 증명된 명령만 묻지 않고 실행하고, 나머지는 허용이 필요해요',
      '공식 팩 포함, 기기 관리 화면이 탭 4개로 바뀌었어요',
      '문제가 생기면 --safe-mode로 외부 팩을 끌 수 있어요'
    ],
    en: [
      'Plugins: add commands and buttons to the screen with a JSON pack file',
      'Only commands proven read-only run without asking; the rest need your allow',
      'Official packs included; Device management now has 4 tabs',
      'If something goes wrong, start with --safe-mode to turn off external packs'
    ]
  },
  {
    version: '4.6.0',
    ko: [
      '파일 비교(diff): 편집기 위쪽의 "Device와 비교"로 기기에 저장된 파일과 지금 편집 중인 내용을 나란히 봐요 (오른쪽은 그대로 고칠 수 있어요)',
      '저장하려는데 기기에서 파일이 바뀌어 있으면 바로 덮어쓰기를 묻지 않고, 달라진 부분을 보여 준 뒤 "덮어쓰기"를 고르게 해요',
      '탭 복원: 연결을 다시 열면(앱을 다시 켠 뒤 포함) 열어 두었던 파일 탭과 보던 탭이 돌아와요. 기기별로 이 PC에만 기억하고, 저장하지 않은 내용은 복원하지 않아요'
    ],
    en: [
      'File compare (diff): "Compare with device" above the editor shows the file saved on the device next to what you are editing (the right side stays editable)',
      'If the file changed on the device since you opened it, saving no longer just asks to overwrite: it shows the differences first, then you choose "Overwrite"',
      'Tab restore: when you open the connection again (also after restarting the app), the file tabs you had open and the active tab come back. Remembered per device on this PC only; unsaved edits are not restored'
    ]
  },
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
