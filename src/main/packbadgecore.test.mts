import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BODY_MAX, dirProblem, parseBadge, UNSAFE_MARK } from './packbadgecore.mts'
import { LIMITS, validatePack, type Badge } from './packschema.mts'

// 5.3.0: 배지 출력 읽기 (순수 함수). 팩은 validatePack을 거친 것을 써서 실제 형식과 같게 시험
const L = (s: string) => ({ ko: s, en: s })
const base = {
  id: 'git',
  label: L('Git'),
  cmd: 'git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames',
  separator: 'nul',
  root: 'line1',
  tag: { match: '^## (.+?)(?:\\.\\.\\.|$)' },
  match: '^(.{2}) (.+)$',
  code: 1,
  path: 2,
  codes: { ' M': { show: 'M', text: L('수정됨'), tone: 'warn' }, '??': { show: 'U', text: L('새 파일'), tone: 'info' }, ' D': { show: 'D', text: L('삭제됨'), tone: 'bad' } }
}
const mk = (o: Record<string, unknown> = {}): Badge => {
  const r = validatePack({ id: 't', format: 1, version: '1.0.0', name: L('t'), minApp: '5.3.0', plugins: [], badges: [{ ...base, ...o }] })
  assert.ok(r.pack, r.errors.join('|'))
  return r.pack!.badges![0]
}
const git = (root: string, ...recs: string[]) => root + '\n' + recs.join('\0') + '\0\n'

test('dirProblem: 절대 경로·제어 문자·길이', () => {
  assert.equal(dirProblem('/home/u/proj'), null)
  assert.equal(dirProblem('/'), null)
  assert.equal(dirProblem('/a b/한글/it\'s'), null)
  for (const bad of ['', 'rel/x', '~/x', '/x\ny', '/x\0y', '/x\ry', '/x\u001by', '/x\u007f', `/${'a'.repeat(LIMITS.badgeDir)}`, 5, null, undefined]) assert.notEqual(dirProblem(bad), null, String(bad))
  assert.equal(dirProblem('/' + 'a'.repeat(LIMITS.badgeDir - 1)), null)
})

test('parseBadge: git status 출력 → 기준 폴더·브랜치 태그·경로별 배지', () => {
  const p = parseBadge(mk(), git('/home/u/proj', '## main...origin/main [ahead 1]', ' M src/a.ts', '?? notes.txt', '?? newdir/', ' D old.txt', '!! ignored', 'UU conflict.txt'), '/home/u/proj/src')
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.root, '/home/u/proj')
  assert.equal(p.tag, 'main')
  assert.equal(p.truncated, false)
  assert.deepEqual(Object.keys(p.items).sort(), ['/home/u/proj/newdir', '/home/u/proj/notes.txt', '/home/u/proj/old.txt', '/home/u/proj/src/a.ts']) // 코드를 모르는 줄(!!·UU)은 표시 안 함, 끝의 / 는 뗌
  assert.deepEqual(p.items['/home/u/proj/src/a.ts'], { show: 'M', tone: 'warn', text: L('수정됨') })
  assert.equal(p.items['/home/u/proj/newdir'].show, 'U')
})

test('parseBadge: 기준 폴더가 /일 때, 공백·한글·줄바꿈이 든 이름', () => {
  const p = parseBadge(mk(), git('/', ' M etc/a b.conf', ' M 한글/파일'), '/etc')
  assert.ok(p && p !== 'unsafe')
  assert.deepEqual(Object.keys(p.items).sort(), ['/etc/a b.conf', '/한글/파일'])
  const nl = parseBadge(mk(), git('/r', ' M bad\nname'), '/r')
  assert.ok(nl && nl !== 'unsafe')
  assert.deepEqual(nl.items, {}) // 줄바꿈이 든 이름은 버림
})

test('parseBadge: 위험한 경로(.., 절대 경로, 빈 조각, 제어 문자)는 버림', () => {
  const p = parseBadge(mk(), git('/r', ' M ../etc/passwd', ' M a/../../x', ' M /abs/path', ' M a//b', ' M ./c', ' M ok\u0007bell', ' M .', ' M ', ' M fine/x'), '/r')
  assert.ok(p && p !== 'unsafe')
  assert.deepEqual(Object.keys(p.items).sort(), ['/r/fine/x', '/r/okbell'].sort()) // 제어 문자는 지운 뒤 읽음, 그 밖은 버림
})

