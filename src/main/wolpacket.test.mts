import assert from 'node:assert/strict'
import { test } from 'node:test'
import { magicPacket } from './wolpacket.mts'

test('magicPacket: FF 6바이트 + MAC 16번 = 102바이트, 형식이 틀리면 오류', () => {
  const p = magicPacket('02:00:00:00:00:01')
  assert.equal(p.length, 102)
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255])
  assert.deepEqual([...p.subarray(6, 12)], [0x02, 0x00, 0x00, 0x00, 0x00, 0x01])
  assert.throws(() => magicPacket('zz:00'))
})
