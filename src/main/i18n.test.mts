import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EN } from './en/index.mts'
import { detectLang, setLang, tr } from './i18n.mts'

test('한국어 모드는 키 그대로, 변수 자리 채움', () => {
  setLang('ko')
  assert.equal(tr('{0}개 중 {1}개', 3, 5), '3개 중 5개')
})
test('영어 모드: 사전에 있으면 영어, 없으면 한글 그대로', () => {
  EN['저장'] = 'Save'
  EN['{0}개 선택됨'] = '{0} selected'
  setLang('en')
  assert.equal(tr('저장'), 'Save')
  assert.equal(tr('{0}개 선택됨', 2), '2 selected')
  assert.equal(tr('사전에 없는 문구'), '사전에 없는 문구')
  setLang('ko')
  delete EN['저장']
  delete EN['{0}개 선택됨']
})
test('언어 감지: ko로 시작하면 한국어, 그 밖은 영어', () => {
  assert.equal(detectLang('ko-KR'), 'ko')
  assert.equal(detectLang('en-US'), 'en')
  assert.equal(detectLang('ja'), 'en')
})
