// ROS2 CLI 출력 파서 (main/ros.ts가 SSH로 실행한 결과를 읽음)
import { shq } from './shq.mts'
export type Topic = { name: string; type: string }
export type RosList = { distro: string; topics: Topic[]; nodes: string[] }
export type Launch = { pkg: string | null; file: string; path: string } // pkg가 있으면 설치된 패키지, 없으면 내 워크스페이스 소스

// ROS 이름: 영문·숫자·_·/·~ 만 (셸 명령에 넣기 전 검사)
export const isRosName = (s: string) => /^\/[\w/~]*$/.test(s)

// list 명령 출력: __DISTRO__=jazzy / __TOPICS__ / "/chatter [std_msgs/msg/String]" ... / __NODES__ / "/talker" ...
export function parseRosList(out: string): RosList | null {
  if (out.includes('__NOROS__')) return null
  const distro = out.match(/__DISTRO__=(\w*)/)?.[1] ?? ''
  const part = (start: string, end?: string) => {
    const i = out.indexOf(start)
    if (i < 0) return []
    const j = end ? out.indexOf(end, i) : -1
    return out.slice(i + start.length, j < 0 ? undefined : j).split('\n').map((l) => l.trim()).filter(Boolean)
  }
  const topics = part('__TOPICS__', '__NODES__')
    .map((l) => l.match(/^(\/\S*)\s+\[([^\]]+)\]$/))
    .filter((m) => m !== null)
    .map((m) => ({ name: m[1], type: m[2] }))
  const nodes = part('__NODES__').filter(isRosName)
  return { distro, topics, nodes }
}

// launch 파일: ROS2는 foo.launch.py·foo_launch.py·launch.py 모두 씀 (demo_nodes_cpp는 *_launch.py)
// launch 파일 경로 목록 → 설치된 패키지(…/share/<pkg>/…)면 패키지 이름, 아니면 워크스페이스 소스
export function parseLaunches(out: string): Launch[] {
  const seen = new Set<string>()
  const list: Launch[] = []
  for (const path of out.split('\n').map((l) => l.trim())) {
    if (!/(^|[/._-])launch\.(py|xml|ya?ml)$/.test(path) || seen.has(path)) continue
    seen.add(path)
    const pkg = path.match(/\/share\/([\w-]+)\/launch\//)?.[1] ?? null
    list.push({ pkg, file: path.split('/').pop()!, path })
  }
  // 내 워크스페이스 먼저, 그다음 패키지 이름순
  return list.sort((a, b) => (a.pkg === null ? 0 : 1) - (b.pkg === null ? 0 : 1) || (a.pkg ?? '').localeCompare(b.pkg ?? '') || a.path.localeCompare(b.path))
}

// ---- 2.4.0: 서비스·파라미터·bag ----

// ROS 파라미터 이름: 점으로 이어진 이름 (예: qos_overrides./parameter_events.publisher.depth)
export const isParamName = (s: string) => /^[\w./~-]+$/.test(s)
// 인터페이스 타입: pkg/srv/Name
export const isSrvType = (s: string) => /^\w+\/srv\/\w+$/.test(s)

export type Service = { name: string; type: string }
// `ros2 service list -t` 출력: "/add_two_ints [example_interfaces/srv/AddTwoInts]" (NOROS면 null)
export function parseServices(out: string): Service[] | null {
  if (out.includes('__NOROS__')) return null
  return out
    .split('\n')
    .map((l) => l.trim().match(/^(\/\S*)\s+\[([^\]]+)\]$/))
    .filter((m) => m !== null)
    .map((m) => ({ name: m[1], type: m[2] }))
}
// 노드마다 딸린 파라미터 서비스(/talker/get_parameters …)는 목록을 어지럽히므로 기본으로 숨김
export const isParamService = (name: string) => /\/(describe_parameters|get_parameter_types|get_parameters|get_type_description|list_parameters|set_parameters|set_parameters_atomically)$/.test(name)

// `ros2 interface show` 출력 → 요청 YAML 뼈대. 첫 --- 앞이 요청: "int64 a" → "{a: 0}"
export function requestTemplate(iface: string): string {
  const req = iface.split(/^---\s*$/m)[0]
  const fields = req
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l && !l.includes('=')) // 빈 줄·주석·상수 제외
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 2)
    .map(([type, name]) => {
      const base = type.replace(/\[.*\]$/, '')
      const v = /\[.*\]$/.test(type) ? '[]' : /^(u?int\d+|byte|char)$/.test(base) ? '0' : /^float\d+$/.test(base) ? '0.0' : base === 'bool' ? 'false' : /^w?string/.test(base) ? "''" : '{}'
      return `${name}: ${v}`
    })
  return `{${fields.join(', ')}}`
}

export type Param = { name: string; value: string }
// `ros2 param dump /node` 출력(YAML) → 점으로 이은 이름의 값 목록. 이름은 `ros2 param list`와 같음
export function parseParamDump(out: string): Param[] {
  const params: Param[] = []
  const stack: { indent: number; key: string }[] = []
  let list: { name: string; items: string[] } | null = null // 값 없이 "key:" 뒤에 "- x" 줄이 이어지는 목록
  const flush = () => {
    if (list?.items.length) params.push({ name: list.name, value: `[${list.items.join(', ')}]` })
    list = null
  }
  let started = false
  for (const raw of out.split('\n')) {
    const t = raw.trim()
    if (!t || t.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    if (!started) {
      started = t === 'ros__parameters:' // 노드 이름 줄 다음의 ros__parameters: 부터가 값
      continue
    }
    if (indent < 4) break // 다른 노드로 넘어감
    if (t.startsWith('- ')) {
      if (list) list.items.push(t.slice(2).trim())
      continue
    }
    const m = t.match(/^(.+?):(?:\s+(.*))?$/)
    if (!m) continue
    flush()
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const name = [...stack.map((s) => s.key), m[1]].join('.')
    if (m[2] !== undefined) params.push({ name, value: m[2] })
    else {
      stack.push({ indent, key: m[1] })
      list = { name, items: [] } // 뒤에 항목이 안 오면 하위 이름들의 부모일 뿐
    }
  }
  flush()
  return params
}

export type Bag = { path: string; name: string }
// metadata.yaml 경로 목록 → bag 폴더 (이름순)
export function parseBags(out: string): Bag[] {
  const seen = new Set<string>()
  const bags: Bag[] = []
  for (const l of out.split('\n').map((x) => x.trim())) {
    if (!l.startsWith('/') || !l.endsWith('/metadata.yaml')) continue
    const path = l.slice(0, -'/metadata.yaml'.length)
    if (seen.has(path)) continue
    seen.add(path)
    bags.push({ path, name: path.split('/').pop()! })
  }
  return bags.sort((a, b) => a.path.localeCompare(b.path))
}

// 터미널에서 실행할 명령 만들기 (bag 재생·녹화, launch)
export const bagPlayCommand = (path: string, loop: boolean, rate: number) => `ros2 bag play ${shq(path)}${loop ? ' -l' : ''}${rate !== 1 ? ` -r ${rate}` : ''}`
export const bagRecordCommand = (name: string, topics: string[]) => `ros2 bag record -o ${name} ${topics.length ? topics.map(shq).join(' ') : '-a'}`
// ros2 launch 명령: 설치된 패키지는 "패키지 파일", 워크스페이스 소스는 경로로
export const launchCommand = (l: Launch) => (l.pkg ? `ros2 launch ${shq(l.pkg)} ${shq(l.file)}` : `ros2 launch ${shq(l.path)}`)
export const isBagName = (s: string) => /^[\w-]{1,60}$/.test(s)
