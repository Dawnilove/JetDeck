import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setLang } from './i18n.mts'
import { trErr } from './packerr.mts'
import { validatePack } from './packschema.mts'

const L = (s: string) => ({ ko: s, en: s })
const base = (actions: unknown[]) => ({ id: 't', format: 1, version: '1.0.0', name: L('t'), plugins: [{ id: 'p', title: L('p'), actions }] })
const a = (o: Record<string, unknown>) => ({ id: 'a', label: L('a'), cmd: 'ls', risk: 'read', ...o })
const p1 = { name: 'x', label: L('x'), choices: [{ value: '1', label: L('1') }] }

test('영어 화면: 검사 오류·경고 문장에 한글이 남지 않음', () => {
  const bad = [
    {}, 'x', { id: 'A' }, a({ label: 5 }), a({ cmd: '' }), a({ cmd: 'x'.repeat(2001) }), a({ cmd: 'ls\r' }), a({ risk: 'x' }), a({ desc: 5 }), a({ confirm: 5, risk: 'change' }),
    a({ mode: 'x' }), a({ shell: 'zsh' }), a({ when: 'pc' }), a({ enter: 1, mode: 'terminal' }), a({ auto: 1 }), a({ sudo: 1 }), a({ mode: 'terminal', sudo: true }), a({ mode: 'terminal', cmd: Array(30).fill('ls').join('\n') }),
    a({ cmd: 'sudo ls' }), a({ sudo: true }), a({ risk: 'change', sudo: true, confirm: L('x'), cmd: 'ls | wc' }), a({ params: 5 }), a({ params: [5] }), a({ params: [{ ...p1, label: 5 }] }), a({ params: [{ ...p1, choices: [{ value: '--x', label: L('x') }] }] }),
    a({ params: [p1, p1] }), a({ cmd: 'ls {zz}' }), a({ risk: 'change', cmd: 'touch a', confirm: L('x'), preview: 5 }), a({ risk: 'change', cmd: 'touch a' }), a({ risk: 'change', cmd: 'rm -rf /etc', confirm: L('x') }),
    a({ cmd: 'rm a', risk: 'danger', confirm: L('x') }), a({ cmd: 'echo a > f' }), a({ display: 5 }), a({ display: { type: 'table' } }), a({ display: { type: 'table', columns: [L('a')], match: '(a)', split: 'ws' } }),
    a({ display: { type: 'table', columns: [L('a')], split: 'x' } }), a({ display: { type: 'table', columns: [L('a')], match: 5 } }), a({ display: { type: 'table', columns: [L('a')], match: '(' } }), a({ display: { type: 'table', columns: [L('a'), L('b')], match: '(a)' } }),
    a({ display: { type: 'table', columns: [L('a')], match: '(a+)+' } }), a({ display: { type: 'table', columns: [L('a')], skip: -1 } }), a({ display: { type: 'table', columns: [L('a')], labels: 5 } }), a({ display: { type: 'table', columns: [L('a')], empty: 5 } }), a({ timeout: 99999 }), a({ id: 'a' })
  ]
  setLang('en')
  try {
    const msgs: string[] = []
    for (const x of bad) {
      const r = validatePack(base([a({}), x]), { official: false })
      msgs.push(...r.errors, ...r.warnings)
    }
    for (const raw of [5, { format: 1 }, { format: 1, id: 'device' }, { format: 1, id: 'x', version: '1' }, { format: 1, id: 'x', version: '1.0.0', name: 5 }, { format: 1, id: 'x', version: '1.0.0', name: 'n', minApp: '99.0.0' }, { format: 1, id: 'x', version: '1.0.0', name: 'n', plugins: 5 }, { format: 1, id: 'x', version: '1.0.0', name: 'n', plugins: [] }]) {
      msgs.push(...validatePack(raw, { appVersion: '5.0.0' }).errors)
    }
    msgs.push('파일이 512KB보다 커요', 'JSON 형식이 올바르지 않아요', '같은 id의 팩 파일이 여러 개예요: a, b', '팩 id "x"는 공식 팩이 이미 써요')
    assert.ok(msgs.length > 40)
    const left = msgs.map(trErr).filter((m) => /[가-힣]/.test(m))
    assert.deepEqual(left, [])
    assert.equal(trErr('t: cmd가 비었어요'), 't: cmd is empty')
    setLang('ko')
    assert.equal(trErr('cmd가 비었어요'), 'cmd가 비었어요')
  } finally {
    setLang('ko')
  }
})
