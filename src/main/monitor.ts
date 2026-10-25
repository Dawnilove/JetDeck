import type { WebContents } from 'electron'
import type { Client } from 'ssh2'
import { record } from './history'
import { setWake, type Wake } from './store'
import { DEVICE_CMD, GENERIC_CMD, parseDevice, parseDf, parseModes, parseNvpQuery, parseProc, parseTegrastats, type CpuTimes, type PowerMode, type Stats } from './tegrastats.mts'

export type MonitorInfo = {
  tegrastats?: boolean // false = 젯슨이 아니거나 tegrastats 없음
  modes?: PowerMode[]
  mode?: PowerMode | null
  disk?: { used: number; total: number } | null // KB
  ros?: string
  python?: string
  generic?: boolean // true = tegrastats가 없어 /proc·/sys로 읽는 일반 리눅스, false = 그것도 못 읽음
  model?: string // 기기 이름 (/proc/device-tree/model)
  jetpack?: string
  cuda?: string
  wake?: Wake // 절전 명령에서 깨우기 설정(ethtool wol g)을 켤 랜카드 이름
}

// SSH 접속에 쓰인 랜카드(= 매직 패킷을 받을 카드)의 이름·MAC·브로드캐스트 주소
// SSH_CONNECTION의 세 번째 값이 젯슨 쪽 주소 → 그 주소를 가진 인터페이스를 찾음
const WAKE_CMD = [
  'SRV=$(echo $SSH_CONNECTION | cut -d" " -f3 | cut -d% -f1)', // IPv6 링크 로컬은 "fe80::…%enP8p1s0"처럼 뒤에 인터페이스가 붙음
  'IF=$(ip -o addr show | awk -v ip="$SRV" \'index($4, ip"/")==1 {print $2; exit}\')',
  '[ -n "$IF" ] && echo "IF=$IF MAC=$(cat /sys/class/net/$IF/address) BRD=$(ip -o -4 addr show dev $IF | awk \'{for(i=1;i<NF;i++) if($i=="brd") {print $(i+1); exit}}\')"'
].join('; ')
export type MonitorEvent = { kind: 'stats'; stats: Stats } | { kind: 'info'; info: MonitorInfo }

// 명령 하나 실행하고 표준 출력을 문자열로
export function run(client: Client, cmd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    client.exec(cmd, (err, ch) => {
      if (err) return reject(err)
      ch.on('error', () => {}) // 채널 오류로 main 프로세스가 죽지 않게
      let out = ''
      ch.on('data', (d: Buffer) => (out += d.toString('utf8')))
      ch.stderr.on('data', () => {}) // 오류 출력은 버림 (읽지 않으면 채널이 막힐 수 있음)
      ch.on('close', () => resolve(out))
    })
  )
}

// 같은 SSH 연결에 터미널과 별도 채널을 열어 모니터 값 수집. 연결이 끊기면 채널도 같이 닫힘
// shortcut: OpenSSH 기본 MaxSessions=10 — 터미널 탭을 7개 넘게 열면 채널이 모자랄 수 있음, 필요하면 서버 설정 안내
// 연결별 마지막 모니터 값 (MCP get_status가 읽음). 연결이 끊기면 지움
export const latest = new Map<string, { stats?: Stats; info: MonitorInfo }>()

export function startMonitor(connId: string, hostId: string, client: Client, wc: WebContents): void {
  latest.set(connId, { info: {} })
  client.once('close', () => latest.delete(connId))
  const send = (e: MonitorEvent) => {
    const l = latest.get(connId)
    if (e.kind === 'stats') record(connId, e.stats)
    if (l && e.kind === 'stats') l.stats = e.stats
    else if (l && e.kind === 'info') l.info = { ...l.info, ...e.info }
    if (!wc.isDestroyed()) wc.send('monitor', connId, e)
  }

  // 깨우기 정보: 호스트에 저장해 두면 연결 관리 화면에서 '깨우기' 가능
  run(client, WAKE_CMD)
    .then((o) => {
      const m = o.match(/IF=(\S+) MAC=([0-9a-fA-F:]{17}) BRD=(\S*)/)
      if (!m) return
      const wake = { iface: m[1], mac: m[2], brd: m[3] }
      setWake(hostId, wake)
      send({ kind: 'info', info: { wake } })
    })
    .catch(() => {})

  // tegrastats가 없는 기기(라즈베리 파이 등)는 /proc·/sys에서 직접 읽음. 첫 값은 이전 값이 없어 사용률을 못 구하므로 건너뜀
  const startGeneric = () => {
    send({ kind: 'info', info: { tegrastats: false } })
    client.exec(GENERIC_CMD, (err, ch) => {
      if (err) return send({ kind: 'info', info: { generic: false } })
      ch.on('error', () => {})
      let buf = ''
      let times: CpuTimes = {}
      let got = false
      ch.on('data', (d: Buffer) => {
        buf += d.toString('utf8')
        let i: number
        while ((i = buf.indexOf('@@\n')) >= 0) {
          const r = parseProc(buf.slice(0, i), times)
          buf = buf.slice(i + 3)
          times = r.times
          if (!r.stats) continue
          if (!got) send({ kind: 'info', info: { generic: true } })
          got = true
          send({ kind: 'stats', stats: r.stats })
        }
      })
      ch.stderr.on('data', () => {})
      ch.on('close', () => !got && send({ kind: 'info', info: { generic: false } }))
    })
  }
  client.exec('tegrastats --interval 500', (err, ch) => {
    if (err) return startGeneric()
    ch.on('error', () => {})
    let buf = ''
    let got = false
    ch.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.includes('RAM ')) continue
        got = true
        send({ kind: 'stats', stats: parseTegrastats(line) })
      }
    })
    ch.stderr.on('data', () => {})
    ch.on('close', () => !got && startGeneric())
  })

  // 기기 이름·JetPack·CUDA 버전은 한 번만
  run(client, DEVICE_CMD)
    .then((o) => send({ kind: 'info', info: parseDevice(o) }))
    .catch(() => {})

  // 전원 모드 목록은 보드마다 다르므로 보드 설정 파일에서 읽음
  run(client, 'grep POWER_MODEL /etc/nvpmodel.conf 2>/dev/null')
    .then((o) => send({ kind: 'info', info: { modes: parseModes(o) } }))
    .catch(() => {})
  // ROS·Python 버전: ROS 환경은 보통 .bashrc에서 잡히므로 대화형 셸(-i)로 확인
  run(client, `bash -ic 'echo "ROS=\${ROS_DISTRO:-$(rosversion -d 2>/dev/null)}"; echo "PY=$(python3 --version 2>&1)"' 2>/dev/null`)
    .then((o) =>
      send({
        kind: 'info',
        info: { ros: o.match(/^ROS=(.*)$/m)?.[1].trim() ?? '', python: o.match(/^PY=Python (\S+)/m)?.[1] ?? '' }
      })
    )
    .catch(() => {})

  // 전원 모드·디스크는 자주 안 바뀌므로 10초마다
  const poll = () =>
    run(client, 'nvpmodel -q 2>/dev/null; echo ---; df -kP / | tail -1')
      .then((o) => {
        const [q, df] = o.split('---')
        send({ kind: 'info', info: { mode: parseNvpQuery(q), disk: parseDf(df ?? '') } })
      })
      .catch(() => {})
  poll()
  const timer = setInterval(poll, 10_000)
  client.once('close', () => clearInterval(timer))
}
