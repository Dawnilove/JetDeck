import { createElement, Fragment, type ReactNode } from 'react'
import { tr } from '../../main/i18n.mts'

// 문장 안에 굵은 글씨·코드 같은 요소가 들어갈 때: 문장 전체를 한 번에 번역하고 {0}, {1} 자리에 요소를 끼움
// (문장을 조각내 따로 번역하면 영어 어순이 깨짐)
export function trNode(ko: string, ...parts: ReactNode[]): ReactNode {
  return tr(ko)
    .split(/\{(\d+)\}/)
    .map((x, i) => createElement(Fragment, { key: i }, i % 2 ? parts[Number(x)] : x))
}

// 연결 상태 글자 (점 옆에 항상 글자도 표시) — 작업 공간·시리얼·마스코트가 같이 씀
export type ConnStatus = 'online' | 'connecting' | 'offline'
export const STATUS_TEXT: Record<ConnStatus, string> = { online: tr('연결됨'), connecting: tr('연결 중'), offline: tr('끊김') }

// ipcRenderer.invoke 오류 앞에 붙는 "Error invoking remote method ..." 제거
export const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// 비밀번호 로그인을 막아 둔 기기(main/ssh.ts 문구)에 접속했을 때 보여 줄 해결 방법 — 연결 실패 터미널과 연결 테스트 아래에 같이 씀
export const pwBlocked = (msg: string) => msg.includes(tr('이 기기는 비밀번호 로그인을 막아 두었어요 (SSH 키만 허용). 인증 방식을 SSH 키로 바꿔 주세요'))
export const PW_HELP: { text: string; cmd?: string }[] = [
  { text: tr('1. Device에 등록된 SSH 키가 있으면: 호스트 수정 → 인증 방식 "SSH 키" (키 파일 칸을 비우면 ~/.ssh 기본 키 사용)') },
  { text: tr('2. 키가 없으면 이 PC에서 만들기 (PowerShell):'), cmd: 'ssh-keygen -t ed25519' },
  { text: '   ' + tr('만든 공개 키(%USERPROFILE%\\.ssh\\id_ed25519.pub 내용)를 Device의 ~/.ssh/authorized_keys에 추가. Device에 모니터·키보드를 연결하거나 USB 시리얼 콘솔로 들어가서 하거나, 관리자에게 등록을 부탁하세요') },
  { text: tr('3. 본인 Device라면 비밀번호 로그인 켜기: 아래 명령으로 "PasswordAuthentication no"가 있는 파일을 찾아 yes로 바꾼 뒤 sudo systemctl restart ssh'), cmd: 'sudo grep -rn PasswordAuthentication /etc/ssh/sshd_config /etc/ssh/sshd_config.d/' }
]
