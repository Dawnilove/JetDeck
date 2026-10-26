import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BadgeResult } from '../../../main/packbadgecore.mts'
import { applyResults, chipsFor, covered, dotFor, tagAt, type BadgeMeta } from './badgeview.mts'

const L = { ko: '깃', en: 'git' }
const M = (show: string) => ({ show, tone: 'warn' as const, text: L })
const ok: BadgeResult = { packId: 'p', badgeId: 'b', status: 'ok', root: '/r', tag: 'main', items: { '/r/a.txt': M('M'), '/r/src/x.c': M('U') } }
const metas: BadgeMeta[] = [{ key: 'p/b', packId: 'p', badgeId: 'b', label: L, folderDot: true }]

test('ok 결과는 기준 폴더 안의 하위 폴더를 다시 묻지 않게 함, 밖의 폴더는 물음', () => {
  const { set, none } = applyResults({}, new Set(), '/r', [ok])
  assert.equal(covered(set, none, 'p/b', '/r/src/deep'), true)
  assert.equal(covered(set, none, 'p/b', '/rx'), false) // 접두만 같은 다른 폴더
  assert.equal(covered(set, none, 'p/other', '/r/src'), false)
})

test('none·skipped는 그 폴더만 건너뜀, unsafe·slow는 알림을 남김', () => {
  const none = new Set<string>()
  const a = applyResults({}, none, '/n', [{ packId: 'p', badgeId: 'b', status: 'none' }, { packId: 'q', badgeId: 'c', status: 'unsafe' }])
  assert.equal(covered(a.set, none, 'p/b', '/n'), true)
  assert.equal(a.notice?.['/n'], 'unsafe')
  const b = applyResults(a.set, none, '/n', [{ packId: 'q', badgeId: 'c', status: 'slow' }, { packId: 'p', badgeId: 'b', status: 'failed' }])
  assert.equal(b.notice?.['/n'], 'slow')
  assert.equal(covered(b.set, none, 'p/b', '/f'), false) // failed는 곧 다시 물을 수 있음
})

test('칩: 같은 글자·제외 글자는 겹치지 않음', () => {
  const { set } = applyResults({}, new Set(), '/r', [ok])
  assert.deepEqual(chipsFor(set, '/r/a.txt').map((c) => c.show), ['M'])
  assert.deepEqual(chipsFor(set, '/r/a.txt', ['M']), [])
  assert.deepEqual(chipsFor(set, '/r/none'), [])
})

test('폴더 점과 tag', () => {
  const { set } = applyResults({}, new Set(), '/r', [ok])
  assert.equal(dotFor(set, metas, '/r/src'), true)
  assert.equal(dotFor(set, metas, '/r/other'), false)
  assert.equal(dotFor(set, [{ ...metas[0], folderDot: false }], '/r/src'), false)
  assert.equal(tagAt(set, '/r')?.tag, 'main')
  assert.equal(tagAt(set, '/r/src'), undefined)
})

test('devtools/git 배지가 켜져 있을 때만 내장 Git을 건너뜀', async () => {
  const { skipsBuiltinGit, activeBadges } = await import('./badgeview.mts')
  const entry = (id: string, enabled: boolean, off: string[]) => ({ id, enabled, badgesOff: off, pack: { badges: [{ id: 'git', label: L, folderDot: true }] } })
  const cat = (es: unknown[]) => ({ entries: es }) as never
  assert.equal(skipsBuiltinGit(activeBadges(cat([entry('devtools', true, [])]))), true)
  assert.equal(skipsBuiltinGit(activeBadges(cat([entry('devtools', false, [])]))), false)
  assert.equal(skipsBuiltinGit(activeBadges(cat([entry('devtools', true, ['git'])]))), false)
  assert.equal(skipsBuiltinGit(activeBadges(cat([entry('other', true, [])]))), false)
})
