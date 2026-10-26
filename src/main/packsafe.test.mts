import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_OUTPUT, cleanText, sanitizeOutput } from './packsafe.mts'

test('ANSI 색·커서·제목(OSC)·링크 이스케이프 제거', () => {
  assert.equal(cleanText('\x1b[31mred\x1b[0m ok'), 'red ok')
  assert.equal(cleanText('a\x1b[2J\x1b[Hb'), 'ab')
  assert.equal(cleanText('\x1b]0;fake title\x07text'), 'text')
  assert.equal(cleanText('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\'), 'link')
  assert.equal(cleanText('x\x9b31my'), 'xy') // 8비트 CSI
})

test('제어 문자·BiDi·제로폭 제거, 줄바꿈과 탭은 유지, CR은 줄바꿈으로', () => {
  assert.equal(cleanText('a\x00b\x07c\x7fd'), 'abcd')
  assert.equal(cleanText('안전‮gpj.exe‬'), '안전gpj.exe')
  assert.equal(cleanText('a⁦b⁩​c'), 'abc')
  assert.equal(cleanText('a\tb\nc\r\nd\re'), 'a\tb\nc\nd\ne')
  assert.equal(cleanText('덮어쓰기\rfake'), '덮어쓰기\nfake') // 줄 앞으로 돌아가 앞 글자를 지우는 속임수 방지
})

test('256KB 상한: 넘으면 앞부분과 알림 한 줄', () => {
  const big = 'x'.repeat(MAX_OUTPUT + 500)
  const out = sanitizeOutput(big)
  assert.ok(out.startsWith('x'.repeat(100)))
  assert.ok(out.length < MAX_OUTPUT + 200)
  assert.ok(out.endsWith('앞부분만 보여요)'))
  assert.equal(sanitizeOutput('small'), 'small')
  assert.equal(sanitizeOutput('x'.repeat(MAX_OUTPUT)), 'x'.repeat(MAX_OUTPUT)) // 딱 상한은 그대로
})

test('비밀 가림: 정리 뒤에 적용됨 (이스케이프로 쪼갠 비밀도 가려짐)', () => {
  assert.ok(!sanitizeOutput('password=hunter2').includes('hunter2'))
  assert.ok(!sanitizeOutput('pass\x1b[0mword=hunter2').includes('hunter2'))
  assert.ok(!sanitizeOutput('tok​en=abcd1234').includes('abcd1234'))
  assert.ok(!sanitizeOutput('Authorization: Bearer abcdefghijklmnop').includes('abcdefghijklmnop'))
  assert.ok(!sanitizeOutput('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----').includes('AAAA'))
  assert.ok(!sanitizeOutput('x'.repeat(2_000_000) + ' password=hunter2').includes('hunter2')) // 거대한 입력도 끝나고 비밀은 남지 않음
})