test('parseBadge: 같은 경로는 첫 레코드, 안 맞는 레코드·빈 레코드 건너뜀', () => {
  const p = parseBadge(mk(), git('/r', ' M a', '?? a', 'garbage', '', ' D b'), '/r')
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.items['/r/a'].show, 'M')
  assert.equal(p.items['/r/b'].show, 'D')
  assert.equal(Object.keys(p.items).length, 2)
})

test('parseBadge: tag는 첫 레코드만 쓰고 맞는 레코드는 목록에서 뺌, 40자·제어 문자 정리', () => {
  const long = 'x'.repeat(100)
  const p = parseBadge(mk(), git('/r', `## ${long}`, '## second', ' M a'), '/r')
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.tag, 'x'.repeat(LIMITS.badgeTag))
  assert.deepEqual(Object.keys(p.items), ['/r/a'])
  const c = parseBadge(mk(), git('/r', '## ma\u001b[31min\u0007'), '/r')
  assert.ok(c && c !== 'unsafe')
  assert.equal(c.tag, 'main')
  assert.equal(parseBadge(mk({ tag: undefined }), git('/r', '## main', ' M a'), '/r') && true, true)
  const none = parseBadge(mk({ tag: undefined }), git('/r', '## main'), '/r')
  assert.ok(none && none !== 'unsafe')
  assert.equal(none.tag, undefined)
})

test('parseBadge: root:"dir"·separator:"line" (결과 경로는 연 폴더 기준)', () => {
  const b = mk({ cmd: 'ls -A {dir}', separator: 'line', root: 'dir', tag: undefined, match: '^(.)\\s(.+)$', codes: { M: { show: 'M', text: L('x'), tone: 'ok' } } })
  const p = parseBadge(b, 'M a.txt\r\nM b c.txt\nX no.txt\n', '/home/u/p')
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.root, '/home/u/p')
  assert.deepEqual(Object.keys(p.items), ['/home/u/p/a.txt', '/home/u/p/b c.txt'])
})

test('parseBadge: 읽을 수 없는 출력은 null, 저장소 설정이 위험하면 unsafe', () => {
  const b = mk()
  assert.equal(parseBadge(b, '', '/r'), null)
  assert.equal(parseBadge(b, '/r', '/r'), null) // 줄바꿈이 없으면 기준 폴더도 없음
  assert.equal(parseBadge(b, 'relative/path\n ?? x\0', '/r'), null)
  assert.equal(parseBadge(b, '/r\u0000bad\n', '/r'), null)
  assert.equal(parseBadge(b, UNSAFE_MARK + '\n', '/r'), 'unsafe')
  assert.equal(parseBadge(b, UNSAFE_MARK, '/r'), 'unsafe')
  assert.notEqual(parseBadge(b, '/r\n' + UNSAFE_MARK + '\0', '/r'), 'unsafe') // 맨 앞 줄이 아니면(파일 이름 등) 위험 표시로 안 봄
})

test('parseBadge: 레코드 5000개·출력 1MB 상한은 truncated', () => {
  const recs = Array.from({ length: LIMITS.badgeRecords + 50 }, (_, i) => ` M f${i}`)
  const p = parseBadge(mk(), git('/r', ...recs), '/r')
  assert.ok(p && p !== 'unsafe')
  assert.equal(p.truncated, true)
  assert.ok(Object.keys(p.items).length <= LIMITS.badgeRecords)
  const huge = parseBadge(mk(), git('/r', ' M a', 'x'.repeat(BODY_MAX + 10)), '/r')
  assert.ok(huge && huge !== 'unsafe')
  assert.equal(huge.truncated, true)
  assert.equal(huge.items['/r/a'].show, 'M')
  const small = parseBadge(mk(), git('/r', ' M a'), '/r')
  assert.ok(small && small !== 'unsafe')
  assert.equal(small.truncated, false)
  const longRec = parseBadge(mk(), git('/r', ' M ' + 'a'.repeat(LIMITS.badgeLineChars + 100)), '/r')
  assert.ok(longRec && longRec !== 'unsafe')
  assert.deepEqual(longRec.items, {}) // 너무 긴 경로는 잘린 채 쓰지 않고 버림 (잘린 경로가 다른 파일을 가리키지 않게)
})

test('parseBadge: 코드 이름이 Object.prototype 속성과 같아도 표시하지 않음', () => {
  const b = mk({ match: '^(\\w+) (.+)$', codes: { ' M': { show: 'M', text: L('x'), tone: 'ok' } } })
  const p = parseBadge(b, git('/r', 'constructor a', '__proto__ b', 'toString c', 'hasOwnProperty d'), '/r')
  assert.ok(p && p !== 'unsafe')
  assert.deepEqual(p.items, {})
})
