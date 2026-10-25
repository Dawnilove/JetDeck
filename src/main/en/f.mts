// 영어 사전 f묶음 (4.0.0 출시 전 점검 반영): 문장을 통째로 번역한 안내(trNode), 새 확인 창·버튼
export const EN_F: Record<string, string> = {
  // 언어 전환·연결 정리
  '언어를 바꾸면 화면을 다시 불러와요.\n열린 연결 {0}개가 끊기고, 저장하지 않은 파일 {1}개의 변경 내용은 사라져요. 바꿀까요?':
    'Switching the language reloads the window.\n{0} open connection(s) will be closed, and unsaved changes in {1} file(s) will be lost. Switch language?',
  'AI 도구': 'AI tool',
  '관찰을 꺼서 기록을 멈췄어요': 'Recording stopped because watching was turned off',
  'AI 활동 기록 {0}건을 모두 지울까요? 되돌릴 수 없어요.': 'Clear all {0} AI activity records? This cannot be undone.',

  // 작업 공간·화면
  'Device 화면 열기': 'Open device screen',
  '영상 입력 열기': 'Open video input',
  '스니펫 편집: {0}': 'Edit snippet: {0}',
  '왼쪽 탐색기에서 파일을 열면 여기에 표시돼요. 저장은 {0}': 'Open a file from the explorer on the left and it will show up here. Save with {0}',
  'PC 뷰어로 열기 ({0})': 'Open in PC viewer ({0})',
  '접속하기': 'Connect',
  '카메라를 찾는 중…': 'Looking for cameras…',

  // Docker 확인 창
  "'{0}' 컨테이너를 정지할까요? 안에서 실행 중인 작업(학습·서버 등)이 멈춰요.": "Stop the container '{0}'? Jobs running inside it (training, servers, etc.) will stop.",
  "'{0}' 컨테이너를 다시 시작할까요? 안에서 실행 중인 작업이 중단돼요.": "Restart the container '{0}'? Jobs running inside it will be interrupted.",
  "'{0}' 컨테이너를 삭제할까요? 컨테이너 안에만 있던 파일은 되돌릴 수 없어요.": "Delete the container '{0}'? Files that existed only inside it cannot be recovered.",

  // 연결 관리 화면 안내
  '설치 후 시작 메뉴의 XLaunch에서 "Multiple windows → Display number 0 → Start no client → \'Disable access control\' 체크" 순서로 실행하세요. Windows 방화벽 허용 창이 뜨면 허용하지 말고 "취소"를 누르세요 (JetDeck은 이 PC 안에서만 연결해서 방화벽을 열 필요가 없고, 열면 같은 네트워크의 다른 기기가 이 PC 화면에 접근할 수 있어요). 실행했으면 아래 버튼으로 다시 확인하세요.':
    'After installing, start XLaunch from the Start menu and choose "Multiple windows → Display number 0 → Start no client → check \'Disable access control\'". If a Windows Firewall prompt appears, do not allow it — click "Cancel" (JetDeck connects only inside this PC, so the firewall does not need to be opened; opening it would let other devices on the network reach this PC\'s screen). Once it is running, check again with the button below.',
  '젯슨의 {0}를 PC에 꽂으면 COM 포트가 생겨요. USB-TTL 변환기를 디버그 UART 핀에 연결해도 돼요.': "Plug the Jetson's {0} into the PC and a COM port appears. You can also connect a USB-TTL adapter to the debug UART pins.",
  '포트가 안 보이면 장치 관리자 → {0}에서 드라이버를 확인하고 새로고침을 누르세요.': "If the port doesn't show up, check the driver in Device Manager → {0}, then click Refresh.",
  '속도는 보통 {0}이에요. 네트워크가 안 될 때도 로그인할 수 있어요.': 'The speed is usually {0}. You can log in this way even when the network is down.',
  'Micro-USB 케이블로 PC와 직접 연결했다면 {0} 주소로 바로 접속할 수 있어요.': 'If you connected directly to the PC with a Micro-USB cable, you can connect right away at {0}.',

  // 사용 가이드
  'Device(Jetson 등)에 SSH로 접속해서 {0}을 한 화면에서 할 수 있는 앱이에요.': 'Connect to a device (Jetson, etc.) over SSH and use {0} all in one window.',
  '{0}에 이름, 호스트(IP 주소 또는 {1}), 사용자 이름을 넣고 {2}을 누르세요.': 'In {0}, enter a name, host (IP address or {1}), and username, then click {2}.',
  '인증은 {0} 또는 {1}. 암호가 걸린 키는 Windows의 ssh-agent에 등록({2})해 두면 돼요.': 'Authentication: {0} or {1}. For a passphrase-protected key, add it to the Windows ssh-agent ({2}).',
  '처음 접속하면 {0} 창이 떠요. 지문이 Device 것과 같으면 {1}을 누르세요.': 'On first connection, a {0} window appears. If the fingerprint matches the device, click {1}.',
  'Micro-USB 케이블로 직접 연결했다면 호스트에 {0}을 넣으면 돼요.': 'If you connected directly with a Micro-USB cable, enter {0} as the host.',
  '{0}: 파일을 클릭하면 편집기로 열려요. 우클릭하면 새 파일, 이름 바꾸기, 삭제, 터미널에서 열기.': '{0}: click a file to open it in the editor. Right-click for new file, rename, delete, and open in terminal.',
  '{0}: {1}로 Device에 바로 저장. 그사이 Device에서 파일이 바뀌었으면 덮어쓰기 전에 물어봐요.': '{0}: {1} saves straight to the device. If the file changed on the device in the meantime, you are asked before overwriting.',
  '{0}: {1}로 탭 추가, 옆 버튼으로 좌우 분할, {2}로 넓게 보기.': '{0}: {1} adds a tab, the next button splits left/right, and {2} gives you a wider view.',
  '{0}에서 CPU, GPU, 메모리, 저장공간, 온도, 소비 전력을 0.5초마다 보여 줘요. (액티비티 바의 맥박 아이콘으로 접기/펴기)': '{0} shows CPU, GPU, memory, storage, temperature, and power draw every 0.5 seconds. (Collapse/expand it with the pulse icon in the activity bar.)',
  '{0}를 고르면 터미널에 {1} 명령이 입력돼요. 비밀번호는 터미널에 직접 입력하세요.': '{0}: choosing a mode types {1} into the terminal. Enter your password in the terminal yourself.',
  '{0}시킨 Device는 연결 관리 화면의 호스트 옆 {1}(전원 아이콘)로 다시 켤 수 있어요. 같은 유선망에서만 되고, 한 번 접속하면 자동으로 준비돼요.': '{0}: to bring the device back, use {1} (power icon) next to the host on the Connections screen. It only works on the same wired network and is set up automatically after you connect once.',
  '{0}는 확인 창을 거친 뒤 실행돼요. 완전히 끈 Device는 전원 버튼을 직접 눌러야 켜져요.': '{0} run after a confirmation. A device that is fully powered off must be turned on with its power button.',
  '액티비티 바의 {0}(다운로드 아이콘): 왼쪽은 내 컴퓨터, 오른쪽은 Device예요.': 'Open {0} (download icon) in the activity bar: your computer is on the left, the device on the right.',
  '파일을 고르고 {0} / {1}를 누르거나, 반대편으로 {2}. 윈도우 탐색기에서 Device 쪽으로 끌어와도 돼요.': 'Select files and click {0} / {1}, or {2} to the other side. You can also drag from Windows Explorer onto the device side.',
  '{0}는 연결 관리 화면 오른쪽 위나 명령 팔레트에서 바꿀 수 있어요.': '{0}: change it at the top right of the Connections screen or in the command palette.',
  '이 가이드는 {0} 버튼이나 명령 팔레트의 {1}로 언제든 다시 볼 수 있어요.': 'You can reopen this guide any time with the {0} button or {1} in the command palette.'
}
