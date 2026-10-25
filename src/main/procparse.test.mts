import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPid, killBlock, killCommand, killWarn, parseKill, parseProcs, procName, procRest } from './procparse.mts'

const out = [
  '__ME__=dev',
  '__IP__=10.0.0.5',
  '__ANC__=2999',
  '__PS__',
  '    1     0 root       0.0  0.1  86400 /sbin/init splash',
  ' 2301  2000 dev       98.5 12.3    120 python3 /home/dev/train.py --epochs 10',
  ' 2400     2 dev        0.0  0.0     50 [kworker/0:1-events]',
  '  900     1 root       0.1  0.2   9000 sshd: dev [priv]',
  '  905   900 dev        0.0  0.0   9000 sshd: dev@notty',
  ' 3000  2999 dev        0.0  0.0      1 ps -ww -eo pid=,ppid=,user:32=,pcpu=,pmem=,etimes=,args=',
  ' 3100   905 dev        1.0  0.5     10 /usr/bin/tegrastats --interval 500'
].join('\n')

test('parseProcs: 사용자·CPU·메모리·실행 시간·명령, ps 자신은 제외', () => {
  const { me, procs } = parseProcs(out)
  assert.equal(me, 'dev')
  assert.deepEqual(procs.map((p) => p.pid), [1, 2301, 2400, 900, 905, 3100])
  assert.deepEqual(procs[1], { pid: 2301, user: 'dev', cpu: 98.5, mem: 12.3, secs: 120, args: 'python3 /home/dev/train.py --epochs 10' })
})

test('procName: 경로를 뺀 이름, 커널 스레드는 대괄호 그대로', () => {
  assert.equal(procName('/usr/bin/tegrastats --interval 500'), 'tegrastats')
  assert.equal(procName('python3 /home/dev/train.py'), 'python3')
  assert.equal(procName('[kworker/0:1-events]'), '[kworker/0:1-events]')
  assert.equal(procName('sshd: dev@notty'), 'sshd:')
  assert.equal(procRest('/usr/bin/tegrastats --interval 500'), ' --interval 500')
  assert.equal(procRest('[kworker/0:1-events]'), '')
})

test('killBlock: 내 계정만, init·sshd는 막음 / tegrastats는 경고만', () => {
  const { me, procs } = parseProcs(out)
  const by = (pid: number) => procs.find((p) => p.pid === pid)!
  assert.equal(killBlock(by(2301), me), null)
  assert.match(killBlock(by(1), me)!, /sudo/)
  assert.match(killBlock(by(900), me)!, /sudo/)
  assert.match(killBlock(by(905), me)!, /연결/)
  assert.equal(killBlock(by(3100), me), null)
  assert.match(killWarn(by(3100)), /모니터/)
  assert.equal(killWarn(by(2301)), '')
  assert.ok(killBlock(by(2301), ''))
})

test('종료 명령: PID 검사, 명령 재확인, 따옴표 처리', () => {
  assert.ok(isPid(2301) && !isPid(1) && !isPid(0) && !isPid('12') && !isPid(1.5) && !isPid(5_000_000))
  assert.equal(killCommand(2301, "a'b", false), `[ "$(ps -ww -o args= -p 2301)" = 'a'\\''b' ] || { echo __CHANGED__; exit 0; }; kill -TERM 2301 2>&1 && echo __OK__`)
  assert.match(killCommand(2301, 'x', true), /kill -KILL 2301/)
})

test('parseKill: 성공 / 바뀜 / 오류 문구', () => {
  parseKill('__OK__\n')
  assert.throws(() => parseKill('__CHANGED__\n'), /바뀌었어요/)
  assert.throws(() => parseKill('bash: kill: (1) - Operation not permitted\n'), /not permitted/)
  assert.throws(() => parseKill(''), /종료하지 못했어요/)
})
