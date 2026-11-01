import { tr } from './i18n.mts'
import { safeName } from './permpath.mts'
// 시리얼 포트를 열 때 나는 오류를 사용자 문구로 (Windows·Linux 문구가 달라서 둘 다 봄)
export function serialError(msg: string, rawPath: string): string {
  const path = safeName(rawPath) // 장치가 알려 준 이름에 보이지 않는 글자가 있을 수 있다
  if (/access denied|EBUSY|resource busy|cannot lock|port is locked/i.test(msg)) return tr('{0}을(를) 다른 프로그램(PuTTY, Arduino IDE 등)이 쓰고 있어요. 그 프로그램을 닫고 다시 시도하세요', path)
  if (/permission denied|EACCES/i.test(msg))
    return tr('{0}에 접근 권한이 없어요. 터미널에서 sudo usermod -aG dialout $USER 실행 후 로그아웃했다가 다시 로그인하세요', path)
  if (/file not found|cannot find|ENOENT|no such file/i.test(msg)) return tr('{0}을(를) 찾을 수 없어요. USB 케이블이 연결됐는지 확인하세요', path)
  return msg
}
