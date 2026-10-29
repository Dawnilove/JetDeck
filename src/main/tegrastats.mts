// 젯슨 출력 파서 (순수 함수 — tegrastats.test.mts에서 테스트)
// Nano(L4T R32):  ... CPU [38%@1428,...] GR3D_FREQ 27% PLL@44C CPU@47C GPU@45C thermal@46C POM_5V_IN 2890/2890
// Orin(L4T R36+): ... CPU [1%@883,...] GR3D_FREQ 0% cpu@46.187C/46.187C gpu@46.656C/46.656C tj@46.8C/... VDD_IN 4694mW/4694mW/4694mW

export type Core = { pct: number | null; mhz: number | null } // pct null = 꺼진 코어(off)
export type Stats = {
  ram: { used: number; total: number } | null // MB
  ramMhz?: number | null // MHz (EMC / 램 클럭)
  cpu: Core[]
  gpu: number | null // %
  gpuMhz?: number | null // MHz (GPU 클럭)
  temps: { cpu: number | null; gpu: number | null; board: number | null; boardName: string | null } // °C
  powerMw: number | null // 보드 전체 입력 전력
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s))
const toMhz = (raw: string | undefined): number | null => {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 100_000_000) return Math.round(n / 1_000_000) // Hz -> MHz (예: 1020000000 -> 1020)
  if (n >= 100_000) return Math.round(n / 1_000) // KHz -> MHz (예: 1020000 -> 1020)
  return Math.round(n) // 이미 MHz
}

export function parseTegrastats(line: string): Stats {
  const ram = line.match(/RAM (\d+)\/(\d+)MB/)
  const cpuBlock = line.match(/CPU \[([^\]]*)\]/)?.[1] ?? ''
  const cpu = cpuBlock
    .split(',')
    .filter(Boolean)
    .map((c): Core => {
      const m = c.trim().match(/^(\d+)%(?:@(\d+))?/)
      return m ? { pct: Number(m[1]), mhz: num(m[2]) } : { pct: null, mhz: null }
    })
  // 온도: 이름@숫자C (Orin은 "cpu@46.1C/46.1C"처럼 뒤에 최대값이 붙음 → 앞 값만)
  const t: Record<string, number> = {}
  // 꺼진 센서는 -256C 같은 값이 나옴 → 없는 값으로 (그래야 board도 다음 후보 센서로 넘어감)
  for (const m of line.matchAll(/(?:^|\s)([A-Za-z][\w]*)@(-?\d+(?:\.\d+)?)C/g)) if (Number(m[2]) > -40) t[m[1].toLowerCase()] = Number(m[2])
  const boardName = ['thermal', 'tj', 'soc0', 'ao', 'pmic'].find((k) => k in t) ?? null
  const power = line.match(/(?:VDD_IN|POM_5V_IN) (\d+)(?:mW)?\//)
  const gr3d = line.match(/(?:GR3D_FREQ|GR3D)\s+(\d+)%(?:@(\d+))?/)
  const gpuCur = line.match(/GPU_CUR=(\d+)/)?.[1]
  const gpuMhz = gr3d?.[2] ? Number(gr3d[2]) : toMhz(gpuCur)

  const emc = line.match(/(?:EMC_FREQ|EMC)\s+(?:\d+%)?@(\d+)/)
  const emcCur = line.match(/EMC_CUR=(\d+)/)?.[1]
  const ramMhz = emc?.[1] ? Number(emc[1]) : toMhz(emcCur)

  return {
    ram: ram ? { used: Number(ram[1]), total: Number(ram[2]) } : null,
    ramMhz,
    cpu,
    gpu: gr3d ? Number(gr3d[1]) : num(line.match(/GR3D_FREQ (\d+)%/)?.[1]),
    gpuMhz,
    temps: { cpu: t.cpu ?? null, gpu: t.gpu ?? null, board: boardName ? t[boardName] : null, boardName },
    powerMw: num(power?.[1])
  }
}

// /etc/nvpmodel.conf 의 "< POWER_MODEL ID=0 NAME=15W >" 줄 → 전원 모드 목록 (보드마다 다름)
export type PowerMode = { id: number; name: string }
export function parseModes(conf: string): PowerMode[] {
  return [...conf.matchAll(/^\s*<\s*POWER_MODEL\s+ID=(\d+)\s+NAME=([^\s>]+)\s*>/gm)].map((m) => ({ id: Number(m[1]), name: m[2] }))
}

// `nvpmodel -q` → "NV Power Mode: 25W\n1"
export function parseNvpQuery(out: string): PowerMode | null {
  const m = out.match(/NV Power Mode:\s*(\S+)\s*\n\s*(\d+)/)
  return m ? { id: Number(m[2]), name: m[1] } : null
}

// `df -k /` 마지막 줄 → 사용량(KB)
export function parseDf(out: string): { used: number; total: number } | null {
  const cols = out.trim().split('\n').at(-1)?.trim().split(/\s+/) ?? []
  const [total, used] = [Number(cols[1]), Number(cols[2])]
  return Number.isFinite(total) && Number.isFinite(used) && total > 0 ? { used, total } : null
}

