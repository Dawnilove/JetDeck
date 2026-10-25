import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionCommand, followCommand, isContainerRef, isDockerAction, logsCommand, parseDocker } from './dockerparse.mts'

const ps = '{"ID":"a1b2c3","Names":"web,other/web","Image":"nginx:latest","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:80->80/tcp"}'
const ps2 = '{"ID":"d4e5f6","Names":"train","Image":"l4t-pytorch:r36","State":"exited","Status":"Exited (0) 3 days ago","Ports":""}'
const img = '{"ID":"sha1","Repository":"nginx","Tag":"latest","Size":"188MB","CreatedSince":"2 weeks ago"}'

test('정상 출력: 컨테이너·이미지 목록 (이름은 첫 번째만)', () => {
  const r = parseDocker(`__CONTAINERS__\n${ps}\n${ps2}\n__IMAGES__\n${img}\n`)
  assert.equal(r.state, 'ok')
  if (r.state !== 'ok') return
  assert.deepEqual(r.containers.map((c) => [c.id, c.name, c.state]), [['a1b2c3', 'web', 'running'], ['d4e5f6', 'train', 'exited']])
  assert.deepEqual(r.images, [{ id: 'sha1', repo: 'nginx', tag: 'latest', size: '188MB', created: '2 weeks ago' }])
})

test('비어 있어도 정상 (컨테이너·이미지 0개)', () => {
  assert.deepEqual(parseDocker('__CONTAINERS__\n__IMAGES__\n'), { state: 'ok', containers: [], images: [] })
})

test('docker 없음 · 권한 없음 · 데몬 꺼짐 · 그 밖의 오류 구분', () => {
  assert.deepEqual(parseDocker('__NODOCKER__\n'), { state: 'missing' })
  assert.deepEqual(parseDocker('__CONTAINERS__\npermission denied while trying to connect to the docker API at unix:///var/run/docker.sock\n__IMAGES__\npermission denied while trying\n'), { state: 'noperm' })
  assert.deepEqual(parseDocker('__CONTAINERS__\nCannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n__IMAGES__\n'), { state: 'down' })
  assert.deepEqual(parseDocker('__CONTAINERS__\nsomething odd\n__IMAGES__\n'), { state: 'error', text: 'something odd' })
  assert.deepEqual(parseDocker('엉뚱한 출력'), { state: 'error', text: '엉뚱한 출력' })
})

test('컨테이너 이름·동작 검사와 명령', () => {
  for (const ok of ['web', 'a1b2c3', 'my_app-1.2']) assert.ok(isContainerRef(ok))
  for (const bad of ['', '-rf', 'a b', 'a;rm -rf ~', '$(id)', 'a'.repeat(129), 1]) assert.ok(!isContainerRef(bad))
  assert.ok(isDockerAction('stop') && !isDockerAction('exec') && !isDockerAction('rmi'))
  assert.equal(actionCommand('stop', 'web'), 'docker stop web 2>&1')
  assert.equal(logsCommand('web'), 'docker logs --tail 200 web 2>&1')
  assert.equal(logsCommand('web', 99999), 'docker logs --tail 2000 web 2>&1')
  assert.equal(followCommand('web'), 'docker logs -f --tail 100 web')
})
