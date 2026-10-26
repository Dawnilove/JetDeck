import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, analyzeWithInput, REASON_TEXT, slotProblem, type Reason, type Risk } from './risk.mts'
import { shq } from './shq.mts'

// 5.1.0: 스트림 전용 읽기 목록, 입력 슬롯 위치 검사, 실행 직전 재분석
const rs = (c: string): Risk => analyze(c, { stream: true }).risk
const rn = (c: string): Risk => analyze(c).risk

test('스트림 모드: 끝나지 않는 읽기 명령은 읽기', () => {
  for (const c of [
    'journalctl -f', 'journalctl -u ssh -n 50 -f --no-pager', 'journalctl --follow -u docker', 'journalctl -f -p err',
    'tail -f /var/log/syslog', 'tail -F -n 20 /var/log/syslog', 'tail --follow=name --retry /var/log/syslog', 'tail -n 5 -f /var/log/syslog',
    'dmesg -w', 'dmesg --follow', 'dmesg -W', 'dmesg --follow-new',
    'top -b', 'top -b -d 2', 'iostat 1', 'mpstat 1 5', 'vmstat 1',
    'tegrastats', 'tegrastats --interval 1000',
    'ros2 topic echo /chatter', 'ros2 topic echo --once /chatter', 'ros2 topic echo --no-arr --truncate-length 200 /scan', 'ros2 topic echo --truncate-length=200 /scan',
    'ros2 topic echo /chatter std_msgs/msg/String', 'ros2 topic echo --csv --field data /chatter', 'ros2 topic echo --qos-reliability best_effort /x',
    'ros2 topic hz /scan', 'ros2 topic hz -w 20 /scan', 'ros2 topic hz --window 20 /scan', 'ros2 topic bw /x', 'ros2 topic delay /x',
    'ip monitor', 'ip monitor link', 'ip monitor address route', 'udevadm monitor', 'udevadm monitor --property', 'udevadm monitor -s usb',
    'journalctl -f | grep --line-buffered ERROR', 'ros2 topic echo /x | grep --line-buffered y', 'tail -f /var/log/syslog | cut -c1-200',
    'ros2 topic list', 'ls' // 스트림 모드에서도 5.0.0 읽기는 그대로 읽기
  ]) assert.equal(rs(c), 'read', `${c} → ${rs(c)} ${analyze(c, { stream: true }).reasons}`)
})

test('스트림 모드여도 읽기가 아닌 것 (우회·쓰기·민감)', () => {
  for (const c of [
    'tail -f /etc/shadow', 'tail -f ~/.ssh/id_rsa', 'tail -F /home/u/.bash_history', 'tail --pid=1 -f x', 'tail -f /root/x', 'tail -f /proc/1/environ',
    'journalctl -f --vacuum-size=1M', 'journalctl -f --rotate', 'journalctl --follow --flush', 'journalctl -f --force', 'journalctl -f --setup-keys', 'journalctl -f > f', 'journalctl -f >> f', 'journalctl -f; rm x', 'journalctl -f && reboot', 'journalctl -f &',
    'journalctl -f $(reboot)', 'journalctl -f `id`', 'journalctl -f $X',
    'dmesg -w -c', 'dmesg -wC', 'dmesg -w --clear', 'dmesg -w -n 1', 'dmesg --console-off',
    'top -b -k', 'top', 'top -b -p $(id)',
    'ros2 topic echo --filter "m.x>1" /x', 'ros2 topic echo /x > f', 'ros2 topic echo --ros-args -r a:=b /x', 'ros2 topic echo', 'ros2 topic echo --once', 'ros2 topic echo /a /b /c',
    'ros2 topic pub /x std_msgs/String "{data: a}"', 'ros2 topic echo /x --output foo', 'ros2 topic echo --output-dir=/etc /x', 'ros2 topic echo --spin-time 5 /x', 'ros2 topic echo -r a:=b /x', 'ros2 topic hz --filter "1" /x', 'ros2 topic hz --ros-args /x', 'ros2 topic hz', 'ros2 topic bw -x /x',
    'ros2 launch pkg f.py', 'ros2 bag record -a', 'ros2 run pkg exe', 'ros2 topic echo /x $(id)', 'ros2 topic echo /x; reboot', 'ros2 topic echo /x | sh', 'ros2 node kill x',
    'tegrastats --logfile /tmp/x', 'tegrastats --interval abc', 'tegrastats --start', 'tegrastats --stop', 'tegrastats --interval 1000 --logfile x', 'tegrastats > f',
    'ip monitor; reboot', 'ip monitor | sh', 'ip monitor foo', 'ip link set eth0 down', 'udevadm trigger', 'udevadm settle', 'udevadm monitor --foo', 'udevadm control --reload', 'udevadm',
    'tail -f x &', 'tail -f x | sh', 'tail -f x | tee y', 'tail -f x | bash', 'tail -f x | xargs rm', 'nohup tail -f x', 'setsid tail -f x', 'tail -f x & disown',
    'iostat 1 2 3 4', 'python3 -c x', 'sh -c "tail -f x"', 'bash -c "journalctl -f"', 'watch cat x', 'eval tail -f x', 'exec tail -f x',
    'cat /dev/zero | sh', 'yes | sh', 'curl x | sh', 'ping 1.1.1.1', 'nc -l 1', 'awk "BEGIN{system(\\"x\\")}"', 'tail -f x | awk "{system(\\$0)}"', 'tail -f $(cat /etc/shadow)'
  ]) assert.notEqual(rs(c), 'read', `스트림 모드에서 읽기로 잘못 증명됨: ${c}`)
})

