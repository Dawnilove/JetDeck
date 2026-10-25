import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serialError } from './serialmsg.mts'

test('시리얼 오류 문구', () => {
  assert.match(serialError('Opening COM3: Access denied', 'COM3'), /다른 프로그램/)
  assert.match(serialError('Error: Permission denied, cannot open /dev/ttyUSB0', '/dev/ttyUSB0'), /dialout/)
  assert.match(serialError('Opening COM9: File not found', 'COM9'), /찾을 수 없어요/)
  assert.match(serialError('Error: No such file or directory, cannot open /dev/ttyACM0', '/dev/ttyACM0'), /찾을 수 없어요/)
  assert.equal(serialError('이상한 오류', 'COM1'), '이상한 오류')
})
