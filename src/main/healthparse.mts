// 기기 점검 4.2.0: 온도·Wi-Fi 신호·디스크 SMART·실패한 서비스를 sysfs·proc·systemctl·smartctl(이미 있을 때만)로 읽음. 출력 해석·경고 판정 (Electron 없이 시험)
import { tr } from './i18n.mts'

export type SmartResult = 'ok' | 'fail' | 'noperm' | 'unsupported'
export type Health = {
  temps: { name: string; c: number }[]
  wifi: { iface: string; quality: number; dbm: number }[] // quality: 0~100
  ssid: string
  failed: string[]
  smart: { state: 'skipped' | 'nosmartctl' } | { state: 'ok'; disks: { name: string; result: SmartResult }[] }
}

export const TEMP_WARN = 80 // ℃ 이상이면 경고 (젯슨은 보통 ~97℃부터 성능을 낮춤)
export const WIFI_WEAK = -75 // dBm 이하면 약함

// smart=false면 SMART는 건너뜀 (sudo·디스크 접근이 무거워 자동 점검에서는 빼고 수동 점검 때만)
export const healthCmd = (smart: boolean) =>
  [
    'echo __TEMP__',
    'for z in /sys/class/thermal/thermal_zone*; do [ -r "$z/temp" ] && echo "$(cat "$z/type" 2>/dev/null | tr " " "_") $(cat "$z/temp")"; done',
    'echo __WIFI__',
    "awk 'NR>2{print $1,$3,$4}' /proc/net/wireless 2>/dev/null",
    'echo __SSID__',
    'iwgetid -r 2>/dev/null',
    'echo __FAILED__',
    'systemctl --failed --no-legend --plain --no-pager 2>/dev/null | awk \'{print $1}\'',
    'echo __SMART__',
    smart
      ? 'if command -v smartctl >/dev/null; then for d in $(lsblk -dno NAME,TYPE 2>/dev/null | awk \'$2=="disk"{print $1}\'); do echo "DISK $d"; timeout 15 sudo -n smartctl -H /dev/$d 2>&1 | head -15; done; else echo NOSMARTCTL; fi'
      : 'echo SKIPPED'
  ].join('; ')

const section = (out: string, name: string): string[] => {
  const m = out.match(new RegExp(`__${name}__\\r?\\n((?:(?!__[A-Z]+__)[\\s\\S])*)`))
  return m ? m[1].split('\n').map((l) => l.trim()).filter(Boolean) : []
}

export function smartResult(text: string): SmartResult {
  if (/a password is required|permission denied|must be root|sudo:/i.test(text)) return 'noperm'
  if (/PASSED|result:\s*OK|health status:\s*OK/i.test(text)) return 'ok'
  if (/(result|status|assessment)[^\n]*FAILED/i.test(text)) return 'fail'
  return 'unsupported' // eMMC·SD 카드 등 SMART가 없는 저장 장치
}

export function parseHealth(out: string): Health {
  const temps = section(out, 'TEMP').flatMap((l) => {
    const [name, raw] = l.split(/\s+/)
    const v = Number(raw)
    return name && Number.isFinite(v) ? [{ name, c: v / 1000 }] : []
  })
  // /proc/net/wireless: 인터페이스, link(품질, 보통 70 만점), level(dBm)
  const wifi = section(out, 'WIFI').flatMap((l) => {
    const [face, link, level] = l.split(/\s+/)
    const q = parseFloat(link)
    const dbm = parseFloat(level)
    return face && Number.isFinite(q) && Number.isFinite(dbm) ? [{ iface: face.replace(/:$/, ''), quality: Math.max(0, Math.min(100, Math.round((q / 70) * 100))), dbm }] : []
  })
  const failed = section(out, 'FAILED').filter((u) => u.endsWith('.service'))
  const sm = out.match(/__SMART__\r?\n([\s\S]*)$/)?.[1] ?? ''
  let smart: Health['smart']
  if (/^\s*NOSMARTCTL/m.test(sm)) smart = { state: 'nosmartctl' }
  else if (/^\s*DISK /m.test(sm)) {
    const disks = sm.split(/^\s*DISK /m).slice(1).map((blk) => {
      const nl = blk.indexOf('\n')
      return { name: (nl < 0 ? blk : blk.slice(0, nl)).trim(), result: smartResult(nl < 0 ? '' : blk.slice(nl)) }
    })
    smart = { state: 'ok', disks }
  } else smart = { state: 'skipped' }
  return { temps, wifi, ssid: section(out, 'SSID')[0] ?? '', failed, smart }
}

export type Alert = { key: string; text: string }
export function alertsOf(h: Health): Alert[] {
  const a: Alert[] = []
  for (const t of h.temps) if (t.c >= TEMP_WARN) a.push({ key: `temp:${t.name}`, text: tr('온도가 높아요: {0} {1}℃', t.name, Math.round(t.c)) })
  for (const u of h.failed) a.push({ key: `svc:${u}`, text: tr('실패한 서비스: {0}', u) })
  if (h.smart.state === 'ok') for (const d of h.smart.disks) if (d.result === 'fail') a.push({ key: `smart:${d.name}`, text: tr('디스크 SMART 경고: {0}', d.name) })
  return a
}