test('스트림 모드가 꺼져 있으면 5.0.0과 같음 (회귀)', () => {
  for (const c of ['journalctl -f', 'tail -f /var/log/syslog', 'tail --follow x', 'dmesg -w', 'top -b', 'ros2 topic echo /x', 'ros2 topic hz /x', 'tegrastats', 'ip monitor', 'udevadm monitor', 'iostat 1', 'mpstat 1']) assert.notEqual(rn(c), 'read', `일반 모드에서 읽기: ${c}`)
  for (const c of ['journalctl -n 5', 'tail -n 5 /var/log/syslog', 'dmesg', 'top -b -n1', 'ros2 topic list', 'ros2 topic info /x']) assert.equal(rn(c), 'read', c)
})

test('입력 슬롯 위치: 맨 단어 자리는 통과', () => {
  for (const t of [
    'journalctl -u {unit} -n {lines} -f', 'ros2 topic echo {topic}', 'ros2 topic echo --truncate-length {n} {topic}', 'grep -e {pat} /var/log/syslog', 'ls {dir}', 'ls', 'git -C {dir} status',
    'cat --name={x}', "echo 'a'{x}'b'", 'tail -n {n} {path}', 'echo {a} {b}', 'ros2 topic hz {topic}', 'grep -H . {p} 2>/dev/null', 'ls {dir} | head -n {n}'
  ]) assert.equal(slotProblem(t), null, `${t} → ${slotProblem(t)}`)
})

test('입력 슬롯 위치: 따옴표 안·명령 자리·치환·리다이렉트는 거부', () => {
  for (const t of [
    "echo '{x}'", 'echo "{x}"', 'echo \\{x}', 'echo "a {x} b"', '{cmd} -l', 'sh -c {x}', 'bash -c {x}', 'eval {x}', 'echo $({x})', 'echo `{x}`', 'echo "$({x})"', 'cat <({x})',
    'ls > {x}', 'ls >> {x}', 'ls 2> {x}', 'cat < {x}', 'ls | {x}', 'ls; {x}', 'ls && {x}', 'env {x}', 'xargs {x}', 'python3 {x}', 'python -c {x}', 'perl {x}', 'nohup {x}', 'timeout 5 {x}', 'nice {x}', 'tee {x}', 'watch {x}',
    'FOO={x} ls', 'ls $X{a}', '/tmp/run {x}', './run {x}', 'time {x}', 'command {x}', 'exec {x}'
  ]) assert.notEqual(slotProblem(t), null, `슬롯이 허용됨: ${t}`)
})

