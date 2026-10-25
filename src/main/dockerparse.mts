// Docker 패널 2.6.0: 젯슨에는 아무것도 설치하지 않고 SSH로 docker CLI만 실행. 출력 해석·명령 만들기 (Electron 없이 시험)
export type Container = { id: string; name: string; image: string; state: string; status: string; ports: string }
export type DockerImage = { id: string; repo: string; tag: string; size: string; created: string }
export type DockerData =
  | { state: 'ok'; containers: Container[]; images: DockerImage[] }
  | { state: 'missing' | 'noperm' | 'down' } // docker 없음 / docker 그룹 아님 / 데몬 꺼짐
  | { state: 'error'; text: string }

// 목록을 읽는 원격 명령. 오류도 같은 출력으로 받아 종류를 구분함
export const LIST_CMD =
  "command -v docker >/dev/null || { echo __NODOCKER__; exit 0; }; echo __CONTAINERS__; docker ps -a --format '{{json .}}' 2>&1; echo __IMAGES__; docker images --format '{{json .}}' 2>&1"

const json = (line: string): Record<string, string> | null => {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
const s = (v: unknown) => (typeof v === 'string' ? v : '')

export function parseDocker(out: string): DockerData {
  if (out.includes('__NODOCKER__')) return { state: 'missing' }
  const m = out.match(/__CONTAINERS__\r?\n([\s\S]*?)__IMAGES__\r?\n([\s\S]*)$/)
  if (!m) return { state: 'error', text: out.trim() }
  const lines = [...m[1].split('\n'), ...m[2].split('\n')].map((l) => l.trim()).filter(Boolean)
  const msg = lines.filter((l) => !l.startsWith('{')).join('\n')
  if (msg) {
    if (/permission denied/i.test(msg)) return { state: 'noperm' }
    if (/cannot connect to the docker daemon|is the docker daemon running/i.test(msg)) return { state: 'down' }
    return { state: 'error', text: msg }
  }
  const containers: Container[] = []
  for (const l of m[1].split('\n')) {
    const o = l.trim() ? json(l.trim()) : null
    if (o) containers.push({ id: s(o.ID), name: s(o.Names).split(',')[0], image: s(o.Image), state: s(o.State), status: s(o.Status), ports: s(o.Ports) })
  }
  const images: DockerImage[] = []
  for (const l of m[2].split('\n')) {
    const o = l.trim() ? json(l.trim()) : null
    if (o) images.push({ id: s(o.ID), repo: s(o.Repository), tag: s(o.Tag), size: s(o.Size), created: s(o.CreatedSince) })
  }
  return { state: 'ok', containers, images }
}

// 컨테이너 이름·ID만 허용 (셸에 그대로 넣으므로)
export const isContainerRef = (v: unknown): v is string => typeof v === 'string' && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v)

export type DockerAction = 'start' | 'stop' | 'restart' | 'rm'
const ACTIONS: DockerAction[] = ['start', 'stop', 'restart', 'rm']
export const isDockerAction = (v: unknown): v is DockerAction => ACTIONS.includes(v as DockerAction)
export const actionCommand = (action: DockerAction, ref: string) => `docker ${action} ${ref} 2>&1`
export const logsCommand = (ref: string, tail = 200) => `docker logs --tail ${Math.max(1, Math.min(2000, Math.floor(tail) || 200))} ${ref} 2>&1`
// 새 터미널 탭에서 실시간으로 볼 때
export const followCommand = (ref: string) => `docker logs -f --tail 100 ${ref}`