// ---- tegrastats가 없는 일반 리눅스(라즈베리 파이 등): /proc·/sys에서 읽은 한 번 분량 ----
// GENERIC_CMD가 0.5초마다 이 형식으로 한 번 분량을 내보냄 (마지막 줄 "@@"가 끝 표시)
export const GENERIC_CMD =
  "while :; do grep -E '^cpu[0-9]+ ' /proc/stat; grep -E '^Mem(Total|Available):' /proc/meminfo; " +
  'grep -H . /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq /sys/class/thermal/thermal_zone*/temp /sys/class/thermal/thermal_zone*/type 2>/dev/null; echo @@; sleep 0.5; done'

export type CpuTimes = Record<number, [number, number]> // 코어 번호 → [전체 tick, 놀고 있던 tick] (이전 값과 비교해 사용률을 구함)

// 첫 번째 값은 비교할 이전 값이 없어 stats가 null
export function parseProc(out: string, prev: CpuTimes): { stats: Stats | null; times: CpuTimes } {
  const times: CpuTimes = {}
  for (const m of out.matchAll(/^cpu(\d+) +([\d ]+)$/gm)) {
    const f = m[2].trim().split(/\s+/).map(Number)
    times[Number(m[1])] = [f.slice(0, 8).reduce((a, b) => a + b, 0), (f[3] ?? 0) + (f[4] ?? 0)] // idle + iowait
  }
  const ids = Object.keys(times).map(Number).sort((a, b) => a - b)
  if (!ids.length || !ids.every((i) => prev[i])) return { stats: null, times }
  const mhz: Record<number, number> = {}
  for (const m of out.matchAll(/cpu(\d+)\/cpufreq\/scaling_cur_freq:(\d+)/g)) mhz[Number(m[1])] = Math.round(Number(m[2]) / 1000)
  const cpu = ids.map((i): Core => {
    const dt = times[i][0] - prev[i][0]
    const di = times[i][1] - prev[i][1]
    return { pct: dt > 0 ? Math.max(0, Math.min(100, Math.round((100 * (dt - di)) / dt))) : 0, mhz: mhz[i] ?? null }
  })
  const kb = (k: string) => Number(out.match(new RegExp('^' + k + String.raw`:\s+(\d+) kB`, 'm'))?.[1])
  const total = kb('MemTotal')
  const avail = kb('MemAvailable')
  // 온도: thermal_zoneN의 type(cpu-thermal 등)과 temp(밀리도)를 짝지음
  const zones: { type: string; c: number | null }[] = []
  for (const m of out.matchAll(/thermal_zone(\d+)\/type:(.+)/g)) (zones[Number(m[1])] ??= { type: '', c: null }).type = m[2].trim()
  for (const m of out.matchAll(/thermal_zone(\d+)\/temp:(-?\d+)/g)) (zones[Number(m[1])] ??= { type: '', c: null }).c = Number(m[2]) / 1000
  const valid = zones.filter((z) => z && z.c != null && z.c > -40)
  const cpuZ = valid.find((z) => /cpu|x86_pkg|coretemp|k10temp|soc/i.test(z.type)) ?? valid[0]
  const gpuZ = valid.find((z) => /gpu/i.test(z.type))
  const boardZ = valid.find((z) => z !== cpuZ && z !== gpuZ)
  return {
    stats: {
      ram: Number.isFinite(total) && Number.isFinite(avail) ? { used: Math.round((total - avail) / 1024), total: Math.round(total / 1024) } : null,
      ramMhz: null,
      cpu,
      gpu: null,
      gpuMhz: null,
      temps: { cpu: cpuZ?.c ?? null, gpu: gpuZ?.c ?? null, board: boardZ?.c ?? null, boardName: boardZ?.type || null },
      powerMw: null
    },
    times
  }
}

// 기기 이름·JetPack·CUDA 버전 (한 번만 읽음). 명령은 DEVICE_CMD, 출력 해석은 parseDevice
export const DEVICE_CMD = [
  String.raw`echo "JP=$(dpkg-query -W nvidia-jetpack 2>/dev/null | cut -f2)"`,
  String.raw`echo "L4T=$(head -1 /etc/nv_tegra_release 2>/dev/null)"`,
  String.raw`echo "NVCC=$( (nvcc --version || /usr/local/cuda/bin/nvcc --version) 2>/dev/null | grep -o 'release [0-9.]*' | head -1)"`,
  String.raw`echo "CUDAJSON=$(tr -d '\n ' </usr/local/cuda/version.json 2>/dev/null | head -c 200)"`,
  String.raw`echo "MODEL=$(tr -d '\0' </proc/device-tree/model 2>/dev/null)"`
].join('; ')
export function parseDevice(out: string): { model?: string; jetpack?: string; cuda?: string } {
  const get = (k: string) => out.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim() ?? ''
  const jp = get('JP').match(/^[\d.]+/)?.[0]
  const l4t = get('L4T').match(/R(\d+) \(release\), REVISION: ([\d.]+)/)
  const cuda = get('CUDAJSON').match(/"cuda":\{"name":"CUDASDK","version":"([\d.]+)"/)?.[1] ?? get('NVCC').match(/release ([\d.]+)/)?.[1]
  return { model: get('MODEL') || undefined, jetpack: jp ? `JetPack ${jp}` : l4t ? `L4T ${l4t[1]}.${l4t[2]}` : undefined, cuda: cuda ? `CUDA ${cuda}` : undefined }
}