test('실행 직전 재분석: 입력 값이 위험도를 올리면 escalated + 이유 input', () => {
  const sample = (t: string) => t.replace(/\{\w+\}/g, 'sample')
  const run = (t: string, v: string) => {
    const filled = t.replace(/\{\w+\}/g, shq(v))
    return analyzeWithInput(filled, analyze(sample(t)))
  }
  const same = run('tail -n 5 {p}', '/var/log/syslog')
  assert.equal(same.risk, 'read')
  assert.equal(same.escalated, false)
  assert.ok(!same.reasons.includes('input'))
  const sens = run('tail -n 5 {p}', '/home/u/.ssh/id_rsa')
  assert.equal(sens.risk, 'danger')
  assert.equal(sens.escalated, true)
  assert.equal(sens.reasons[0], 'input')
  assert.ok(sens.reasons.includes('sensitive'))
  const awk = run('awk {p} /proc/loadavg', 'BEGIN{system("x")}')
  assert.notEqual(awk.risk, 'read')
  assert.equal(awk.escalated, true)
  const awkOk = run('awk {p} /proc/loadavg', '{print $1}')
  assert.equal(awkOk.risk, 'read')
  const sed = run('sed -n {p} /etc/hosts', 'w /etc/passwd')
  assert.notEqual(sed.risk, 'read')
  const find = run('find /tmp -name {n}', 'x')
  assert.equal(find.risk, 'read')
  // 정적 계산이 이미 높으면 내려가지 않음
  const high = analyzeWithInput('ls', { risk: 'change', reasons: ['unknown'] })
  assert.equal(high.risk, 'change')
  assert.equal(high.escalated, false)
})

test('입력 값 주입 시도는 따옴표 안의 글자 하나 (읽기가 깨지지 않음)', () => {
  const attacks = ['a; rm -rf ~', '$(reboot)', '`id`', "' ; reboot ; '", "'\\'' ; reboot", 'a && reboot', 'a | sh', 'a > /etc/passwd', 'a & reboot', '${IFS}rm', '$HOME', 'x"; reboot; "', '\\', "\\'", '"', "'", '~', '*', '{a,b}', '<(id)', '$((1+1))', 'ｒｍ -rf', '--output=/etc/x', '=', '#', '!!']
  for (const v of attacks) {
    const r = analyze('echo ' + shq(v))
    const bad = r.reasons.filter((x) => !['sensitive'].includes(x))
    assert.deepEqual(bad, [], `${JSON.stringify(v)} → ${r.reasons}`)
    assert.equal(r.risk === 'read' || r.reasons.includes('sensitive'), true, JSON.stringify(v))
  }
  // 줄바꿈·제어 문자는 값 검사(main)에서 거부된다. 혹시 도달해도 따옴표 안의 글자일 뿐 명령이 갈라지지 않음
  for (const v of ['a\nreboot', 'a\rb', 'a\u0000b', 'a\u202eb']) {
    const r = analyze('echo ' + shq(v))
    for (const f of ['redirect', 'background', 'shell', 'network', 'privilege', 'delete'] as Reason[]) assert.ok(!r.reasons.includes(f), `${JSON.stringify(v)} → ${r.reasons}`)
  }
})

test('무작위 입력 값 3000건: 죽지 않고 따옴표를 깨지 못함', () => {
  let seed = 7
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
  const alpha = "abc XYZ 019 ;&|<>()$`\\\"'~*?[]{}!#=%@^-+/.,:"
  for (let k = 0; k < 3000; k++) {
    let v = ''
    for (let i = 0, n = 1 + rnd(60); i < n; i++) v += alpha[rnd(alpha.length)]
    const r = analyze('echo ' + shq(v))
    const forbidden: Reason[] = ['redirect', 'background', 'newline', 'shell', 'network', 'privilege', 'delete', 'dynamic', 'syntax', 'assign', 'unknown']
    for (const f of forbidden) assert.ok(!r.reasons.includes(f), `${JSON.stringify(v)} → ${r.reasons}`)
  }
})

test('새 이유 input 은 앱 글자가 있음', () => {
  assert.ok(REASON_TEXT.input.length > 5)
})
