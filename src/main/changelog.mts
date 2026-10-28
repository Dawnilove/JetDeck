// 업데이트 내용: 버전마다 핵심만 (한·영). 새 버전을 낼 때 맨 위에 한 항목 추가
export type Release = { version: string; ko: string[]; en: string[] }

export const RELEASES: Release[] = [
  {
    version: '5.4.0',
    ko: [
      '공식 팩 "ROS2 실시간·launch·bag (베타)"에 항목이 늘었어요: launch 파일 실행, bag 재생, bag 녹화(모든 토픽·토픽 하나). 기본 꺼짐이고, 내장 ROS2 화면은 그대로 있어서 나란히 써 볼 수 있어요',
      'launch와 bag 재생은 노드를 실행하거나 메시지를 다시 발행해서 로봇이 움직일 수 있어요. 그래서 앱이 읽기로 증명하지 못하고, 실행할 때마다 확인창이 떠요. bag 녹화는 터미널에 명령을 입력해요',
      '팩 항목에 "정지 유예(stopGrace)"를 적을 수 있어요. 실시간 항목을 멈출 때 Ctrl-C를 보낸 뒤 기기의 프로그램이 정리할 시간을 주는 값이에요 (기본 3초, 직접 설치하는 팩은 10초까지, 공식 팩은 30초까지)',
      '멈춤·화면 이동·연결 끊김·앱 강제 종료 뒤에 기기에 launch·bag 프로세스가 남지 않는지 실제 기기로 확인했어요. 팩 만드는 법(stopGrace·JSON Schema·예제)은 사이트의 plugins 문서에 추가됐어요'
    ],
    en: [
      'The official pack "ROS2 live, launch and bag (beta)" has new items: run a launch file, play a bag, record a bag (all topics, or one topic). It is off by default, and the built-in ROS2 screen is unchanged so you can use both side by side',
      'Launch and bag playback start nodes or publish messages again, so robots may move. The app cannot prove them read-only, so a confirm dialog appears every time. Recording a bag types the command into the terminal',
      'Pack items can now set a stop grace time (stopGrace): after Ctrl-C is sent when you stop a live item, the program on the device gets this much time to shut down (default 3 s; up to 10 s for packs you install, up to 30 s for official packs)',
      'We checked on a real device that no launch or bag process is left behind after stopping, leaving the screen, losing the connection or force-quitting the app. Writing stopGrace (JSON Schema, examples) is covered in the plugins docs on the website'
    ]
  },
  {
    version: '5.3.0',
    ko: [
      '보안 수정: 5.0.0~5.2.0의 팩 항목이 실행하는 git 명령과, 4.1.0~5.2.0의 탐색기 Git 표시가 믿을 수 없는 저장소(받은 압축 파일, 남의 clone)가 든 기기에서 그 저장소 설정에 적힌 프로그램을 실행할 수 있었어요. 이제 저장소 설정이 프로그램을 실행할 수 있으면 git을 실행하지 않고(폴더에 ⚠ 표시), 훅·서명 확인 프로그램·페이저도 꺼요. 업데이트를 권해요',
      '탐색기 배지: 팩이 폴더를 열 때 읽기 명령을 자동 실행해 파일·폴더 옆에 작은 표시(M·U 등)와 폴더 점(●), 기준 폴더 옆 태그(브랜치)를 붙여요. 앱이 읽기로 증명한 명령만 쓸 수 있고, 플러그인 관리의 "탐색기 배지" 스위치로 끌 수 있어요',
      '새 공식 팩 "개발 도구 (베타)": Git 상태 배지. 기본 꺼짐이고, 켜면 탐색기가 내장 Git 표시를 건너뛰어요 (내장 표시는 그대로 있어요)',
      '허용 창과 플러그인 관리 창에 배지 표시와 "폴더를 열 때" 줄이 생겼어요. 팩 만드는 법(배지 절·보안 절·JSON Schema·예제)은 사이트의 plugins 문서에 추가됐어요'
    ],
    en: [
      'Security fix: Git commands run by plugin items (5.0.0–5.2.0) and the Explorer\'s Git marks (4.1.0–5.2.0) could run programs set up inside an untrusted repository (a downloaded archive, someone else\'s clone) on the connected device. JetDeck now refuses to run Git when a repository\'s own settings can run programs (the folder shows a ⚠) and turns off hooks, signature programs and pagers. Updating is recommended',
      'Explorer badges: when you open a folder, a pack can run a read-only command by itself and add small marks (M, U…) next to files and folders, a dot (●) on folders, and a tag (the branch) beside the base folder. Only commands the app proves read-only are allowed, and the "Explorer badges" switch in the plugin manager turns them off',
      'New official pack "Developer tools (beta)": a Git status badge. Off by default; when on, the Explorer skips its built-in Git marks (the built-in marks are unchanged)',
      'The allow dialog and the plugin manager now show badges and a "When you open a folder" line. Writing badges (chapter, security chapter, JSON Schema, examples) is covered in the plugins docs on the website'
    ]
  },
  {
    version: '5.2.0',
    ko: [
      '플러그인 시계열 그래프: 팩이 읽기 명령을 되풀이해서 숫자를 선 그래프로 그려 줘요 (시작·멈춤·일시정지·지우기). 화면을 나가거나 연결이 끊기거나 앱을 닫으면 멈추고, 데이터는 앱 메모리에만 있어요',
      '새 공식 플러그인 "센서 그래프"(모니터·성능 팩): 온도·메모리·부하 평균·GPU 사용률·팬 속도. 모두 읽기 전용이고 시작을 눌러야 돌아요',
      '그래프는 앱이 읽기로 증명한 명령만 쓸 수 있어요. 간격은 직접 설치하는 팩이면 1초 이상이고, 느리면 간격을 늘리고, 연속 5번 실패하면 멈춰요. 허용 창과 플러그인 관리 창에 그래프 표시와 "N초마다" 구역이 생겼어요',
      '모니터 기록의 그래프 코드를 함께 쓰도록 정리했어요 (모양은 그대로). 팩 만드는 법(그래프 절·JSON Schema·예제)은 사이트의 plugins 문서에 추가됐어요'
    ],
    en: [
      'Plugin time-series charts: a pack can run a read-only command again and again and draw the numbers as a line chart (start, stop, pause, clear). Leaving the screen, losing the connection or closing the app stops it, and the data stays in the app\'s memory only',
      'New official plugin "Sensor charts" (Monitor & performance pack): temperature, memory, load average, GPU load and fan speed. All read-only, and they run only after you press Start',
      'A chart can use only commands the app proves read-only. For packs you install yourself the interval is at least 1 s, a slow command makes the interval longer, and 5 failures in a row stop it. The allow dialog and the plugin manager now mark charts and list "every N s" items',
      'The chart code of the monitor history is now shared (the look is unchanged). Writing charts (chapter, JSON Schema, examples) is covered in the plugins docs on the website'
    ]
  },
  {
    version: '5.1.0',
    ko: [
      '플러그인 2단계: 팩이 끝나지 않는 출력을 실시간 로그 카드로 보여 줘요 (시작·멈춤·지우기·복사·찾기·일시정지·따라가기). 화면을 나가거나 연결이 끊기거나 앱을 닫으면 기기의 명령도 같이 끝나요',
      '팩에 입력 칸을 넣을 수 있어요 (선택·글자·숫자·경로·체크). 입력한 값은 따옴표로 감싼 단어 하나로만 들어가고, 실행할 때마다 앱이 값을 채운 명령을 다시 분석해요. 값 때문에 위험해지면 확인창이 떠요',
      '새 항목: 기기 관리 → 로그 보기의 "서비스 로그 따라 보기"(journalctl -f). 새 공식 팩 "ROS2 실시간 보기(베타)"는 토픽 echo·hz를 보여 주고 기본 꺼짐이에요 (내장 ROS2 화면은 그대로)',
      '허용 창과 플러그인 관리 창에 "누르지 않아도 자동으로 실행되는 것" 구역과 실시간·입력 표시가 생겼어요. 팩 만드는 법은 사이트의 plugins 문서에 추가됐어요'
    ],
    en: [
      'Plugins stage 2: packs can show endless output in a live log card (start, stop, clear, copy, search, pause, follow). Leaving the screen, losing the connection or closing the app also ends the command on the device',
      'Packs can add input fields (choice, text, number, path, checkbox). A value goes into the command only as one quoted word, and the app re-analyzes the filled command before every run. If the value makes it riskier, a confirmation box appears',
      'New items: "Follow service log" (journalctl -f) under Device management → Logs. A new official pack "ROS2 live view (beta)" shows topic echo and hz and is off by default (the built-in ROS2 screen is unchanged)',
      'The allow dialog and the plugin manager now have a section for things that run on their own, plus live and input tags. Writing packs is covered in the plugins docs on the website'
    ]
  },
  {
    version: '5.0.0',
    ko: [
      '플러그인: JSON 팩 파일에 명령·표시 방식(글자·표)·버튼·확인창을 적으면 화면에 기능이 생겨요. 내 PC에서 코드는 실행되지 않고, 읽기로 증명된 명령만 묻지 않고 실행돼요. 환경 설정 → "플러그인 관리…"에서 팩을 설치하고, 명령 전문을 읽은 뒤 허용해야 켜져요',
      '앱에 팩이 함께 들어 있어요: 기기 관리(로그 보기·전원 모드 현재값 추가), ROS2 패키지·환경, 모니터·성능(젯슨 전용). 예제 팩(내 프로젝트·센서·학습 작업)은 꺼진 채로 들어 있어요. 스니펫은 "팩으로 내보내기"로 팩 파일로 저장할 수 있어요',
      '기기 관리 화면이 탭 1개에서 탭 4개(apt 업데이트·디스크·전원·로그)로 바뀌었어요. 재부팅·종료 예약의 확인창은 위험(빨강)으로 올라갔어요. 팩 만드는 법은 사이트의 plugins 문서에 있어요',
      '문제가 생기면 앱을 --safe-mode로 시작해 외부 팩을 모두 끌 수 있어요'
    ],
    en: [
      'Plugins: describe commands, how to show results (text or table), buttons and confirmation boxes in a JSON pack file and the feature appears. No code runs on your PC, and only commands proven read-only run without asking. Install packs from Settings → "Plugin manager…"; a pack turns on only after you read every command and allow it',
      'Packs ship with the app: Device management (adds Logs and current power mode), ROS2 packages & env, Monitor & performance (Jetson only). An examples pack (my project, sensors, training job) is included but turned off. Snippets can be saved as a pack file with "Export as pack"',
      'The Device management screen went from 1 tab to 4 tabs (apt updates, disk, power, logs). The scheduled reboot/shutdown confirmation is now danger (red). See the plugins docs on the website to write your own pack',
      'If something goes wrong, start the app with --safe-mode to turn off all external packs'
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
