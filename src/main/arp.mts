// Windows `arp -a` / Linux /proc/net/arp 출력 → IP별 MAC (구분자는 '-'로 통일)
// 예: "  192.168.0.42          48-b0-2d-12-34-56     동적"
//     "192.168.0.42     0x1         0x2         48:b0:2d:12:34:56     *        eth0"
export function parseArp(out: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of out.matchAll(/(\d+\.\d+\.\d+\.\d+)[^\n]*?([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})/gi)) map.set(m[1], m[2].toLowerCase().replaceAll(':', '-'))
  return map
}
