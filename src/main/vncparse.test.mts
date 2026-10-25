import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeGuide, parseProbe, probeCmd } from './vncparse.mts'

test('점검 결과 읽기', () => {
  assert.deepEqual(parseProbe('grd=rdp x11vnc=no session=x11 port=closed uid=1000\n'), { grd: 'rdp', x11vnc: false, session: 'x11', portOpen: false, uid: 1000 })
  assert.equal(parseProbe(''), null)
  assert.equal(parseProbe('grd=vnc x11vnc=yes session=wayland port=open uid=1001')?.portOpen, true)
})

test('안내: 상황별', () => {
  const base = { grd: 'rdp', x11vnc: false, session: 'x11', portOpen: false, uid: 1000 } as const
  assert.equal(makeGuide(null).steps.length, 0)
  assert.match(makeGuide({ ...base, session: 'none' }).title, /로그인/)
  assert.match(makeGuide({ ...base, portOpen: true }).title, /연결하지 못했/)
  assert.match(makeGuide({ ...base, grd: 'vnc' }).steps[1].cmd, /vnc enable/)
  assert.equal(makeGuide({ ...base, session: 'wayland' }).steps.length, 0)
  const g = makeGuide(base)
  assert.match(g.steps[0].cmd, /apt install/)
  assert.match(g.steps[2].cmd, /run\/user\/1000\/gdm/)
  assert.equal(makeGuide({ ...base, x11vnc: true }).steps.length, 2)
})

test('연결 설정에서 바꾼 VNC 포트를 점검·안내에 씀', () => {
  assert.match(probeCmd(5901), /":5901 "/)
  assert.match(probeCmd(), /":5900 "/)
  const base = { grd: 'none' as const, x11vnc: true, session: 'x11', portOpen: false, uid: 1000 }
  assert.match(makeGuide(base, 5901).steps[1].cmd, /-rfbport 5901/)
  assert.doesNotMatch(makeGuide(base).steps[1].cmd, /rfbport/)
  assert.match(makeGuide({ ...base, portOpen: true }, 5901).text, /5901/)
})
