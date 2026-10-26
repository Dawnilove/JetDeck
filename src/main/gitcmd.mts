import { BADGE_GIT_GUARD } from './packrun.mts'
import { shq } from './shq.mts'

// dir 안에서 저장소 최상위와 상태를 한 번에 (git이 없거나 저장소가 아니면 출력이 비어 있음). dir은 shq로 감싸 넘길 것.
// 탐색기는 폴더를 열기만 해도 이 명령이 돌므로 배지와 같은 엄격한 git 보호(BADGE_GIT_GUARD)를 씀: 저장소 설정이 위험하면 git을 돌리지 않아 TOP이 비고 출력도 비어 parseGit이 null.
// timeout은 별도 프로세스라 셸 함수 git()을 못 부르므로 sh -c 바깥에 둠. (gitparse.mts는 화면도 가져가므로 packrun을 가져오는 이 코드는 따로 둠)
export const gitCommand = (qdir: string) =>
  `timeout 20 sh -c ${shq(`${BADGE_GIT_GUARD}cd ${qdir} 2>/dev/null && command -v git >/dev/null && TOP=$(git rev-parse --show-toplevel 2>/dev/null) && { printf 'TOP=%s\\n' "$TOP"; git status --porcelain=v1 -b -z --no-renames 2>/dev/null; }`)}`
