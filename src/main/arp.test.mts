// 실행: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArp } from './arp.mts'

test('Windows arp -a 출력에서 IP별 MAC (한글·영문 표기 모두)', () => {
  const m = parseArp(`
인터페이스: 192.168.0.10 --- 0x7
  인터넷 주소           물리적 주소           유형
  192.168.0.1           88-36-6c-aa-bb-cc     동적
  192.168.0.42          48-B0-2D-12-34-56     동적
  192.168.0.255         ff-ff-ff-ff-ff-ff     정적
Interface: 192.168.55.100 --- 0x9
  Internet Address      Physical Address      Type
  192.168.55.1          00-04-4b-01-02-03     dynamic
`)
  assert.equal(m.get('192.168.0.42'), '48-b0-2d-12-34-56')
  assert.equal(m.get('192.168.55.1'), '00-04-4b-01-02-03')
  assert.equal(m.has('192.168.0.10'), false) // 인터페이스 줄은 MAC이 없어 제외
})

test('Linux /proc/net/arp', () => {
  const m = parseArp(`IP address       HW type     Flags       HW address            Mask     Device
192.168.0.42     0x1         0x2         48:B0:2D:12:34:56     *        wlp2s0
192.168.0.7      0x1         0x0         00:00:00:00:00:00     *        wlp2s0
`)
  assert.equal(m.get('192.168.0.42'), '48-b0-2d-12-34-56')
})
