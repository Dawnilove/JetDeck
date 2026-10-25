// Claude(MCP)가 보낸 명령 중 사용자 승인이 필요한 것 (되돌릴 수 없거나 젯슨을 멈출 수 있는 명령)
import { tr } from './i18n.mts'
// shortcut: 단어 목록 검사라 r''m 같은 의도적 우회는 못 막음 — Claude의 실수를 막는 용도, 악의적 입력 방어는 아님
const WORDS = [
  'sudo', 'su', 'doas', // 관리자 권한
  'rm', 'rmdir', 'shred', 'unlink', 'truncate', // 삭제
  'mv', 'dd', 'mkfs', 'fdisk', 'parted', 'wipefs', 'mount', 'umount', // 덮어쓰기·디스크
  'chmod', 'chown', 'chgrp', // 권한
  'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'systemctl', 'service', 'nvpmodel', 'jetson_clocks', // 전원·서비스
  'kill', 'pkill', 'killall', // 프로세스 종료
  'apt', 'apt-get', 'dpkg', 'snap', 'pip', 'pip3', // 패키지 설치·삭제
  'crontab', 'passwd', 'useradd', 'userdel', 'usermod', // 시스템 설정
  'git' // push --force, reset --hard 등은 아래 FLAGS에서 따로 보면 너무 복잡 → git 전체를 확인
]
const WORD = new RegExp(`(^|[\\s;&|(\`$])(${WORDS.map((w) => w.replace(/[-.]/g, '\\$&')).join('|')})(?=$|[\\s;&|)\`])`)
// 파일을 통째로 덮어쓰는 리다이렉트(> 파일). 2>&1, >/dev/null, >> 이어쓰기는 제외
const OVERWRITE = /(^|[^0-9&>])>(?![>&])\s*(?!\/dev\/null\b)\S/

export function dangerous(cmd: string): string | null {
  const w = cmd.match(WORD)?.[2]
  if (w) return tr("'{0}' 명령", w)
  if (OVERWRITE.test(cmd)) return tr('파일 덮어쓰기(>)')
  return null
}
