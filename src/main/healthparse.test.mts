import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertsOf, healthCmd, parseHealth, smartResult } from './healthparse.mts'

const out = (smart: string) =>
  `__TEMP__\ncpu-thermal 45500\ngpu-thermal 83000\n__WIFI__\nwlan0: 52. -58. -256\n__SSID__\nHomeNet\n__FAILED__\nfoo.service\nbar.service\n__SMART__\n${smart}`

test('온도·Wi-Fi·SSID·실패한 서비스 해석', () => {
  const h = parseHealth(out('SKIPPED\n'))
  assert.deepEqual(h.temps, [{ name: 'cpu-thermal', c: 45.5 }, { name: 'gpu-thermal', c: 83 }])
  assert.deepEqual(h.wifi, [{ iface: 'wlan0', quality: 74, dbm: -58 }])
  assert.equal(h.ssid, 'HomeNet')
  assert.deepEqual(h.failed, ['foo.service', 'bar.service'])
  assert.deepEqual(h.smart, { state: 'skipped' })
})

test('Wi-Fi 없음 · 실패 없음 · 빈 출력', () => {
  const h = parseHealth('__TEMP__\n__WIFI__\n__SSID__\n__FAILED__\n__SMART__\nNOSMARTCTL\n')
  assert.deepEqual([h.temps, h.wifi, h.failed, h.ssid], [[], [], [], ''])
  assert.deepEqual(h.smart, { state: 'nosmartctl' })
  assert.deepEqual(parseHealth('').smart, { state: 'skipped' })
})

test('SMART: 디스크별 결과', () => {
  const h = parseHealth(out('DISK nvme0n1\nSMART overall-health self-assessment test result: PASSED\nDISK sda\nSMART overall-health self-assessment test result: FAILED!\nDISK mmcblk0\nSmartctl open device: /dev/mmcblk0 failed: Unsupported\nDISK sdb\nsudo: a password is required\n'))
  assert.deepEqual(h.smart.state === 'ok' && h.smart.disks, [
    { name: 'nvme0n1', result: 'ok' },
    { name: 'sda', result: 'fail' },
    { name: 'mmcblk0', result: 'unsupported' },
    { name: 'sdb', result: 'noperm' }
  ])
  assert.equal(smartResult('SMART Health Status: OK'), 'ok')
})

test('경고: 80℃ 이상·실패 서비스·SMART 실패만', () => {
  const keys = alertsOf(parseHealth(out('DISK sda\nresult: FAILED\n'))).map((a) => a.key)
  assert.deepEqual(keys, ['temp:gpu-thermal', 'svc:foo.service', 'svc:bar.service', 'smart:sda'])
  assert.deepEqual(alertsOf(parseHealth('__TEMP__\ncpu 60000\n')), [])
})

test('점검 명령: smart 여부', () => {
  assert.ok(healthCmd(true).includes('smartctl') && !healthCmd(false).includes('smartctl'))
})
