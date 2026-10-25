import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCommand, isBuildDir, isPackages, parseLine } from './buildparse.mts'

const W = '/home/u/ws'
test('parseLine: gcc 오류·경고에서 파일과 줄', () => {
  const e = parseLine('/home/u/ws/src/pkg/src/a.cpp:12:5: error: expected ‘;’', W)
  assert.deepEqual([e.sev, e.path, e.line], ['error', '/home/u/ws/src/pkg/src/a.cpp', 12])
  const w = parseLine('/home/u/ws/src/p/b.hpp:3:1: warning: unused variable', W)
  assert.deepEqual([w.sev, w.path, w.line], ['warning', '/home/u/ws/src/p/b.hpp', 3])
})
test('parseLine: 상대 경로는 워크스페이스 기준으로, 파이썬 트레이스백·CMake', () => {
  assert.equal(parseLine('../../src/p/c.cpp:7: error: x', '/home/u/ws/build/p').path, '/home/u/ws/src/p/c.cpp')
  assert.equal(parseLine('src/pkg/d.py:40: SyntaxError', W).path, '/home/u/ws/src/pkg/d.py')
  const t = parseLine('  File "/home/u/ws/src/p/run.py", line 33, in main', W)
  assert.deepEqual([t.path, t.line], ['/home/u/ws/src/p/run.py', 33])
  const c = parseLine('CMake Error at /home/u/ws/src/p/CMakeLists.txt:21 (find_package):', W)
  assert.deepEqual([c.sev, c.path, c.line], ['error', '/home/u/ws/src/p/CMakeLists.txt', 21])
})
test('parseLine: 색 코드 제거, 일반 줄, 오탐 없음, 종료 표시', () => {
  assert.equal(parseLine('\x1b[31mFailed\x1b[0m   <<< pkg [1.2s, exited with code 2]', W).sev, 'error')
  assert.equal(parseLine('bash: colcon: command not found', W).sev, 'error')
  assert.deepEqual(parseLine('Starting >>> pkg', W), { text: 'Starting >>> pkg', sev: 'plain' })
  assert.equal(parseLine('see https://github.com/a/b.git:8080 now', W).path, undefined)
  assert.equal(parseLine('12:30:45 done', W).path, undefined)
  assert.equal(parseLine('__JD_EXIT__2\r', W).exit, 2)
})
test('buildCommand: 옵션·패키지, 입력 검사', () => {
  assert.equal(buildCommand('colcon', "'/w'", { symlink: true, packages: ' a  b ' }), `cd '/w' && colcon build --symlink-install --packages-select a b; echo "__JD_EXIT__$?"`)
  assert.equal(buildCommand('catkin', "'/w'", { symlink: true, packages: 'x' }), `cd '/w' && catkin_make; echo "__JD_EXIT__$?"`)
  assert.ok(isPackages('my_pkg other-pkg') && !isPackages('a; rm -rf /') && !isPackages('a$(x)'))
  assert.ok(isBuildDir('/home/u/ws') && !isBuildDir('ws') && !isBuildDir('/a\nb'))
})
