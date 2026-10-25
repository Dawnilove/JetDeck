// 영어 사전 모음 (파일 묶음별로 나눠 둠). 같은 키는 한 파일에만 둠 (scripts/i18n-check.mjs가 겹침을 검사)
import { EN_A } from './a.mts'
import { EN_B } from './b.mts'
import { EN_C } from './c.mts'
import { EN_D } from './d.mts'
import { EN_E } from './e.mts'
import { EN_F } from './f.mts'
import { EN_G } from './g.mts'

export const EN: Record<string, string> = { ...EN_A, ...EN_B, ...EN_C, ...EN_D, ...EN_E, ...EN_F, ...EN_G }
