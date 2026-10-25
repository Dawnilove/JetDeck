import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detailOf, exitStatus, finishAct, redact, startAct, summarize, type Act } from './activitylog.mts'

test('redact: 비밀처럼 보이는 값은 가리고 평범한 명령은 그대로', () => {
  assert.equal(redact('ls -la ~/ros_ws && colcon build'), 'ls -la ~/ros_ws && colcon build')
  assert.equal(redact('export PASSWORD=hunter2 && run'), 'export PASSWORD=•••• && run')
  assert.equal(redact('export API_TOKEN=abc DB_PASSWORD: x'), 'export API_TOKEN=•••• DB_PASSWORD: ••••')
  assert.equal(redact('mysql --password=abc123 -u root'), 'mysql --password=•••• -u root')
  assert.equal(redact('sshpass -p "my pw" ssh host'), 'sshpass -p •••• ssh host')
  assert.equal(redact("echo 'pw1' | sudo -S apt update"), 'echo •••• | sudo -S apt update')
  assert.equal(redact('curl -H "Authorization: Bearer abcdefgh12345678" x'), 'curl -H "Authorization: Bearer ••••" x')
  assert.equal(redact('git clone https://user:s3cret@github.com/a/b'), 'git clone https://user:••••@github.com/a/b')
  assert.equal(redact('key=ghp_abcdefghijklmnopqrstuvwxyz0123'), 'key=••••')
  assert.equal(redact('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'), '(개인 키는 가렸어요)')
})

test('summarize: 명령은 가려서 300자까지, 파일 쓰기는 경로·크기만', () => {
  assert.equal(summarize('run_command', { command: '  TOKEN=abc python3 a.py ' }), 'TOKEN=•••• python3 a.py')
  assert.match(summarize('run_command', { command: 'x'.repeat(400) }), /…\(100자 생략\)$/)
  assert.equal(summarize('write_file', { path: '~/a.py', content: 'print(1)' }), '~/a.py (8자 저장)')
  assert.equal(summarize('list_dir', {}), '~')
  assert.equal(summarize('get_status', {}), '')
})

test('detailOf: 파일 읽기 내용은 기록 안 함, 나머지는 가려서 최대 길이', () => {
  assert.equal(detailOf('read_file', 'secret=abc'), '(파일 내용은 기록하지 않아요)')
  assert.equal(detailOf('run_command', 'password=abc'), 'password=••••')
  assert.match(detailOf('run_command', 'x'.repeat(30_000)), /…\(10000자 생략\)$/)
})

test('exitStatus: 종료 코드 0만 성공, 코드가 없으면(시간 초과) 오류', () => {
  assert.equal(exitStatus(0), 'ok')
  assert.equal(exitStatus(2), 'error')
  assert.equal(exitStatus(null), 'error')
})

test('startAct·finishAct: 500건(여기선 3건)까지만 보관, 끝나면 걸린 시간 기록', () => {
  const list: Act[] = []
  const base = { t: 1000, client: 'x', connId: 'c', host: 'h', tool: 'run_command', summary: 's' }
  const first = startAct(list, base, 3)
  assert.equal(first.status, 'running')
  assert.equal(first.ms, null)
  finishAct(first, 'ok', 'done', 3500)
  assert.deepEqual([first.status, first.ms, first.detail], ['ok', 2500, 'done'])
  for (let i = 0; i < 3; i++) startAct(list, base, 3)
  assert.equal(list.length, 3)
  assert.ok(!list.includes(first))
})
