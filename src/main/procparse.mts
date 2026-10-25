// 프로세스 목록·종료 (2.7.0 2단계): 젯슨에는 아무것도 설치하지 않고 ps·kill만 SSH로 실행. 출력 해석·명령 만들기 (Electron 없이 시험)
import { tr } from './i18n.mts'
import { shq } from './shq.mts'
export type Proc = { pid: number; user: string; cpu: number; mem: number; secs: number; args: string }
export type PsRow = Proc & { ppid: number }

// 프로세스 목록과 다른 SSH 접속 관찰이 같이 쓰는 ps 한 번 (따로 2초마다 읽지 않게)
// 전체 프로세스(수백 개, 몇십 KB)를 한 번에 받고 정렬·검색은 화면에서. -ww: 명령 줄이 잘리지 않게, user:32: 긴 사용자 이름이 숫자로 바뀌지 않게
// 관찰용으로 내 접속의 조상 프로세스(__ANC__)와 내 접속 주소(__IP__)도 함께 받음
export const PS_CMD =
  "echo __ME__=$(id -un); echo __IP__=$(echo $SSH_CONNECTION | cut -d' ' -f1); p=$$; while [ \"$p\" -gt 1 ]; do echo __ANC__=$p; p=$(ps -o ppid= -p $p | tr -d ' '); [ -z \"$p\" ] && break; done; echo __PS__; ps -ww -eo pid=,ppid=,user:32=,pcpu=,pmem=,etimes=,args= | head -2000"

const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/

// ps 줄들 (__PS__ 표시가 있으면 그 뒤만)
export function psRows(out: string): PsRow[] {
  const at = out.indexOf('__PS__')
  const rows: PsRow[] = []
  for (const line of (at < 0 ? out : out.slice(at)).split('\n')) {
    const m = line.match(ROW)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), user: m[3], cpu: Number(m[4]), mem: Number(m[5]), secs: Number(m[6]), args: m[7].trimEnd() })
  }
  return rows
}

export function parseProcs(out: string): { me: string; procs: Proc[] } {
  const me = out.match(/^__ME__=(.*)$/m)?.[1].trim() ?? ''
  // 이 목록을 읽는 ps 자신은 뺌
  const procs = psRows(out)
    .filter((r) => !r.args.includes('ps -ww -eo pid='))
    .map(({ ppid: _p, ...p }) => p)
  return { me, procs }
}

// 화면에 보여 줄 이름: 명령의 첫 단어 (경로 빼고). 커널 스레드는 "[kworker/0:1]" 그대로
export function procName(args: string): string {
  const first = args.split(' ')[0]
  return first.startsWith('[') ? args.split(']')[0] + ']' : first.slice(first.lastIndexOf('/') + 1) || first
}

// 이름 뒤에 이어지는 인자 부분 (이름은 경로를 뺀 값이라 원래 첫 단어 길이로 자름)
export const procRest = (args: string): string => (args.startsWith('[') ? '' : args.slice(args.split(' ')[0].length))

// 종료할 수 있는 프로세스: 내 계정 것만(다른 계정·root는 sudo 필요 → JetDeck은 비밀번호를 다루지 않음). 연결을 유지하는 sshd와 init은 막음
export function killBlock(p: Proc, me: string): string | null {
  if (!me || p.user !== me) return tr('다른 계정(root 등)의 프로세스예요. 종료하려면 sudo가 필요해서 터미널에서 직접 해 주세요')
  if (p.pid === 1) return tr('시스템 첫 프로세스예요')
  if (procName(p.args).startsWith('sshd')) return tr('이 연결(터미널·모니터 등)을 유지하는 sshd라 종료하면 연결이 끊겨요')
  return null
}
// 막지는 않지만 확인 창에 덧붙일 주의
export const killWarn = (p: Proc): string => (procName(p.args) === 'tegrastats' ? tr('\n\n※ 시스템 모니터가 쓰는 프로세스예요. 종료하면 모니터 값이 멈춰요.') : '')

export const isPid = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 1 && (v as number) <= 4194304

// 종료 직전에 그 PID의 명령이 방금 본 것과 같은지 다시 확인 (그 사이 다른 프로그램이 같은 PID를 쓰는 경우 방지)
export const killCommand = (pid: number, args: string, force: boolean) =>
  `[ "$(ps -ww -o args= -p ${pid})" = ${shq(args)} ] || { echo __CHANGED__; exit 0; }; kill -${force ? 'KILL' : 'TERM'} ${pid} 2>&1 && echo __OK__`

export function parseKill(out: string): void {
  if (out.includes('__OK__')) return
  if (out.includes('__CHANGED__')) throw new Error(tr('그 사이 프로세스가 끝나거나 바뀌었어요. 목록을 새로 읽었어요'))
  throw new Error(out.trim() || tr('종료하지 못했어요'))
}
