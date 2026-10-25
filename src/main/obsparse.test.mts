import assert from 'node:assert/strict'
import { test } from 'node:test'
import { labelOf, parseObs, Tracker, type ObsSession } from './obsparse.mts'

// 내 접속(priv 104319 → sshd 104358 → bash 104359 → sh 104400)과 다른 접속 둘(notty 명령형, pts 터미널형)
const out = [
  '__ME__=dev',
  '__IP__=10.0.0.5',
  '__ANC__=104400',
  '__ANC__=104359',
  '__ANC__=104358',
  '__ANC__=104319',
  '__PS__',
  '104319     1 root  0.0  0.0                 100 sshd: dev [priv]',
  '104358 104319 dev  0.0  0.0                 100 sshd: dev@notty',
  '104359 104358 dev  0.0  0.0                 100 bash -s',
  '104400 104359 dev  0.0  0.0                   1 sh -c ps -ww',
  '200000     1 root  0.0  0.0                  50 sshd: dev [priv]',
  '200010 200000 dev  0.0  0.0                  50 sshd: dev@notty',
  '200011 200010 dev  0.0  0.0                  40 bash -c python3 train.py --epochs 3',
  '200020     1 root  0.0  0.0                  30 sshd: dev [priv]',
  '200030 200020 dev  0.0  0.0                  30 sshd: dev@pts/3',
  '200031 200030 dev  0.0  0.0                  30 -bash',
  '200040 200031 dev  0.0  0.0                  10 /usr/bin/python3 /home/dev/run.py',
  '300000     1 root  0.0  0.0                  20 sshd: other [priv]',
  '300010 300000 other  0.0  0.0                20 sshd: other@notty',
  '300011 300010 other  0.0  0.0                20 /usr/lib/openssh/sftp-server'
].join('\n')

test('parseObs: 내 접속은 빼고 다른 접속·명령을 찾음 (쉘 -c는 안쪽 문장, 일 없는 쉘은 무시)', () => {
  const snap = parseObs(out)!
  assert.equal(snap.me, 'dev')
  assert.equal(snap.ip, '10.0.0.5')
  assert.deepEqual(snap.sessions.map((s) => [s.pid, s.user, s.kind, s.cmds.map((c) => c.args)]), [
    [200010, 'dev', 'notty', ['python3 train.py --epochs 3']],
    [200030, 'dev', 'pts', ['/usr/bin/python3 /home/dev/run.py']],
    [300010, 'other', 'notty', ['/usr/lib/openssh/sftp-server']]
  ])
})

test('parseObs: 내 접속을 못 찾으면 보고하지 않음, ps 부분이 없으면 null', () => {
  assert.deepEqual(parseObs(out.replace(/__ANC__=\d+\n/g, ''))!.sessions, [])
  assert.equal(parseObs('__ME__=dev'), null)
})

test('labelOf: 종류·IP·이 PC·다른 계정', () => {
  assert.equal(labelOf({ kind: 'notty', user: 'dev' }, '10.0.0.9', '10.0.0.5', 'dev'), '다른 접속 · 명령형 · 10.0.0.9')
  assert.equal(labelOf({ kind: 'pts', user: 'dev' }, '10.0.0.5', '10.0.0.5', 'dev'), '다른 접속 · 터미널형 · 10.0.0.5 (이 PC)')
  assert.equal(labelOf({ kind: 'notty', user: 'root' }, '', '10.0.0.5', 'dev'), '다른 접속 · 명령형 · root 계정')
})

test('Tracker: 접속 시작·끝, 명령은 2번 보이거나 2초 넘게 돈 것만, 끝나면 end', () => {
  const s = (cmds: { pid: number; args: string; secs: number }[], secs = 5): ObsSession => ({ priv: 1, pid: 10, child: null, user: 'dev', kind: 'notty', secs, cmds })
  const t = new Tracker()
  let ev = t.update([s([{ pid: 11, args: 'ls', secs: 0 }])], 10_000)
  assert.deepEqual(ev.map((e) => `${e.type}:${e.phase}`), ['conn:start']) // 1번 본 짧은 명령은 아직
  assert.equal(ev[0].t, 5_000) // 접속 시작은 세션 나이로 거슬러 계산
  ev = t.update([s([{ pid: 11, args: 'ls', secs: 2 }, { pid: 12, args: 'python3 a.py', secs: 30 }])], 12_000)
  assert.deepEqual(ev.map((e) => `${e.type}:${e.phase}`), ['cmd:start', 'cmd:start'])
  assert.equal(ev[1].t, 12_000 - 30_000) // 이미 돌고 있던 명령은 시작 시각을 거슬러 계산
  ev = t.update([s([{ pid: 12, args: 'python3 a.py', secs: 32 }])], 14_000)
  assert.deepEqual(ev.map((e) => `${e.type}:${e.phase}`), ['cmd:end']) // ls 끝
  ev = t.update([], 16_000)
  assert.deepEqual(ev.map((e) => `${e.type}:${e.phase}`), ['conn:end', 'cmd:end'])
  // 한 번만 보이고 사라진 순간 명령은 아무 기록도 남기지 않음
  const t2 = new Tracker()
  t2.update([s([])], 1000)
  t2.update([s([{ pid: 99, args: 'tr', secs: 0 }])], 3000)
  assert.deepEqual(t2.update([s([])], 5000), [])
})
