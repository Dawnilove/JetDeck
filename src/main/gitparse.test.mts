import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirChanged, parseGit } from './gitparse.mts'

test('parseGit: 브랜치·앞뒤·파일 상태 (공백 든 이름 포함)', () => {
  const out = 'TOP=/home/u/ws\n## main...origin/main [ahead 2, behind 1]\0 M src/a.py\0?? new file.txt\0A  b.c\0 D gone\0UU x\0'
  const g = parseGit(out)!
  assert.equal(g.top, '/home/u/ws')
  assert.deepEqual([g.branch, g.ahead, g.behind], ['main', 2, 1])
  assert.deepEqual(g.files, {
    '/home/u/ws/src/a.py': 'M',
    '/home/u/ws/new file.txt': 'U',
    '/home/u/ws/b.c': 'A',
    '/home/u/ws/gone': 'D',
    '/home/u/ws/x': '!'
  })
  assert.equal(dirChanged(g, '/home/u/ws/src'), true)
  assert.equal(dirChanged(g, '/home/u/ws/doc'), false)
})
test('parseGit: 커밋 없음·HEAD 분리·저장소 아님', () => {
  assert.equal(parseGit('TOP=/r\n## No commits yet on master\0')!.branch, 'master')
  assert.equal(parseGit('TOP=/r\n## HEAD (no branch)\0')!.branch, 'HEAD')
  assert.equal(parseGit('TOP=/r\n## dev\0')!.ahead, 0)
  assert.equal(parseGit(''), null)
})
