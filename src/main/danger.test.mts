// 실행: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dangerous } from './danger.mts'

test('위험한 명령은 승인 필요', () => {
  for (const c of ['rm -rf ~/x', 'sudo reboot', 'ls; rm a', 'cd /tmp && rm -f b', 'echo hi | sudo tee /etc/x', 'reboot', 'kill 123', 'pip install x', 'echo x > a.txt', 'cat a >b', 'git push -f', '$(rm x)'])
    assert.ok(dangerous(c), c)
})

test('일반 명령은 바로 실행', () => {
  for (const c of ['ls -la', 'df -h', 'nvidia-smi', 'tegrastats --interval 1000 | head -1', 'cat /etc/os-release', 'python3 train.py 2>&1', 'ros2 topic list >/dev/null', 'echo a >> log.txt', 'grep -rm1 foo .', 'firmware --version', 'ps aux | grep python'])
    assert.equal(dangerous(c), null, c)
})
